// Smoke test for the layered display engine + column renderer.
// Loads tikunScript.js into a fake DOM, feeds it the sample torah.json,
// renders a column, then exercises global / per-verse / per-word toggles.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const js = readFileSync(resolve(repo, 'assets/html/js/tikunScript.js'), 'utf8');
const specialJs = readFileSync(
  resolve(repo, 'assets/html/js/specialReadings.js'), 'utf8');
const torahJson = readFileSync(resolve(repo, 'assets/html/data/torah.json'), 'utf8');

// Tiny DOM polyfill - sufficient for what tikunScript.js touches.
class Storage {
  constructor() { this.s = new Map(); }
  getItem(k) { return this.s.has(k) ? this.s.get(k) : null; }
  setItem(k, v) { this.s.set(k, String(v)); }
  removeItem(k) { this.s.delete(k); }
}

let nextNodeId = 1;
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.id = '_n' + (nextNodeId++);
    this.children = [];
    this.attrs = new Map();
    this.dataset = {};
    this.style = {};
    this._textContent = '';
    this.parent = null;
    this.classList = {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) {
        if (on === undefined) on = !this._set.has(c);
        if (on) this._set.add(c); else this._set.delete(c);
      },
    };
    this.listeners = {};
  }
  setAttribute(k, v) {
    v = String(v);
    this.attrs.set(k, v);
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = v;
    if (k === 'class') {
      this.classList._set = new Set(v.split(/\s+/).filter(Boolean));
    }
    if (k === 'id') this._idAttr = v;
  }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) {
    this.attrs.delete(k);
    if (k.startsWith('data-')) delete this.dataset[k.slice(5)];
  }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  insertBefore(c, before) {
    c.parent = this;
    const i = before ? this.children.indexOf(before) : -1;
    if (i < 0) this.children.unshift(c);
    else this.children.splice(i, 0, c);
    return c;
  }
  set textContent(v) { this._textContent = String(v); this.children = []; }
  get textContent() {
    if (this._textContent !== '') return this._textContent;
    return this.children.map(c => c.textContent || '').join('');
  }
  set className(v) { this.setAttribute('class', v); }
  get className() { return this.getAttribute('class') || ''; }
  set innerHTML(html) {
    this.children = [];
    this._textContent = '';
    parseInto(html, this);
  }
  get innerHTML() { return ''; }
  closest(sel) {
    let n = this;
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    while (n) {
      if (cls && n.classList && n.classList.contains(cls)) return n;
      if (!cls && n.tagName === sel.toUpperCase()) return n;
      n = n.parent;
    }
    return null;
  }
  getElementsByClassName(c) { return collect(this, n => n.classList && n.classList.contains(c)); }
  getElementsByTagName(t) { return collect(this, n => n.tagName === t.toUpperCase()); }
  querySelector(sel) {
    const all = sel.startsWith('.')
      ? this.getElementsByClassName(sel.slice(1))
      : this.getElementsByTagName(sel);
    return all[0] || null;
  }
  addEventListener(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) { this.children.splice(i, 1); c.parent = null; }
  }
  // The renderer uses these layout-measurement properties; in our fake DOM
  // we always say "the line never overflows" so words pile onto a single
  // line. That's enough for unit-testing engine logic; the real visual
  // layout test is done in the browser/emulator.
  get scrollWidth() { return 0; }
  get clientWidth() { return 99999; }
  get offsetTop() { return 0; }
  // applyDisplayToWord() clears any previously-rendered split via
  // `while (span.firstChild) span.removeChild(span.firstChild)`. Without
  // this getter, firstChild is undefined and the loop never enters,
  // so the rabbati-letter splits accumulate on every re-render and
  // the test asserts pile up "בְּרֵאשִׁ֖ית" repeated 10x.
  get firstChild() { return this.children[0] || null; }
  querySelectorAll(sel) {
    if (typeof sel !== 'string') return [];
    // very small subset: support comma-separated class selectors
    const sels = sel.split(',').map(s => s.trim()).filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const s of sels) {
      let nodes;
      if (s.startsWith('.')) nodes = this.getElementsByClassName(s.slice(1));
      else nodes = this.getElementsByTagName(s);
      for (const n of nodes) {
        if (!seen.has(n)) { seen.add(n); out.push(n); }
      }
    }
    return out;
  }
}

function collect(root, pred) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.children) {
      // push in reverse so we visit in document order
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    if (pred(n)) out.push(n);
  }
  return out;
}

function parseInto(html, parent) {
  const stack = [parent];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) break;
      let inside = html.slice(i + 1, close);
      i = close + 1;
      if (inside.startsWith('!') || inside.startsWith('?')) continue;
      if (inside.startsWith('/')) {
        const tag = inside.slice(1).trim().toLowerCase();
        for (let j = stack.length - 1; j > 0; j--) {
          if (stack[j].tagName === tag.toUpperCase()) {
            stack.length = j;
            break;
          }
        }
        continue;
      }
      let selfClose = false;
      if (inside.endsWith('/')) { selfClose = true; inside = inside.slice(0, -1); }
      const m = inside.match(/^([a-zA-Z0-9]+)([\s\S]*)$/);
      if (!m) continue;
      const tag = m[1].toLowerCase();
      const rest = m[2];
      const el = new FakeElement(tag);
      const attrRe = /([a-zA-Z\-:_]+)\s*(?:=\s*"([^"]*)"|=\s*'([^']*)'|=\s*([^\s>]+))?/g;
      let am;
      while ((am = attrRe.exec(rest)) !== null) {
        const name = am[1];
        const val = am[2] ?? am[3] ?? am[4] ?? '';
        el.setAttribute(name, val);
      }
      stack[stack.length - 1].appendChild(el);
      const voids = new Set(['br', 'meta', 'link', 'img', 'input']);
      if (!selfClose && !voids.has(tag)) stack.push(el);
    } else {
      const next = html.indexOf('<', i);
      const text = html.slice(i, next === -1 ? html.length : next);
      i = next === -1 ? html.length : next;
      if (text.length) {
        // attach as a synthetic text node
        const t = new FakeElement('#text');
        t._textContent = text;
        stack[stack.length - 1].appendChild(t);
      }
    }
  }
}

const root = new FakeElement('html');
const head = new FakeElement('head');
const body = new FakeElement('body');
body.setAttribute('class', 'theBody theReadBody');
root.appendChild(head); root.appendChild(body);

// Build a minimal DOM that read.html produces, since we don't render the
// HTML file - we directly simulate what initReadPage does.
function el(tag, attrs = {}, text = '') {
  const e = new FakeElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e._textContent = text;
  return e;
}
const breadcrumb = el('div', { id: 'readBreadcrumb' });
const colInfo = el('div', { id: 'colInfo' });
const btnPrev = el('button', { id: 'btnPrev' });
const btnNext = el('button', { id: 'btnNext' });
const stage = el('div', { id: 'readStage' });
const column = el('div', { id: 'readColumn' });
stage.appendChild(column);
body.appendChild(breadcrumb);
body.appendChild(colInfo);
body.appendChild(btnPrev);
body.appendChild(btnNext);
body.appendChild(stage);

const document = {
  body, documentElement: root, head,
  getElementById(id) {
    return collect(root, n => n.attrs && n.attrs.get('id') === id)[0] || null;
  },
  getElementsByClassName: c => root.getElementsByClassName(c),
  getElementsByTagName: t => root.getElementsByTagName(t),
  querySelector: sel => root.querySelector(sel),
  createElement: tag => new FakeElement(tag),
  createTextNode: text => {
    // applyDisplayToWord() splits a rabbati / ze'ira word into:
    //   <span class="word"> [textNode prefix]
    //                       <span class="styLetter">[middle]</span>
    //                       [textNode suffix] </span>
    // and the renderer here uses document.createTextNode for the
    // prefix/suffix runs. Our FakeElement was already representing
    // text from the HTML parser as `#text` nodes whose textContent
    // is the literal string, so we model createTextNode the same
    // way for symmetry.
    const t = new FakeElement('#text');
    t._textContent = String(text);
    return t;
  },
  addEventListener: () => {},
};

const localStorage = new Storage();

const window = {
  localStorage, setTimeout, clearTimeout, setInterval, clearInterval,
  console, location: { href: '', search: '' },
};
window.window = window;

// Mock fetch -> returns the bundled torah.json (and a stub layout)
let layoutJson = '{}';
try { layoutJson = readFileSync(resolve(repo, 'assets/html/data/layout.json'), 'utf8'); } catch {}
const fetch = (url) => {
  if (url.includes('torah.json')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(torahJson)) });
  }
  if (url.includes('layout.json')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(layoutJson)) });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
};

const URLSearchParams = class {
  constructor(s) { this.s = s || ''; }
  has() { return false; }
  get() { return null; }
};

const ctx = {
  document, window, localStorage,
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  fetch, URLSearchParams,
  Number,
};
vm.createContext(ctx);
vm.runInContext(specialJs + '\n//# sourceURL=specialReadings.js', ctx);
vm.runInContext(js + '\n//# sourceURL=tikunScript.js', ctx);

let passes = 0, fails = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passes++; }
  else { console.log(`  FAIL: ${msg}`); fails++; }
}

// Run engine steps inline (don't go through fetch async path - we'll call
// internals directly).
const TORAH = JSON.parse(torahJson);
const LAYOUT = JSON.parse(layoutJson);
ctx.TORAH = TORAH;
ctx.LAYOUT = LAYOUT;
ctx.COLUMNS = ctx.buildColumns(TORAH.tokens, LAYOUT);
console.log(`Loaded ${TORAH.tokens.length} tokens into ${ctx.COLUMNS.length} columns`);

ctx.renderColumn(0);

const words = body.getElementsByClassName('word');
console.log(`After render: ${words.length} words`);

assert(words.length > 0, 'rendered at least 1 word');
assert(ctx.COLUMNS.length === 245 || ctx.COLUMNS.length > 0,
  `built ${ctx.COLUMNS.length} columns (expect 245 with layout.json)`);

const w = words[0];
const wVerseKey =
  (w.getAttribute('data-chapter') || '') + ':' + (w.getAttribute('data-verse') || '');
assert(wVerseKey !== ':', `first word has chapter:verse key ("${wVerseKey}")`);

// find a sibling word in the SAME verse for verse-level tests
let w2 = null;
for (let i = 1; i < words.length; i++) {
  const k =
    (words[i].getAttribute('data-chapter') || '') + ':' +
    (words[i].getAttribute('data-verse') || '');
  if (k === wVerseKey) { w2 = words[i]; break; }
}
assert(w2 !== null, 'found at least one other word in the same verse');

console.log('\n[1] Default = full');
ctx.refreshAllWords();
assert(w.textContent === w.getAttribute('data-f'),
  `word shows full form by default ("${w.textContent}")`);

console.log('\n[2] Toggle nikud off globally -> taam mode');
ctx.toggleNikud();
assert(w.textContent === w.getAttribute('data-t'),
  `word shows taam variant ("${w.textContent}")`);

console.log('\n[3] Toggle taam off globally -> stam mode');
ctx.toggleTaam();
assert(w.textContent === w.getAttribute('data-s'),
  `word shows stam variant ("${w.textContent}")`);

console.log('\n[4] Re-enable both -> back to full');
ctx.toggleNikud(); ctx.toggleTaam();
assert(w.textContent === w.getAttribute('data-f'), 'word shows full again');

console.log('\n[5] Tap word once -> cycle from full to stam (start of cycle)');
let nextMode = ctx.cycleWordMode(w);
assert(nextMode === 'stam', `cycle returned "${nextMode}", want "stam"`);
assert(w.textContent === w.getAttribute('data-s'),
  `word shows stam ("${w.textContent}")`);
assert(w.getAttribute('data-ov-nikud') === 'off' &&
       w.getAttribute('data-ov-taam') === 'off',
  'both axis overrides set to off');

console.log('\n[6] Tap same word -> stam -> taam');
nextMode = ctx.cycleWordMode(w);
assert(nextMode === 'taam', `cycle returned "${nextMode}", want "taam"`);
assert(w.textContent === w.getAttribute('data-t'),
  `word shows taam-only ("${w.textContent}")`);

console.log('\n[7] Tap same word -> taam -> full (back to inherited)');
nextMode = ctx.cycleWordMode(w);
assert(nextMode === 'full', `cycle returned "${nextMode}", want "full"`);
assert(w.textContent === w.getAttribute('data-f'),
  `word shows full ("${w.textContent}")`);
assert(w.getAttribute('data-ov-nikud') == null &&
       w.getAttribute('data-ov-taam') == null,
  'overrides cleared once we land back on inherited mode');

console.log('\n[8] Tap on verse number cycles full -> stam for the whole verse');
let nextV = ctx.cycleVerseModeByKey(wVerseKey);
assert(nextV === 'stam', `verse cycle returned "${nextV}", want "stam"`);
assert(ctx.VERSE_OV[wVerseKey] &&
       ctx.VERSE_OV[wVerseKey].nikud === 'off' &&
       ctx.VERSE_OV[wVerseKey].taam === 'off',
  `VERSE_OV["${wVerseKey}"] = {nikud:off, taam:off}`);
assert(w2.textContent === w2.getAttribute('data-s'),
  `sibling word inherits verse-level stam ("${w2.textContent}")`);
assert(w.textContent === w.getAttribute('data-s'),
  `first word also inherits verse-level stam ("${w.textContent}")`);

console.log('\n[9] Per-word override beats verse: tap word w cycles independently');
nextMode = ctx.cycleWordMode(w);
assert(nextMode === 'taam', `word cycle returned "${nextMode}", want "taam"`);
assert(w.textContent === w.getAttribute('data-t'),
  `word w shows taam-only ("${w.textContent}")`);
assert(w2.textContent === w2.getAttribute('data-s'),
  `sibling w2 still stam (verse-level)`);

console.log('\n[10] clearAllOverrides resets everything to global');
ctx.clearAllOverrides();
assert(w.textContent === w.getAttribute('data-f'), 'word reset to full');
assert(!ctx.VERSE_OV[wVerseKey], 'verse overrides cleared');
assert(w.getAttribute('data-ov-taam') == null && w.getAttribute('data-ov-nikud') == null,
  'word overrides cleared');

console.log('\n[11] Column metadata is populated');
const cur = ctx.COLUMNS[ctx.COLUMN_IDX];
assert(cur.sefer === 'Bereshit', `column.sefer = "${cur.sefer}"`);
assert(cur.parasha === 'Bereshit', `column.parasha = "${cur.parasha}"`);

console.log('\n[12] Column 1 starts with בראשית and column 61 with ועשר (consonants)');
function consonantsOnly(s) {
  return s.replace(/[\u0591-\u05C7]/g, '').replace(/[^\u05D0-\u05EA]/g, '');
}
ctx.renderColumn(0);
const firstWord1 = body.getElementsByClassName('word')[0];
const cons1 = consonantsOnly(firstWord1.getAttribute('data-f'));
assert(cons1 === 'בראשית',
  `col 1 first word consonants = "בראשית" (got "${cons1}", full="${firstWord1.getAttribute('data-f')}")`);
if (ctx.COLUMNS.length >= 11) {
  // Regression: col 11 used to pick up Esther 6 ("המלך") because
  // the source data cache has duplicate `1-...js` chunks for both
  // humash and megillot. Make sure col 11 now starts with "ויהי"
  // (Bereshit 11:1).
  ctx.renderColumn(10);
  const firstWord11 = body.getElementsByClassName('word')[0];
  const cons11 = consonantsOnly(firstWord11.getAttribute('data-f'));
  assert(cons11 === 'ויהי',
    `col 11 first word consonants = "ויהי" (got "${cons11}", full="${firstWord11.getAttribute('data-f')}")`);
}
if (ctx.COLUMNS.length >= 61) {
  ctx.renderColumn(60);
  const firstWord61 = body.getElementsByClassName('word')[0];
  const cons61 = consonantsOnly(firstWord61.getAttribute('data-f'));
  assert(cons61 === 'ועשר',
    `col 61 first word consonants = "ועשר" (got "${cons61}", full="${firstWord61.getAttribute('data-f')}")`);
}
if (ctx.COLUMNS.length >= 148) {
  // Regression: col 148 should contain the Vayikra->Bamidbar transition
  // and the layout should include a `seferBreak` line so the renderer
  // can draw the 4-line "ארבעה שיטין" gap between the books.
  const col148 = ctx.COLUMNS[147];
  const lines = col148.lines || [];
  const hasSeferBreak = lines.some(l => l.kind === 'seferBreak' && l.heb === 'במדבר');
  assert(hasSeferBreak,
    `col 148 layout includes seferBreak{heb:"במדבר"} (lines=${lines.map(l=>l.kind).join(',')})`);
}

// Regression: Parashat Balak starts mid-line with a setumah gap
// ("...יְרֵחֽוֹ׃ {ס}[בלק]וַיַּ֥רְא בָּלָ֖ק..."). The line layout must
// expose this gap as `sg:1` on the word entry for "וַיַּ֥רְא" so the
// renderer inserts the standard ~6ch blank inside the line, instead
// of breaking onto a new line and losing the same-line setumah.
{
  let foundBalakSg = false;
  let foundBalakLineNoSg = false;
  for (const c of ctx.COLUMNS) {
    if (c.sefer !== 'Bamidbar') continue;
    for (const line of (c.lines || [])) {
      if (line.kind !== 'text' || !line.words) continue;
      let hasYereho = false;
      let vayarSg = -1;
      for (const w of line.words) {
        const tk = TORAH.tokens[w.i];
        if (!tk || !tk.f) continue;
        if (tk.f.indexOf('יְרֵחֽוֹ') >= 0) hasYereho = true;
        if (tk.f === 'וַיַּ֥רְא') vayarSg = w.sg || 0;
      }
      if (hasYereho && vayarSg > 0) foundBalakSg = true;
      if (hasYereho && vayarSg === 0) foundBalakLineNoSg = true;
    }
  }
  assert(foundBalakSg && !foundBalakLineNoSg,
    'Balak setumah: line with "יְרֵחֽוֹ" + "וַיַּ֥רְא" carries sg>=1 on "וַיַּ֥רְא"');
}

// Total setumah-gap markers across all columns - guards against a
// regression that would silently drop the inline sg fields.
{
  let withSg = 0;
  for (const c of ctx.COLUMNS) {
    for (const line of (c.lines || [])) {
      if (!line.words) continue;
      for (const w of line.words) if (w.sg) withSg++;
    }
  }
  assert(withSg > 100,
    `at least 100 word entries carry sg (got ${withSg})`);
}

// Regression: the LAST line of a column whose paragraph continues
// into the next column must NOT be tagged sLineEndShort. The
// previous bug was a lookahead that walked past col.end into the
// next column's tokens, found a petucha/setumah/chapter/parasha
// marker before the next word (very common at column boundaries),
// and wrongly tagged the bottom line as a paragraph end -- which
// rendered ragged-left instead of full-justified across the
// column width. Fix bounds the scan by col.end.
//
// We pick a column whose final line genuinely runs into more text
// in the next column (no petucha/setumah on this line at all). Col
// 1 in the Davidovich layout ends mid-יום-שלישי-paragraph; its
// last line should be full-justified, not ragged.
{
  // Find a column where:
  //   * the very last line is text (not blank/seferBreak),
  //   * no petucha/setumah/parasha break occurs between this
  //     column's last word and the next column's first word.
  // Then re-render and assert the bottom .sLine has no
  // sLineEndShort class.
  function findContinuingCol() {
    for (let ci = 0; ci < ctx.COLUMNS.length - 1; ci++) {
      const c = ctx.COLUMNS[ci];
      const ls = c.lines || [];
      if (ls.length === 0) continue;
      const last = ls[ls.length - 1];
      if (last.kind !== 'text') continue;
      if (!last.words || last.words.length === 0) continue;
      const lastWordTok = last.words[last.words.length - 1].i;
      let breakBetween = false;
      for (let ti = lastWordTok + 1; ti < c.end; ti++) {
        const tk = TORAH.tokens[ti];
        if (!tk) break;
        if (tk.k === 'petucha' || tk.k === 'setumah') {
          breakBetween = true; break;
        }
      }
      if (breakBetween) continue;
      return ci;
    }
    return -1;
  }
  const colCont = findContinuingCol();
  assert(colCont >= 0, `found a column whose paragraph continues across the boundary`);
  if (colCont >= 0) {
    ctx.renderColumn(colCont);
    const allLines = body.getElementsByClassName('sLine');
    let lastTextLine = null;
    for (let i = allLines.length - 1; i >= 0; i--) {
      const cls = allLines[i].classList;
      if (cls.contains('sLineBlank')) continue;
      lastTextLine = allLines[i];
      break;
    }
    assert(lastTextLine,
      `col ${colCont + 1}: rendered at least one text .sLine`);
    if (lastTextLine) {
      assert(!lastTextLine.classList.contains('sLineEndShort'),
        `col ${colCont + 1}: last text line is NOT tagged sLineEndShort ` +
        `(paragraph continues into col ${colCont + 2})`);
    }
  }
}

console.log('\n[13] Special reading refs resolve to the right column');
function colForRef(ref) {
  const p = ctx.parseSpecialRef(ref);
  if (!p) return -1;
  const tokIdx = ctx.findTokenForRef(
    TORAH.tokens, p.sefer, p.chapter, p.verse);
  if (tokIdx < 0) return -1;
  for (let i = 0; i < ctx.COLUMNS.length; i++) {
    if (tokIdx >= ctx.COLUMNS[i].start && tokIdx < ctx.COLUMNS[i].end) {
      return i;
    }
  }
  return -1;
}

// Sanity: each well-known special reading lands on SOME column.
const refsToCheck = [
  ['Bereshit:21:1',  'Rosh Hashana day 1'],
  ['Bereshit:22:1',  'Rosh Hashana day 2'],
  ['Vayikra:16:1',   'Yom Kippur shacharit'],
  ['Vayikra:18:1',   'Yom Kippur mincha'],
  ['Devarim:4:25',   'Tisha B\'Av shacharit'],
  ['Shemot:32:11',   'Vayechal (fasts / Tisha B\'Av mincha)'],
  ['Bamidbar:7:1',   'Chanukah day 1'],
  ['Bamidbar:7:54',  'Chanukah day 8'],
  ['Bamidbar:28:1',  'Rosh Chodesh'],
  ['Shemot:30:11',   'Shabbat Shekalim (maftir)'],
  ['Devarim:25:17',  'Shabbat Zachor'],
  ['Bamidbar:19:1',  'Shabbat Parah'],
  ['Shemot:12:1',    'Shabbat HaChodesh'],
  ['Devarim:33:1',   'Simchat Torah (Vezot HaBerakhah)'],
];
for (const [ref, label] of refsToCheck) {
  const c = colForRef(ref);
  assert(c >= 0 && c < ctx.COLUMNS.length,
    `${label} (${ref}) -> col ${c + 1}`);
}

// Render col 78 (which contains "עַל־כֵּן קָרָֽא־שְׁמָהּ" maqaf
// pairs at the bottom) and verify each pair is wrapped in a single
// .maqafPair flex child rather than two siblings — otherwise the
// inter-word `space-between` would split the pair with a wide gap.
{
  ctx.renderColumn(77);
  const pairs = body.getElementsByClassName('maqafPair');
  assert(pairs.length >= 2,
    `col 78 renders >= 2 maqafPair groups (got ${pairs.length})`);
  if (pairs.length) {
    const inner = pairs[0].getElementsByClassName('word');
    assert(inner.length === 2,
      `each maqafPair holds exactly 2 .word spans (got ${inner.length})`);
    const glyphs = pairs[0].getElementsByClassName('maqafGlyph');
    assert(glyphs.length === 1,
      `each maqafPair has 1 .maqafGlyph (got ${glyphs.length})`);
    assert(glyphs[0].textContent === '\u05BE',
      `maqaf glyph is U+05BE (got "${glyphs[0].textContent}")`);
  }
}

// Regression: the special-readings list renders with each category
// initially COLLAPSED. The user expects to tap a category title to
// expand its readings. Before this fix, all groups were expanded by
// default, defeating the purpose of the outer accordion.
{
  const list = el('div', { id: 'specialList' });
  body.appendChild(list);
  const outer = el('div', { id: 'special' });
  outer.style.maxHeight = '500px';
  body.appendChild(outer);

  ctx.renderSpecialList();

  const groups = list.getElementsByClassName('specialGroup');
  assert(groups.length > 0,
    `renderSpecialList emits >= 1 group (got ${groups.length})`);

  const titles = list.getElementsByClassName('specialGroupTitle');
  const bodies = list.getElementsByClassName('specialGroupBody');
  assert(titles.length === groups.length,
    `each group has a title (got ${titles.length} for ${groups.length})`);
  assert(bodies.length === groups.length,
    `each group has a body (got ${bodies.length} for ${groups.length})`);

  // Every body starts collapsed: no inline maxHeight set.
  let allCollapsed = true;
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].style && bodies[i].style.maxHeight) {
      allCollapsed = false; break;
    }
  }
  assert(allCollapsed,
    `all category bodies are initially collapsed`);

  // Each title carries the onclick handler invoking toggleSpecialGroup.
  const click = titles[0].getAttribute('onclick') || '';
  assert(click.includes('toggleSpecialGroup'),
    `group title has toggleSpecialGroup onclick (got "${click}")`);

  // Body id is referenced from the title's onclick.
  const m = click.match(/toggleSpecialGroup\('([^']+)'/);
  assert(m && m[1] && bodies[0].getAttribute('id') === m[1],
    `body id matches the one referenced from title onclick`);

  // Toggling actually opens the group: maxHeight gets set, title
  // gains the .open class so the chevron rotates.
  ctx.toggleSpecialGroup(m[1], titles[0]);
  assert(!!bodies[0].style.maxHeight,
    `after toggle, body has maxHeight set`);
  assert(titles[0].classList.contains('open'),
    `after toggle, title has .open class (chevron rotates)`);

  // Toggling again closes it.
  ctx.toggleSpecialGroup(m[1], titles[0]);
  assert(!bodies[0].style.maxHeight,
    `after second toggle, body collapses again`);
  assert(!titles[0].classList.contains('open'),
    `after second toggle, .open is removed`);
}

// Regression: the help/intro popup. Two flows share the same overlay
// and the same `tk_seenIntro` localStorage flag:
//   - Auto-shown on first launch (showHelpPopupIfFirstLaunch).
//   - Manual reopen via the "?" icon (showHelpPopup).
// closeHelpPopup() sets the flag so neither flow re-pops on relaunch.
// We had a bug where the local HTTP server picked a random port each
// launch, making every relaunch a new origin and silently wiping
// localStorage; that's why the popup kept re-appearing forever. The
// fix lives in lib/local_server.dart (pinned port). On the JS side
// the contract we test here is just: the gate respects the flag, and
// closeHelpPopup() actually sets it.
{
    // Reset DOM + storage to a clean state for this isolated check.
    while (body.firstChild) body.removeChild(body.firstChild);
    ctx.localStorage.removeItem('tk_seenIntro');

    // No flag -> first-launch gate must show the popup, and the
    // overlay div must actually be injected into the DOM (the build
    // creates it lazily so neither index.html nor read.html has to
    // duplicate the markup).
    ctx.showHelpPopupIfFirstLaunch();
    const ov1 = document.getElementById('helpOverlay');
    assert(ov1, `helpOverlay is injected on first-launch gate`);
    assert(ov1.style.display === 'flex',
        `helpOverlay is visible after first-launch gate (got "${ov1.style.display}")`);

    // closeHelpPopup() hides the overlay AND persists the seen flag.
    ctx.closeHelpPopup();
    assert(ov1.style.display === 'none',
        `helpOverlay is hidden after closeHelpPopup (got "${ov1.style.display}")`);
    assert(ctx.localStorage.getItem('tk_seenIntro') === '1',
        `tk_seenIntro is set to "1" after closeHelpPopup`);

    // Second launch (flag is set): the gate must NOT re-show. We
    // simulate by hiding the overlay first then calling the gate;
    // it should leave it hidden.
    ctx.showHelpPopupIfFirstLaunch();
    assert(ov1.style.display === 'none',
        `helpOverlay stays hidden when tk_seenIntro is already set`);

    // Manual reopen via "?" icon ignores the flag and shows again.
    ctx.showHelpPopup();
    assert(ov1.style.display === 'flex',
        `showHelpPopup() reopens the overlay even when tk_seenIntro is set`);
}

// And a content-level check: the verse at Bereshit 21:1 (Rosh Hashana
// day 1) must contain the verb "פקד" - "וה' פקד את שרה".
{
  const ref = 'Bereshit:21:1';
  const p = ctx.parseSpecialRef(ref);
  const tokIdx = ctx.findTokenForRef(
    TORAH.tokens, p.sefer, p.chapter, p.verse);
  // Walk forward from the verse marker to the next 4 word tokens
  // and look for a word whose consonant-only form is "פקד".
  let foundPokad = false;
  let scanned = 0;
  for (let i = tokIdx + 1; i < TORAH.tokens.length && scanned < 8; i++) {
    const tk = TORAH.tokens[i];
    if (!tk) continue;
    if (tk.k === 'verse') break;       // next verse, stop
    if (tk.k !== 'w') continue;
    scanned++;
    const cons = (tk.s || tk.f || '').replace(/[\u0591-\u05C7]/g, '')
                                      .replace(/[^\u05D0-\u05EA]/g, '');
    if (cons === 'פקד') { foundPokad = true; break; }
  }
  assert(foundPokad,
    `Bereshit 21:1 verse contains "פקד" (וה' פקד את שרה)`);
}

// Regression: rabbati / ze'ira letter rendering.
// The first word of the Torah (בְּרֵאשִׁית, Bereshit 1:1) has a
// drop-cap ב — the *single letter* should be enlarged, NOT the whole
// word. Pre-fix, the build tagged the whole word with sty=big and
// CSS scaled .word { font-size: 1.35em; }, which made the entire
// word visibly bigger than the rest of the line (the user spotted
// the same bug for "מִשְׁפָּטָן" in Bemidbar 27:5, where the rabbati
// is the final ן).
//
// Post-fix:
//   - the build emits both `sty: "big"` AND `styLetter: "ב"` on the
//     token, identifying the consonant the marker singled out.
//   - makeWordEl() stamps `data-sty-letter` on the .word span and
//     routes initial render through applyDisplayToWord().
//   - applyDisplayToWord() splits the word into a textNode prefix +
//     <span class="styLetter">ב + combining marks</span> + suffix.
//   - CSS scopes the size override to .word > .styLetter, so the
//     rest of the word renders at the column's normal size.
{
    const tokenWithSty = TORAH.tokens.find(
        t => t && t.k === 'w' && t.sty === 'big' && t.styLetter);
    assert(tokenWithSty,
        `at least one word token carries both sty and styLetter`);
    if (tokenWithSty) {
        const w = ctx.makeWordEl(tokenWithSty);
        assert(w.getAttribute('data-sty') === 'big',
            `makeWordEl stamps data-sty="big"`);
        assert(w.getAttribute('data-sty-letter') === tokenWithSty.styLetter,
            `makeWordEl stamps data-sty-letter="${tokenWithSty.styLetter}"`);
        // The rendered word must contain a child <span class="styLetter">
        // whose text is the special consonant (possibly with combining
        // marks). The rest of the word must NOT live inside that span.
        const inner = w.querySelector('.styLetter');
        assert(inner, `rendered word has a .styLetter child`);
        if (inner) {
            const innerText = inner.textContent || '';
            // First char of inner must be the singled-out consonant.
            assert(innerText.charAt(0) === tokenWithSty.styLetter,
                `.styLetter starts with the rabbati/ze'ira consonant ` +
                `("${innerText.charAt(0)}" vs "${tokenWithSty.styLetter}")`);
            // The full word's text must still match the token's full
            // form (the split is purely structural; visible glyphs are
            // unchanged).
            assert(w.textContent === tokenWithSty.f,
                `split word's textContent matches the original ` +
                `("${w.textContent}" vs "${tokenWithSty.f}")`);
            // And the inner span must NOT contain the entire word --
            // that was the pre-fix bug (whole word scaled up).
            assert(innerText.length < (tokenWithSty.f || '').length,
                `.styLetter wraps a sub-run, not the whole word ` +
                `(inner length ${innerText.length} vs full length ` +
                `${(tokenWithSty.f || '').length})`);
        }
    }
}

// ---- Mon/Thu morning aliyah-stop diamonds ----
//
// The source text marks the weekday-reading break-points with
// `{שוח}` ("שני וחמישי") inline tags. The build script attaches
// `mt: true` to the LAST word before each marker, and the renderer
// stamps `data-mt="1"` on its .word span. CSS draws a small
// diamond after the word, gated by body.taamOn so it only appears
// when ta'amim are visible.
//
// Pre-fix: the build silently dropped `{שוח}` markers and the user
// had no way to see Mon/Thu stops in the app, despite the source
// data carrying them.
{
    const stopTokens = TORAH.tokens.filter(
        t => t && t.k === 'w' && t.mt === true);
    assert(stopTokens.length >= 3,
        `at least three Mon/Thu-stop tokens exist ` +
        `(found ${stopTokens.length}; Bereshit alone needs 3)`);
    if (stopTokens.length > 0) {
        const w = ctx.makeWordEl(stopTokens[0]);
        assert(w.getAttribute('data-mt') === '1',
            `makeWordEl stamps data-mt="1" on Mon/Thu-stop words`);
    }
    // Words WITHOUT mt must NOT carry the attribute.
    const plainWord = TORAH.tokens.find(
        t => t && t.k === 'w' && t.mt !== true);
    if (plainWord) {
        const wp = ctx.makeWordEl(plainWord);
        assert(wp.getAttribute('data-mt') === null,
            `plain words have no data-mt attribute`);
    }
    // Bereshit has stops at the end of יום אחד (1:5), יום שני (1:8),
    // and יום שלישי (1:13). Verify the FIRST stop word is "אֶחָד" (or
    // a variant ending in אֶחָד) — i.e. the last word of Gen 1:5.
    if (stopTokens.length > 0) {
        const firstStop = stopTokens[0];
        const formStripped = (firstStop.f || '').replace(/[\u0591-\u05C7\u05BD]/g, '');
        assert(formStripped.endsWith('אחד') || formStripped.endsWith('אחד׃'),
            `first Mon/Thu stop should be at "יום אחד" (Bereshit 1:5); ` +
            `got token form "${firstStop.f}"`);
    }
    // syncToggleBar() must reflect the global ta'am flag onto
    // <body> so the CSS rule body.taamOn .word[data-mt="1"]::after
    // can fire only in the modes the user picked.
    if (typeof ctx.syncToggleBar === 'function') {
        const before = body.classList.contains('taamOn');
        // Force ta'am ON.
        ctx.setGlobals({ nikud: true, taam: true });
        ctx.syncToggleBar();
        assert(body.classList.contains('taamOn'),
            `body gets .taamOn when ta'amim are globally enabled`);
        // Force ta'am OFF.
        ctx.setGlobals({ nikud: true, taam: false });
        ctx.syncToggleBar();
        assert(!body.classList.contains('taamOn'),
            `body loses .taamOn when ta'amim are globally disabled`);
        // Restore.
        ctx.setGlobals({ nikud: true, taam: before });
        ctx.syncToggleBar();
    }
}

// ---- Repack-on-toggle preserves position ----
//
// Spec (user-reported bug): when the user toggles ta'amim/nikud or
// taps a word/passuk, the column must be re-packed to the new
// per-word widths -- previously the engine only updated text
// inside the existing word spans, so line breaks and last-line
// justification stayed stale until a full reload.
//
// We test the GATING logic (without exercising the full re-pack,
// which depends on a real layout engine):
//   1. With NO getBoundingClientRect stub -> repack falls back to
//      refreshAllWords() (so headless tests don't crash and
//      element references stay valid).
//   2. With a stub on the readStage element -> repack calls
//      renderColumn(COLUMN_IDX, ...) instead of refreshAllWords().
//
// The browser verification of the actual visual re-pack is part
// of the manual / browser-driven smoke test (megilla.html and
// read.html were exercised in-tree).
{
    // Confirm the headless-fallback branch: with no rect-measure
    // available, calling repackPreservingPosition() must NOT throw,
    // and must update word text in place via refreshAllWords()
    // (verified earlier in the toggle tests above). This is a
    // smoke test that the no-op fallback path executes cleanly.
    let threw = false;
    try { ctx.repackPreservingPosition(); }
    catch (e) { threw = true; console.error('  repack threw:', e); }
    assert(!threw,
        `repackPreservingPosition() does not throw in headless mode`);

    // And confirm the gated re-pack path: when getBoundingClientRect
    // IS stubbed on the stage, repack should attempt a renderColumn.
    // We spy on renderColumn and stub the stage rect (the column
    // build itself will still use the headless DOM, which is
    // good enough to count the call).
    const stageEl = ctx.document.getElementById('readStage');
    if (stageEl) {
        stageEl.getBoundingClientRect = function () {
            return { top: 0, bottom: 800, left: 0, right: 600,
                     width: 600, height: 800 };
        };
        let renderCalls = 0;
        let lastIdx = null;
        const origRender = ctx.renderColumn;
        ctx.renderColumn = function (idx, scrollTo) {
            renderCalls++;
            lastIdx = idx;
            return origRender(idx, scrollTo);
        };
        const expectedIdx = ctx.COLUMN_IDX;
        ctx.repackPreservingPosition();
        assert(renderCalls === 1,
            `repackPreservingPosition() triggers exactly 1 renderColumn ` +
            `call when stage is measurable (got ${renderCalls})`);
        assert(lastIdx === expectedIdx,
            `repack re-renders the CURRENT column ` +
            `(got idx ${lastIdx}, want ${expectedIdx})`);
        // Restore.
        ctx.renderColumn = origRender;
        delete stageEl.getBoundingClientRect;
    }
}

// ---- Per-word override survives a column re-pack ----
//
// User-reported bug: after the toggle handlers were switched from
// refreshAllWords() to repackPreservingPosition(), tapping a word
// to cycle stam <-> taam <-> full did nothing in the live app.
// Root cause: the per-word override was only stored as a DOM
// attribute on the .word span, and repack rebuilds the column,
// destroying that span. The freshly-built span had no override,
// so the resolved mode reverted to the inherited (global) one.
// Fix: persist per-word overrides in the WORD_OV map keyed by
// data-tok-idx (the same key the renderer uses to scroll the
// anchor word back into view), and re-stamp the data-ov-* attrs
// on the new spans inside makeWordEl().
//
// This block exercises the survival contract directly.
{
    // The previous repack-stub block may have consumed/torn down the
    // column DOM. Build a fresh word span via the same helper the
    // renderer uses, and stamp a tok-idx so WORD_OV has a key.
    let firstWordTokIdx = -1;
    for (let i = 0; i < TORAH.tokens.length; i++) {
        if (TORAH.tokens[i].k === 'w') { firstWordTokIdx = i; break; }
    }
    assert(firstWordTokIdx >= 0, 'have at least one word token to test');
    const beforeWord = ctx.makeWordEl(TORAH.tokens[firstWordTokIdx], firstWordTokIdx);
    const tokIdx = beforeWord.getAttribute('data-tok-idx');
    assert(tokIdx === String(firstWordTokIdx),
        'word has data-tok-idx (precondition for WORD_OV)');

    ctx.clearAllOverrides();
    assert(Object.keys(ctx.WORD_OV).length === 0,
        'WORD_OV starts empty after clearAllOverrides');

    const next = ctx.cycleWordMode(beforeWord);
    assert(next === 'stam',
        `tap from full lands on stam (got "${next}")`);
    assert(ctx.WORD_OV[tokIdx] &&
           ctx.WORD_OV[tokIdx].nikud === 'off' &&
           ctx.WORD_OV[tokIdx].taam === 'off',
        `WORD_OV["${tokIdx}"] persisted as {nikud:off, taam:off}`);

    // Force a fresh build of the same word from scratch (this is
    // exactly what repackPreservingPosition() does in the real app
    // when a measurable readStage is present, just scoped to one
    // word for test simplicity). Use the headless makeWordEl path
    // so we can read the resulting attributes without depending on
    // getBoundingClientRect.
    const tk = TORAH.tokens[Number(tokIdx)];
    const rebuilt = ctx.makeWordEl(tk, Number(tokIdx));
    assert(rebuilt.getAttribute('data-ov-nikud') === 'off' &&
           rebuilt.getAttribute('data-ov-taam') === 'off',
        'rebuilt .word has data-ov-* restored from WORD_OV');
    const sVar = tk.s != null ? tk.s : tk.f;
    assert(rebuilt.textContent === sVar,
        `rebuilt .word renders stam variant after re-pack ` +
        `(got "${rebuilt.textContent}", want "${sVar}")`);

    ctx.clearAllOverrides();
}

// ---- Megilat Esther data integrity ----
//
// Esther is shipped as a sibling dataset (esther.json + esther_layout.json)
// rendered by the same engine via megilla.html, which aliases
// __TORAH_DATA__ = __ESTHER_DATA__ before tikunScript.js loads.
// This block validates the BUILD output, not the renderer (the
// renderer is exercised on Torah data above and reuses identical
// code paths). What we check:
//
//   1. esther.json exists, parses, and has plausible word counts.
//   2. Chapter / verse markers are present and in order.
//   3. The first chapter starts with "ויהי בימי אחשורוש" (Esther 1:1),
//      and the very last word ends with "זרעו" (Esther 10:3).
//   4. The setumah convention used in Haman's-sons list (chapter 9)
//      survives the build: at least one setumah token lives in the
//      last quarter of the stream.
{
    let estherJson;
    try {
        estherJson = readFileSync(
            resolve(repo, 'assets/html/data/esther.json'), 'utf8');
    } catch (e) {
        estherJson = null;
    }
    if (estherJson) {
        const ESTHER = JSON.parse(estherJson);
        const toks = ESTHER.tokens || [];
        const words = toks.filter(t => t && t.k === 'w');
        const chapters = toks.filter(t => t && t.k === 'chapter');
        const verses = toks.filter(t => t && t.k === 'verse');
        // Esther: 167 verses, 10 chapters, ~3000 words. We tolerate
        // small drifts in the verse count (the source uses a slightly
        // different chapter-end accounting than the masoretic text).
        assert(words.length > 2400 && words.length < 3200,
            `Esther word count is plausible (got ${words.length}, expected ~2700)`);
        assert(chapters.length === 10,
            `Esther has 10 chapter markers (got ${chapters.length})`);
        assert(verses.length >= 160,
            `Esther has at least 160 verse markers (got ${verses.length})`);
        // Chapter markers must be in ascending numerical order.
        const chapNums = chapters.map(t => t.num);
        const sorted = [...chapNums].sort((a, b) => a - b);
        assert(JSON.stringify(chapNums) === JSON.stringify(sorted),
            `Esther chapter markers are in ascending order ` +
            `(got [${chapNums.join(',')}])`);
        // First word: "ויהי" (1:1, "And it came to pass").
        const firstWord = words[0];
        const firstStripped = (firstWord.f || '').replace(/[\u0591-\u05C7\u05BD]/g, '');
        assert(firstStripped === 'ויהי',
            `first word of Esther is "ויהי" (got "${firstStripped}")`);
        // Last word: "לכל־זרעו" (10:3, "to all his offspring").
        // Joined by a maqaf, which the source preserves as part of the
        // single tokenized "word". We test the trailing form (after the
        // maqaf) since that's what's most distinctive.
        const lastWord = words[words.length - 1];
        const lastStripped = (lastWord.f || '').replace(/[\u0591-\u05C7\u05BD]/g, '');
        assert(lastStripped.endsWith('זרעו'),
            `last word of Esther ends with "זרעו" (got "${lastStripped}")`);
        // Setumah markers should exist (Haman's sons in 9:7-9 use a
        // distinctive setumah-between-words layout in tikun-style
        // megillot).
        const setumot = toks.filter(t => t && t.k === 'setumah');
        assert(setumot.length > 0,
            `Esther has at least one setumah marker (got ${setumot.length})`);
    } else {
        console.warn('  SKIP: esther.json not present (run build script first)');
    }
}

// ---- Shabbat-afternoon roll-forward in _upcomingShabbat ----
//
// Spec: when the user opens the app on a Saturday and the local
// clock is past 12:30 (≈ minha gedola, when the morning Torah
// reading is over for most communities), `_upcomingShabbat(today)`
// must return NEXT Saturday — not today — so the home-page
// "פרשת השבוע" button jumps to next week's parasha. Before noon
// on Saturday (or any weekday) it must still return today/the
// next Saturday respectively.
//
// We test the helper in isolation by loading calendar.js into a
// fresh vm.Context where the global Date is a fixed-clock stub.
{
    const calJs = readFileSync(
        resolve(repo, 'assets/html/js/calendar.js'), 'utf8');

    function makeFixedDateClass(fixedISO) {
        const fixedTime = new Date(fixedISO).getTime();
        return class extends Date {
            constructor(...args) {
                if (args.length === 0) {
                    super(fixedTime);
                } else {
                    super(...args);
                }
            }
            static now() { return fixedTime; }
        };
    }

    function runHelper(fixedNowISO, inputISO) {
        const sandbox = {
            console,
            module: { exports: {} },
            window: undefined,
            localStorage: undefined,
            HebcalLib: undefined,
            Date: makeFixedDateClass(fixedNowISO),
        };
        sandbox.global = sandbox;
        const ctx = vm.createContext(sandbox);
        vm.runInContext(calJs, ctx);
        const upcoming = sandbox.module.exports._upcomingShabbat;
        const input = new sandbox.Date(inputISO);
        const out = upcoming(input);
        return out;
    }

    // 1) Saturday MORNING (10:00) — should return today (the same Sat).
    //    2026-05-09 was a Saturday.
    {
        const r = runHelper('2026-05-09T10:00:00', '2026-05-09T10:00:00');
        assert(r.getDay() === 6,
            `Saturday morning: _upcomingShabbat returns a Saturday`);
        assert(r.toISOString().slice(0, 10) === '2026-05-09',
            `Saturday morning: returns the SAME Saturday ` +
            `(got ${r.toISOString().slice(0, 10)})`);
    }
    // 2) Saturday AFTERNOON (14:00, past 12:30) — must roll forward
    //    to NEXT Saturday (2026-05-16).
    {
        const r = runHelper('2026-05-09T14:00:00', '2026-05-09T14:00:00');
        assert(r.getDay() === 6,
            `Saturday afternoon: _upcomingShabbat returns a Saturday`);
        assert(r.toISOString().slice(0, 10) === '2026-05-16',
            `Saturday afternoon (>=12:30): rolls forward to NEXT Sat ` +
            `(got ${r.toISOString().slice(0, 10)}, expected 2026-05-16)`);
    }
    // 3) Saturday EXACTLY at 12:30 — counts as afternoon, rolls forward.
    {
        const r = runHelper('2026-05-09T12:30:00', '2026-05-09T12:30:00');
        assert(r.toISOString().slice(0, 10) === '2026-05-16',
            `Saturday at exactly 12:30: rolls forward to next Sat ` +
            `(got ${r.toISOString().slice(0, 10)})`);
    }
    // 4) Saturday at 12:29 — still morning, stays on today.
    {
        const r = runHelper('2026-05-09T12:29:00', '2026-05-09T12:29:00');
        assert(r.toISOString().slice(0, 10) === '2026-05-09',
            `Saturday at 12:29: stays on today's Sat ` +
            `(got ${r.toISOString().slice(0, 10)})`);
    }
    // 5) Friday (any time) — returns tomorrow (Sat).
    //    2026-05-08 was a Friday.
    {
        const r = runHelper('2026-05-08T20:00:00', '2026-05-08T20:00:00');
        assert(r.toISOString().slice(0, 10) === '2026-05-09',
            `Friday evening: returns the upcoming Saturday ` +
            `(got ${r.toISOString().slice(0, 10)})`);
    }
    // 6) Sunday — returns next Saturday (six days out).
    //    2026-05-10 was a Sunday.
    {
        const r = runHelper('2026-05-10T08:00:00', '2026-05-10T08:00:00');
        assert(r.toISOString().slice(0, 10) === '2026-05-16',
            `Sunday: returns next Saturday ` +
            `(got ${r.toISOString().slice(0, 10)})`);
    }
    // 7) Saturday afternoon, but caller passes an INPUT date that is
    //    NOT today — the strict "Saturday-of-input" answer must be
    //    preserved (no roll-forward), since this is how
    //    getUpcomingSpecialDays() resolves the parasha for a future
    //    event whose date happens to be a Saturday.
    {
        const fixedNow = '2026-05-09T14:00:00';        // Sat afternoon
        const future = '2026-05-23T08:00:00';          // a future Sat
        const r = runHelper(fixedNow, future);
        assert(r.toISOString().slice(0, 10) === '2026-05-23',
            `non-today Saturday input keeps strict mapping ` +
            `(got ${r.toISOString().slice(0, 10)}, expected 2026-05-23)`);
    }
}

console.log(`\n--- ${passes} passed, ${fails} failed ---`);
process.exit(fails === 0 ? 0 : 1);

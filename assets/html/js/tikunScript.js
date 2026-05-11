// ==================== TIKUN KORIM ====================
//
// Single continuous-reading view: one Torah-scroll column per screen, swipe
// to next column. The full text is loaded once from data/torah.json as a
// flat token stream, then sliced into columns at render time.
//
// Token kinds in torah.json:
//   {k:'sefer',  name, heb}            sefer boundary (4 blank lines)
//   {k:'parasha', name, heb}           inline parasha-name marker
//   {k:'aliyah',  num, heb}            inline aliyah-name marker
//   {k:'chapter', num}                 chapter number (no visual; for breadcrumb)
//   {k:'verse',   num}                 verse number (rendered, tappable)
//   {k:'w',  f, n, t, s}               word with all 4 display variants
//   {k:'petucha'}                      end-of-line gap (new line, prev short)
//   {k:'setumah'}                      mid-line gap (~9-char inline gap)
//
// Display variants per word, priority: word-override > verse-override > global.
//   "full"  = consonants + nikud + ta'amim
//   "nikud" = consonants + nikud only
//   "taam"  = consonants + ta'amim only
//   "stam"  = consonants only (real Torah scroll)
// Globals = (nikud:bool, taam:bool) -> mode.
// Per-verse / per-word override = explicit mode string in data-override.


// ==================== DIACRITICS UTILS ====================

function stripDiacritics(str) { return str.replace(/[\u0591-\u05C7]/g, ''); }
function stripCantillation(str) { return str.replace(/[\u0591-\u05AF]/g, ''); }
function stripVowels(str) {
    return str.replace(/[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C7]/g, '');
}
function hasNikud(str) {
    return /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C7]/.test(str);
}


// ==================== DISPLAY-MODE STATE ====================

var GLOBALS_KEY = 'tk_globals';
// Bumped from 'tk_lastColumn' (Phase 2/3) -> 'tk_lastColumn_v2' (Phase 4)
// since switching to the 245-column Davidovich layout invalidates any
// previously-saved column index.
// Default POS_KEY for the Torah view. Pages that reuse this engine
// for a different corpus (e.g. megilla.html for Megilat Esther) set
// `window.__POS_KEY_OVERRIDE__` BEFORE this script is loaded so the
// last-read column for each corpus is remembered independently and
// doesn't clobber the user's spot in the Torah scroll.
var POS_KEY = (typeof window !== 'undefined' && window.__POS_KEY_OVERRIDE__)
    ? window.__POS_KEY_OVERRIDE__
    : 'tk_lastColumn_v2';
var DEFAULT_GLOBALS = { nikud: true, taam: true };

function getGlobals() {
    try {
        var raw = localStorage.getItem(GLOBALS_KEY);
        if (!raw) return Object.assign({}, DEFAULT_GLOBALS);
        var g = JSON.parse(raw);
        if (typeof g.nikud !== 'boolean') g.nikud = true;
        if (typeof g.taam !== 'boolean') g.taam = true;
        return g;
    } catch (e) {
        return Object.assign({}, DEFAULT_GLOBALS);
    }
}
function setGlobals(g) { localStorage.setItem(GLOBALS_KEY, JSON.stringify(g)); }

// Variant key -> data-attr letter used in the DOM (compact for size)
var ATTR = { full: 'data-f', nikud: 'data-n', taam: 'data-t', stam: 'data-s' };


// ==================== APPLY DISPLAY ====================
//
// Per-element overrides are stored as independent flags for nikud and taam:
//   data-ov-nikud  = "on" | "off"   (presence = override; absence = inherit)
//   data-ov-taam   = "on" | "off"
// Resolution order per axis: word > verse > global.

// Verse-level overrides are stored centrally in VERSE_OV (keyed by
// "<chapter>:<verse>") since words from a single verse may span multiple
// .sLine rows in the column-grid layout.
var VERSE_OV = {};   // { "1:21": { nikud: 'on'|'off', taam: 'on'|'off' } }

// Per-word overrides survive column re-packs (which destroy and rebuild
// the .word DOM nodes) by living in this map, keyed by the stable
// data-tok-idx that makeWordEl stamps on every word. Without this,
// tapping a word cycled the inline data-ov-* attribute on a node that
// was about to be thrown away by repackPreservingPosition(), so the
// next render produced a fresh node with no override and the user's
// tap appeared to do nothing. makeWordEl re-applies the stored
// override after creating the node so the rendered mode matches.
var WORD_OV = {};   // { "<tokIdx>": { nikud: 'on'|'off', taam: 'on'|'off' } }

function verseKeyFromWord(span) {
    var v = span.getAttribute('data-verse');
    var c = span.getAttribute('data-chapter');
    if (!v) return null;
    return (c || '') + ':' + v;
}

function resolveAxis(span, axis, globalOn) {
    var attrName = 'data-ov-' + axis;
    if (span && span.hasAttribute(attrName)) {
        return span.getAttribute(attrName) === 'on';
    }
    var key = span ? verseKeyFromWord(span) : null;
    if (key && VERSE_OV[key] && VERSE_OV[key][axis]) {
        return VERSE_OV[key][axis] === 'on';
    }
    return globalOn;
}

function modeFromAxes(nikudOn, taamOn) {
    if (nikudOn && taamOn) return 'full';
    if (nikudOn && !taamOn) return 'nikud';
    if (!nikudOn && taamOn) return 'taam';
    return 'stam';
}

// Find the base Hebrew consonant `letter` inside `s` and return the
// index range [start, end) that covers the consonant PLUS any
// combining nikud / ta'amim / dagesh that visually attach to it
// (Unicode block U+0591..U+05C7 immediately following). This is the
// "letter run" we want to render at the rabbati / ze'ira size when
// the masoretic tradition enlarges or shrinks one specific letter
// inside a word (e.g. the final ן of "מִשְׁפָּטָן" in Bemidbar 27:5,
// or the ב of בְּרֵאשִׁית). Returns null if the consonant isn't found
// in `s` (which can legitimately happen for variants that strip
// combining marks but in Hebrew text the consonant itself is always
// preserved across all four display modes).
function findStyLetterRun(s, letter) {
    if (!s || !letter) return null;
    var idx = s.indexOf(letter);
    if (idx < 0) return null;
    var end = idx + 1;
    while (end < s.length) {
        var cc = s.charCodeAt(end);
        if (cc >= 0x0591 && cc <= 0x05C7) end++;
        else break;
    }
    return [idx, end];
}

function applyDisplayToWord(span, g) {
    var nikudOn = resolveAxis(span, 'nikud', g.nikud);
    var taamOn  = resolveAxis(span, 'taam',  g.taam);
    var mode = modeFromAxes(nikudOn, taamOn);
    var val;
    if (mode === 'stam') {
        // Plain consonants: prefer the kethiv (scroll spelling) when
        // we have it -- this is the text the reader actually sees on
        // the parchment. Falls back to `data-s` (the qere's plain
        // consonants) for the vast majority of words where kethiv
        // and qere are letter-identical and we therefore don't
        // bother stamping `data-ket`.
        val = span.getAttribute('data-ket');
        if (val == null) val = span.getAttribute('data-s');
    } else {
        val = span.getAttribute(ATTR[mode]);
    }
    if (val == null) val = span.getAttribute('data-f') || span.textContent;
    var styLetter = span.getAttribute('data-sty-letter');
    if (styLetter) {
        // Render with an inline <span class="styLetter"> wrapping just
        // the rabbati / ze'ira letter (and its combining marks). The
        // size override lives on .word .styLetter, not on .word
        // itself, so the surrounding text stays at the column's
        // global font-size and the line's total width is barely
        // perturbed.
        var run = findStyLetterRun(val, styLetter);
        if (run) {
            // Clear children explicitly (textContent reassignment is
            // an alternative but creates a slight flicker on iOS
            // WebView for large columns when called in a tight loop).
            while (span.firstChild) span.removeChild(span.firstChild);
            if (run[0] > 0) {
                span.appendChild(document.createTextNode(val.slice(0, run[0])));
            }
            var inner = document.createElement('span');
            inner.className = 'styLetter';
            inner.textContent = val.slice(run[0], run[1]);
            span.appendChild(inner);
            if (run[1] < val.length) {
                span.appendChild(document.createTextNode(val.slice(run[1])));
            }
            return;
        }
    }
    span.textContent = val;
}

function refreshAllWords() {
    var g = getGlobals();
    var words = document.getElementsByClassName('word');
    for (var i = 0; i < words.length; i++) {
        applyDisplayToWord(words[i], g);
    }
    syncToggleBar();
    syncOverrideHighlights();
}

// Find the topmost word currently visible in the reading viewport.
// Used by repackPreservingPosition() to re-anchor the scroll after a
// re-pack so the user keeps reading from the same spot. We pick the
// topmost word that's still in (or near) the viewport and remember
// BOTH its token index AND its y-offset relative to the stage's top
// edge. After the re-pack, repackPreservingPosition() restores the
// scroll so this same word lands at the same y -- without that
// offset, scrollColumnToToken() pins the anchor's line to the very
// top of the stage and the user sees the page jump up by however
// far the anchor was from the top before the tap.
//
// Returns null in headless / non-DOM-measure environments.
function findTopmostVisibleAnchor() {
    var stage = document.getElementById('readStage');
    if (!stage || typeof stage.getBoundingClientRect !== 'function') {
        return null;
    }
    var stageTop = stage.getBoundingClientRect().top;
    var words = (typeof stage.querySelectorAll === 'function')
        ? stage.querySelectorAll('[data-tok-idx]')
        : null;
    if (!words || !words.length) return null;
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < words.length; i++) {
        if (typeof words[i].getBoundingClientRect !== 'function') continue;
        var rect = words[i].getBoundingClientRect();
        // Skip words still entirely above the viewport (clipped) by
        // more than a line-height.
        if (rect.bottom < stageTop - 4) continue;
        var dist = Math.abs(rect.top - stageTop);
        if (dist < bestDist) {
            bestDist = dist;
            best = words[i];
        }
        // Past the top by a clear margin -> we've found the anchor;
        // no need to keep scanning further down the column.
        if (rect.top > stageTop + 4) break;
    }
    if (!best) return null;
    var ti = parseInt(best.getAttribute('data-tok-idx'), 10);
    if (!Number.isFinite(ti)) return null;
    // y-offset of the word's top edge relative to the stage's top
    // edge. Could be negative if the word is partially clipped at
    // the top -- repackPreservingPosition() will faithfully restore
    // that, so a half-visible top word stays half-visible.
    var bestRect = best.getBoundingClientRect();
    return {
        tokIdx: ti,
        yOffset: bestRect.top - stageTop,
    };
}

// Back-compat shim for any caller that just wants the token index.
function findTopmostVisibleTokenIdx() {
    var a = findTopmostVisibleAnchor();
    return a ? a.tokIdx : null;
}

// Re-pack and re-render the current column at the user's current
// scroll position. Used by toggle and tap handlers, where the
// per-mode glyph metrics change (with/without ta'amim, with/without
// nikud) so word widths shift -- which means line breaks, last-line
// justification, and the busiest-line-driven font size all need
// recalculation. Without this re-pack the existing layout is stale
// against the new metrics and lines visibly overflow / underflow.
//
// We anchor the post-re-pack scroll on the topmost visible word
// (captured BEFORE the re-render) so the user keeps reading from
// the same spot -- modulo a line or two of natural drift when the
// re-pack happens to push that word onto a different line.
//
// Headless / test harness: when getBoundingClientRect isn't
// available on the stage (no real layout engine, e.g. our Node
// fake DOM), we fall back to the cheap in-place refreshAllWords()
// path. Re-packing without measurements wouldn't produce a valid
// layout anyway, and rebuilding the DOM in tests would orphan the
// element references the tests hold.
function repackPreservingPosition() {
    if (typeof COLUMN_IDX !== 'number' || !COLUMNS) {
        refreshAllWords();
        return;
    }
    var stage = (typeof document !== 'undefined' && document.getElementById)
        ? document.getElementById('readStage') : null;
    var canMeasure = stage
        && typeof stage.getBoundingClientRect === 'function';
    if (!canMeasure) {
        refreshAllWords();
        return;
    }
    var anchor = findTopmostVisibleAnchor();
    // Force the global-font-size cache to rebuild so the busiest line
    // is re-measured under the new mode (a stam-only column has way
    // more horizontal slack than a full-vocalized one, so the font
    // can grow / shrink accordingly).
    GLOBAL_FONT_SIZE = 0;
    GLOBAL_FONT_AVAIL_WIDTH = 0;
    // Don't pass the token index to renderColumn(): its built-in
    // scrollColumnToToken() pins the anchor's line 8px below the
    // stage top, which yanks the page UP (the user reads this as
    // a scroll-jump after every tap). We restore the y-offset
    // ourselves so the same word stays at the same y.
    renderColumn(COLUMN_IDX);
    if (!anchor) return;
    function pinAnchor() {
        var stage2 = document.getElementById('readStage');
        if (!stage2 || typeof stage2.getBoundingClientRect !== 'function') return;
        var target = document.querySelector(
            '#readColumn [data-tok-idx="' + anchor.tokIdx + '"]');
        if (!target || typeof target.getBoundingClientRect !== 'function') return;
        var stageRect = stage2.getBoundingClientRect();
        var targetRect = target.getBoundingClientRect();
        // Where is the anchor now relative to the stage's top? Add
        // the delta to scrollTop so it lands back at the stored
        // pre-tap y. Positive delta -> scroll DOWN (the anchor is
        // currently HIGHER than where it was -> we need to push it
        // back down by scrolling further).
        var delta = (targetRect.top - stageRect.top) - anchor.yOffset;
        if (Math.abs(delta) > 0.5) stage2.scrollTop += delta;
    }
    // Match renderColumn()'s own three-phase scroll schedule so we
    // win the race against its scrollColumnToToken() callers (this
    // function passed no scrollToTokenIdx, so renderColumn won't
    // schedule any -- but the post-font refit also moves lines, so
    // we re-pin then too).
    setTimeout(pinAnchor, 0);
    if (typeof document !== 'undefined' && document.fonts &&
        document.fonts.ready) {
        document.fonts.ready.then(pinAnchor);
    }
    setTimeout(pinAnchor, 350);
}

function syncOverrideHighlights() {
    var words = document.getElementsByClassName('word');
    for (var j = 0; j < words.length; j++) {
        var w = words[j];
        var hasOwn = w.hasAttribute('data-ov-nikud') || w.hasAttribute('data-ov-taam');
        w.classList.toggle('wOverride', hasOwn);
        var key = verseKeyFromWord(w);
        var hasVerse = key && VERSE_OV[key] &&
                       (VERSE_OV[key].nikud || VERSE_OV[key].taam);
        w.classList.toggle('vOverride', !!hasVerse && !hasOwn);
    }
}

function syncToggleBar() {
    var g = getGlobals();
    var bN = document.getElementById('btnNikud');
    var bT = document.getElementById('btnTaam');
    if (bN) bN.classList.toggle('active', !!g.nikud);
    if (bT) bT.classList.toggle('active', !!g.taam);
    // Reflect the global ta'amim state on <body> so CSS rules can
    // light up the Mon/Thu stop diamonds (.word[data-mt="1"]) only
    // when ta'amim are actually being shown.
    if (document.body) {
        document.body.classList.toggle('taamOn',  !!g.taam);
        document.body.classList.toggle('nikudOn', !!g.nikud);
    }
}

// Top-bar nikud / ta'am toggles. Mode change shifts EVERY word's
// rendered width (with / without nikud, with / without ta'amim), so
// after flipping the global flag we re-pack the current column --
// not just rewrite text inside the existing word spans, which would
// leave line breaks and last-line justification stale (lines
// visibly overflow or come up short until the user reloads).
function toggleNikud() {
    var g = getGlobals(); g.nikud = !g.nikud; setGlobals(g);
    syncToggleBar();
    repackPreservingPosition();
}
function toggleTaam() {
    var g = getGlobals(); g.taam = !g.taam; setGlobals(g);
    syncToggleBar();
    repackPreservingPosition();
}
function clearAllOverrides() {
    VERSE_OV = {};
    WORD_OV = {};
    var words = document.getElementsByClassName('word');
    for (var j = 0; j < words.length; j++) {
        words[j].removeAttribute('data-ov-nikud');
        words[j].removeAttribute('data-ov-taam');
    }
    repackPreservingPosition();
}

// Cycle the visible mode of a single word through:
//     stam (nothing) -> taam -> taam+nikud -> stam
// We compute the next mode from the word's currently resolved mode,
// then write per-word overrides so it renders that way. If the chosen
// mode happens to equal the inherited (verse + global) mode, we strip
// the per-word overrides so the word stays "clean" and continues to
// follow global toggles.
var WORD_CYCLE = ['stam', 'taam', 'full'];

function inheritedAxesForWord(wordEl) {
    var g = getGlobals();
    var key = verseKeyFromWord(wordEl);
    var nikudOn, taamOn;
    if (key && VERSE_OV[key] && VERSE_OV[key].nikud) {
        nikudOn = VERSE_OV[key].nikud === 'on';
    } else {
        nikudOn = g.nikud;
    }
    if (key && VERSE_OV[key] && VERSE_OV[key].taam) {
        taamOn = VERSE_OV[key].taam === 'on';
    } else {
        taamOn = g.taam;
    }
    return { nikud: nikudOn, taam: taamOn };
}

function applyModeToWord(wordEl, mode) {
    var inh = inheritedAxesForWord(wordEl);
    var wantNikud = (mode === 'full');
    var wantTaam  = (mode === 'taam' || mode === 'full');
    var ti = wordEl.getAttribute('data-tok-idx');
    var rec = (ti != null) ? (WORD_OV[ti] || {}) : null;
    if (wantNikud === inh.nikud) {
        wordEl.removeAttribute('data-ov-nikud');
        if (rec) delete rec.nikud;
    } else {
        wordEl.setAttribute('data-ov-nikud', wantNikud ? 'on' : 'off');
        if (rec) rec.nikud = wantNikud ? 'on' : 'off';
    }
    if (wantTaam === inh.taam) {
        wordEl.removeAttribute('data-ov-taam');
        if (rec) delete rec.taam;
    } else {
        wordEl.setAttribute('data-ov-taam', wantTaam ? 'on' : 'off');
        if (rec) rec.taam = wantTaam ? 'on' : 'off';
    }
    if (ti != null) {
        if (rec.nikud || rec.taam) WORD_OV[ti] = rec;
        else delete WORD_OV[ti];
    }
    applyDisplayToWord(wordEl, getGlobals());
    syncOverrideHighlights();
}

function cycleWordMode(wordEl) {
    var g = getGlobals();
    var nikudOn = resolveAxis(wordEl, 'nikud', g.nikud);
    var taamOn  = resolveAxis(wordEl, 'taam',  g.taam);
    var current = modeFromAxes(nikudOn, taamOn);
    // Map any out-of-cycle current mode (e.g. 'nikud' alone) to the
    // nearest cycle entry so the next step is still predictable.
    var idx = WORD_CYCLE.indexOf(current);
    if (idx === -1) {
        idx = (current === 'nikud') ? WORD_CYCLE.indexOf('full')
                                    : WORD_CYCLE.indexOf('stam');
    }
    var next = WORD_CYCLE[(idx + 1) % WORD_CYCLE.length];
    // First, persist the chosen override on the tapped word. We
    // pre-compute the verse key so we can find this word again
    // AFTER the column re-pack rebuilds the DOM.
    var key = verseKeyFromWord(wordEl);
    var ti = wordEl.getAttribute('data-tok-idx');
    applyModeToWord(wordEl, next);
    // Then re-pack the column. A single-word width change can ripple
    // through the line it lives on (and any line after it whose
    // contents shifted), so the previous "in-place" approach left
    // visibly broken justification on the affected lines until
    // reload. The re-pack also keeps the global font-size in sync
    // when the busiest line was the one this word sits on.
    repackPreservingPosition();
    return next;
}

function clearWordOverride(wordEl) {
    wordEl.removeAttribute('data-ov-nikud');
    wordEl.removeAttribute('data-ov-taam');
    var ti = wordEl.getAttribute('data-tok-idx');
    if (ti != null) delete WORD_OV[ti];
    // Drop the per-word override and re-pack so the line and
    // last-line justification snap back to the inherited mode.
    repackPreservingPosition();
}

// Cycle the visible mode of a whole verse (addressed by chapter:verse)
// through stam -> taam -> taam+nikud -> stam. Per-word overrides on the
// same verse take precedence and remain untouched.
function cycleVerseModeByKey(verseKey) {
    if (!verseKey) return null;
    var g = getGlobals();
    var rec = VERSE_OV[verseKey] || {};
    var nikudOn = rec.nikud ? (rec.nikud === 'on') : g.nikud;
    var taamOn  = rec.taam  ? (rec.taam  === 'on') : g.taam;
    var current = modeFromAxes(nikudOn, taamOn);
    var idx = WORD_CYCLE.indexOf(current);
    if (idx === -1) {
        idx = (current === 'nikud') ? WORD_CYCLE.indexOf('full')
                                    : WORD_CYCLE.indexOf('stam');
    }
    var next = WORD_CYCLE[(idx + 1) % WORD_CYCLE.length];
    var wantNikud = (next === 'full');
    var wantTaam  = (next === 'taam' || next === 'full');

    if (wantNikud === g.nikud) delete rec.nikud;
    else rec.nikud = wantNikud ? 'on' : 'off';
    if (wantTaam === g.taam) delete rec.taam;
    else rec.taam = wantTaam ? 'on' : 'off';

    if (Object.keys(rec).length === 0) delete VERSE_OV[verseKey];
    else VERSE_OV[verseKey] = rec;

    // Re-pack the column. Verse-level cycling toggles ta'amim/nikud
    // for every word in the verse at once, which shifts widths across
    // a whole pasuk -- the lines those words live on need new packing
    // and the global busiest-line font size may move. The renderer
    // re-reads VERSE_OV during makeWordEl/applyDisplayToWord so the
    // override persists across the rebuild.
    repackPreservingPosition();
    return next;
}


// ==================== DATA + COLUMNS ====================
//
// Phase 4: load layout.json (the 245-column / 42-line Davidovich standard
// scraped from ahavativrit.com and anchored into our torah.json) and use
// its real column boundaries. We still keep a word-count fallback so
// development continues to work even without layout.json.

var TORAH = null;             // { sefarim, tokens }
var LAYOUT = null;            // { columns: [...], linesPerColumn, ... }
var COLUMNS = null;           // [{start, end, sefer, parasha, aliyah, chapter, verse, ...}]
var COLUMN_IDX = 0;
var LINES_PER_COLUMN = 42;
var WORDS_PER_COLUMN_FALLBACK = 320;

// Prefer the globals injected by data/torah.js & data/layout.js
// (see read.html). Those work everywhere -- including file:// URLs
// where browsers refuse fetch(). The fetch() fallback stays in place
// for older builds that only ship the JSON.
function loadTorah() {
    if (typeof window !== 'undefined' && window.__TORAH_DATA__) {
        return Promise.resolve(window.__TORAH_DATA__);
    }
    return fetch('./data/torah.json').then(function (r) {
        if (!r.ok) throw new Error('torah.json fetch failed: ' + r.status);
        return r.json();
    });
}

function loadLayout() {
    if (typeof window !== 'undefined' && window.__LAYOUT_DATA__) {
        return Promise.resolve(window.__LAYOUT_DATA__);
    }
    return fetch('./data/layout.json').then(function (r) {
        if (!r.ok) return null;
        return r.json();
    }).catch(function () { return null; });
}

function buildColumns(tokens, layout) {
    // Prefer the real layout (245 Davidovich columns) when available;
    // otherwise fall back to a word-count heuristic.
    if (layout && layout.columns && layout.columns.length > 0) {
        return buildColumnsFromLayout(tokens, layout);
    }
    return buildColumnsByWordCount(tokens);
}

function buildColumnsFromLayout(tokens, layout) {
    var cols = [];
    var lc = layout.columns;

    function ctxAt(tokenIdx, endIdx) {
        var sefer = null, seferHeb = null;
        var parasha = null, parashaHeb = null;
        var aliyah = null, aliyahHeb = null;
        var chapter = null, verse = null;
        // Walk all tokens up to and including tokenIdx, then keep
        // walking through any leading meta-only tokens (no `w` yet)
        // so that a column whose first content is preceded by
        // sefer/parasha/aliyah/chapter/verse markers picks them up.
        var stopHard = (typeof endIdx === 'number') ? endIdx : tokens.length;
        for (var j = 0; j < stopHard; j++) {
            var tk = tokens[j];
            if (j > tokenIdx && tk.k === 'w') break;
            switch (tk.k) {
                case 'sefer':
                    sefer = tk.name; seferHeb = tk.heb;
                    parasha = null; parashaHeb = null;
                    aliyah = null;  aliyahHeb = null;
                    break;
                case 'parasha':
                    parasha = tk.name; parashaHeb = tk.heb;
                    aliyah = null; aliyahHeb = null;
                    break;
                case 'aliyah':
                    aliyah = tk.num; aliyahHeb = tk.heb;
                    break;
                case 'chapter':
                    chapter = tk.num;
                    break;
                case 'verse':
                    verse = tk.num;
                    break;
            }
        }
        return { sefer: sefer, seferHeb: seferHeb,
                 parasha: parasha, parashaHeb: parashaHeb,
                 aliyah: aliyah, aliyahHeb: aliyahHeb,
                 chapter: chapter, verse: verse };
    }

    for (var i = 0; i < lc.length; i++) {
        var entry = lc[i];
        var ctx = ctxAt(entry.start, entry.end);
        cols.push({
            colNum: entry.col,
            start: entry.start,
            end: entry.end,
            sefer: ctx.sefer, seferHeb: ctx.seferHeb,
            parasha: ctx.parasha, parashaHeb: ctx.parashaHeb,
            aliyah: ctx.aliyah, aliyahHeb: ctx.aliyahHeb,
            chapter: ctx.chapter, verse: ctx.verse,
            bookBreakAfter: !!entry.bookBreakAfter,
            specialPoetry: !!entry.specialPoetry,
            leadingText: entry.leadingText || '',
            // Per-line word lists for OCR-derived columns. May be null
            // for the handful of columns we couldn't OCR-anchor — those
            // fall back to the measurement-based packer.
            lines: entry.lines || null,
        });
    }
    return cols;
}

function buildColumnsByWordCount(tokens) {
    var cols = [];
    var startIdx = 0;
    var wordCount = 0;
    var ctx = { sefer: null, seferHeb: null, parasha: null, parashaHeb: null,
                aliyah: null, aliyahHeb: null, chapter: null, verse: null };
    var startCtx = Object.assign({}, ctx);
    function pushCol(endIdx) {
        if (endIdx <= startIdx) return;
        cols.push({
            colNum: cols.length + 1,
            start: startIdx, end: endIdx,
            sefer: startCtx.sefer, seferHeb: startCtx.seferHeb,
            parasha: startCtx.parasha, parashaHeb: startCtx.parashaHeb,
            aliyah: startCtx.aliyah, aliyahHeb: startCtx.aliyahHeb,
            chapter: startCtx.chapter, verse: startCtx.verse,
            bookBreakAfter: false, specialPoetry: false, leadingText: '',
        });
        startIdx = endIdx;
        wordCount = 0;
        startCtx = Object.assign({}, ctx);
    }
    for (var i = 0; i < tokens.length; i++) {
        var tk = tokens[i];
        switch (tk.k) {
            case 'sefer':
                if (wordCount > 0) pushCol(i);
                ctx.sefer = tk.name; ctx.seferHeb = tk.heb;
                ctx.parasha = null; ctx.parashaHeb = null;
                ctx.aliyah = null;  ctx.aliyahHeb = null;
                break;
            case 'parasha':
                ctx.parasha = tk.name; ctx.parashaHeb = tk.heb;
                break;
            case 'aliyah':
                ctx.aliyah = tk.num; ctx.aliyahHeb = tk.heb;
                break;
            case 'chapter':
                ctx.chapter = tk.num;
                break;
            case 'verse':
                ctx.verse = tk.num;
                break;
            case 'w':
                if (wordCount === 0) startCtx = Object.assign({}, ctx);
                wordCount++;
                if (wordCount >= WORDS_PER_COLUMN_FALLBACK) pushCol(i + 1);
                break;
            case 'petucha':
                pushCol(i + 1);
                break;
        }
    }
    pushCol(tokens.length);
    return cols;
}


// ==================== COLUMN RENDERING ====================
//
// A column is a stack of 42 horizontally-justified lines. We don't have
// the exact word-per-line list from the Davidovich layout, so we *measure*:
// we walk the column's tokens one word at a time, dropping each word into
// the current line; if adding the word would overflow the line, we start
// a new line. Petucha = end-of-line + a fully-blank line. Setumah = a
// fixed-width inline gap (~9 character widths). Each line is a flex row
// styled "justify-content: space-between" so the line is rubber-band-
// stretched edge-to-edge of the column.
//
// Verse numbers and aliyah labels live in a fixed-width right-margin
// gutter that is OUTSIDE the line grid, so they don't affect line wrapping.

function renderColumn(idx, scrollToTokenIdx) {
    var stage = document.getElementById('readColumn');
    if (!stage) return;
    if (!TORAH || !COLUMNS) return;
    if (idx < 0) idx = 0;
    if (idx >= COLUMNS.length) idx = COLUMNS.length - 1;
    COLUMN_IDX = idx;
    try { localStorage.setItem(POS_KEY, String(idx)); } catch (e) {}

    var col = COLUMNS[idx];

    // Build everything inside an off-screen wrapper first, so we can run
    // line-fit measurement before swapping it in.
    stage.innerHTML = "";

    // Optional sefer marker at top
    var firstTok = TORAH.tokens[col.start];
    if (firstTok && firstTok.k === 'sefer') {
        var hd = document.createElement('div');
        hd.className = 'seferMarker';
        hd.textContent = firstTok.heb || '';
        stage.appendChild(hd);
    }

    // Compose the column body.
    var body = document.createElement('div');
    body.className = 'scrollColumn';
    body.setAttribute('data-col-num', String(col.colNum || (idx + 1)));
    stage.appendChild(body);

    // Gather the items to lay out (words + breaks + verse-anchors). For
    // each token in [col.start, col.end) we either:
    //   - emit a word "item" carrying word DOM + verse/aliyah anchors
    //   - emit a "petucha" item (forces line break + blank line)
    //   - emit a "setumah" item (inline gap)
    //   - aliyah/sefer/parasha tokens become side-channel events that
    //     decorate the next word.
    var items = [];
    var pendingVerseStart = null;     // {chapter, verse} only on the first word of a verse
    var currentChapter = col.chapter;
    var currentVerse = col.verse;
    var pendingAliyahHeb = null;
    for (var i = col.start; i < col.end; i++) {
        var tk = TORAH.tokens[i];
        switch (tk.k) {
            case 'chapter': currentChapter = tk.num; break;
            case 'verse':
                currentVerse = tk.num;
                pendingVerseStart = { chapter: currentChapter, verse: currentVerse };
                break;
            case 'aliyah':
                pendingAliyahHeb = tk.heb;
                break;
            case 'parasha':
                items.push({ kind: 'parasha', heb: tk.heb });
                break;
            case 'sefer':
                if (i !== col.start) {
                    items.push({ kind: 'sefer', heb: tk.heb });
                }
                break;
            case 'w':
                items.push({
                    kind: 'word',
                    tok: tk,
                    tokIdx: i,
                    chapter: currentChapter,
                    verse: currentVerse,
                    verseStart: pendingVerseStart,
                    aliyahLabel: pendingAliyahHeb,
                });
                pendingVerseStart = null;
                pendingAliyahHeb = null;
                break;
            case 'petucha':
                items.push({ kind: 'petucha' });
                break;
            case 'setumah':
                items.push({ kind: 'setumah' });
                break;
        }
    }

    // OCR-anchored column? Render lines from pre-computed shapes
    // (every line's word-list is exactly the line on the ahavativrit
    // image). Otherwise, the engine measures and packs greedily.
    var hasOCR = !!(col.lines && col.lines.length > 0);
    if (hasOCR) {
        // Use a SINGLE global font-size for every column. We compute
        // it once (on the first OCR render) by finding the busiest
        // line across the whole layout and shrinking just enough so
        // it fits the available width. Re-using the same size for
        // every column means the user never sees the font jump
        // between pages.
        var preferredFs = computeGlobalFontSize(body);
        if (preferredFs > 0) {
            var sColEl = body.querySelector('.scrollColumn') || body;
            sColEl.style.fontSize = preferredFs.toFixed(1) + 'px';
        }
        layoutLinesFromOCR(body, items, col);
    } else {
        layoutLines(body, items, col);
    }
    // Re-render the column once webfonts settle. This ALWAYS matters:
    // the first packing pass measures word widths against whatever font
    // is currently loaded, which may be the system-fallback Hebrew font
    // if DrugulinCLM (async @font-face) hasn't arrived yet. After fonts
    // load:
    //   - on the OCR path: re-fit the font-size so the pre-baked line
    //     shapes still fit in DrugulinCLM metrics.
    //   - on the engine-fallback path: the line breaks chosen by the
    //     greedy packer are now wrong (they were computed in a
    //     different font), so we re-run the entire layout with
    //     DrugulinCLM widths.
    var refit = function () {
        if (hasOCR) {
            // After the real Hebrew font finishes loading, re-compute
            // the global font-size from scratch (its metrics may have
            // shifted) and apply it. This keeps every column at the
            // same size and re-positions the gutter marks accordingly.
            GLOBAL_FONT_SIZE = 0;
            var newFs = computeGlobalFontSize(body);
            if (newFs > 0) {
                var sCol2 = body.querySelector('.scrollColumn') || body;
                var oldFs = parseFloat(getComputedStyle(sCol2).fontSize);
                if (Math.abs(newFs - oldFs) >= 0.5) {
                    sCol2.style.fontSize = newFs.toFixed(1) + 'px';
                }
                // Re-apply kashida with the new metrics. Clear any
                // previous inline kashida styles + state classes
                // first so the recomputation starts from a clean
                // slate (otherwise stale flex-start markers from a
                // larger font would persist after a font shrink).
                var lns2 = body.querySelector('.sColLines');
                if (lns2) {
                    var oldRows = lns2.getElementsByClassName('sLine');
                    for (var ri = 0; ri < oldRows.length; ri++) {
                        var or = oldRows[ri];
                        or.style.letterSpacing = '';
                        or.style.columnGap = '';
                        or.style.fontSize = '';
                        if (or.classList) {
                            or.classList.remove('sLineKashidaCap');
                            or.classList.remove('sLineKashidaTight');
                        }
                    }
                    applyKashidaSpacing(lns2);
                }
            }
            // ALWAYS re-pin gutter marks after fonts settle, even when
            // the font size did NOT change. The first layoutGutter()
            // call in layoutLinesFromOCR() runs before webfonts arrive,
            // so the line-rect measurements include the system Hebrew
            // fallback's larger metrics; once DrugulinCLM finishes
            // loading, the .sLine offsets shift but the gutter entries
            // would otherwise still point at the pre-font-load
            // positions. The user sees this as verse numbers drifting
            // BELOW the matching passuk further down the column.
            var gut = body.querySelector('.sColGutter');
            var lns = body.querySelector('.sColLines');
            if (gut && lns && lns.__gutterMarks) {
                layoutGutter(gut, lns, lns.__gutterMarks);
            }
        } else {
            // Engine-fallback path: rebuild lines with the now-correct
            // font metrics. Clear the previous attempt first.
            var sCol3 = body.querySelector('.scrollColumn') || body;
            var grid = sCol3.querySelector('.sColGrid');
            if (grid) grid.parentNode.removeChild(grid);
            layoutLines(body, items, col);
            refreshAllWords();
        }
    };
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(refit);
    }
    setTimeout(refit, 250);

    refreshAllWords();
    updateBreadcrumb();
    updateColInfo();
    updateNavButtons();

    // Snap scroll to top of column (or to the requested token if the
    // jump asked for a specific spot inside the column, e.g. Balak's
    // start which sits at the bottom of col 179).
    var stageWrap = document.getElementById('readStage');
    if (stageWrap) stageWrap.scrollTop = 0;
    if (typeof scrollToTokenIdx === 'number') {
        // Wait one tick so the just-rendered DOM (and its post-font
        // refit, which may have moved lines around) settles before we
        // measure positions.
        setTimeout(function () { scrollColumnToToken(scrollToTokenIdx); }, 0);
        // And once again after webfonts settle, since the line the
        // target sits on may have shifted vertically when the global
        // font-size was re-fit.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                scrollColumnToToken(scrollToTokenIdx);
            });
        }
        setTimeout(function () { scrollColumnToToken(scrollToTokenIdx); }, 350);
    }
}

function makeWordEl(tk, tokIdx) {
    var w = document.createElement('span');
    w.className = 'word';
    w.setAttribute('data-f', tk.f);
    // Only stamp the variant attributes when the build script
    // actually emitted that variant. The build omits e.g. `n` when
    // stripping taamim leaves the word unchanged (true for words
    // with no taamim at all, like `אֶת`, `וְכָל`, `אֶל` -- these are
    // very common in maqaf pairs). Calling
    // setAttribute('data-n', undefined) coerces undefined to the
    // string "undefined", which then gets read back by
    // applyDisplayToWord() in nikud-only / taam-only / stam mode and
    // rendered as the literal text "undefined".
    if (typeof tk.n === 'string') w.setAttribute('data-n', tk.n);
    if (typeof tk.t === 'string') w.setAttribute('data-t', tk.t);
    if (typeof tk.s === 'string') w.setAttribute('data-s', tk.s);
    // Kri/Ketiv: `ket` is the WRITTEN form (scroll spelling) when it
    // differs in CONSONANTS from the read form. The plain mode (no
    // nikud, no taamim) should render the kethiv -- that's the
    // text the reader sees on the parchment. The other three modes
    // keep using `f` / `n` / `t`, which are the voweled qere (the
    // way the reader's voice actually pronounces the word). See
    // scripts/patch_kri_ketiv.py for how this field is populated.
    if (typeof tk.ket === 'string') w.setAttribute('data-ket', tk.ket);
    if (tk.sty) w.setAttribute('data-sty', tk.sty);
    // styLetter names the specific base consonant that the masoretic
    // tradition enlarges / shrinks within this word. We hand it to
    // applyDisplayToWord so it can split that one letter into a
    // sized inner <span> per display mode. (Stamping it here keeps
    // the build-time decision local to the data layer; the renderer
    // doesn't need to know anything about WHICH letters are special,
    // just where to split.)
    if (typeof tk.styLetter === 'string') {
        w.setAttribute('data-sty-letter', tk.styLetter);
    }
    // Mon/Thu morning aliyah-stop marker (otiyot Shin-Vav-Het in the
    // masoretic markup, "שני וחמישי"). The actual diamond is drawn
    // by CSS as a ::after on .word[data-mt="1"], gated by the body's
    // .taamOn class -- so the marker only appears in the modes where
    // ta'amim are visible (full / taam-only).
    if (tk.mt === true) {
        w.setAttribute('data-mt', '1');
    }
    if (typeof tokIdx === 'number') {
        // Used by goToColumnByTokenIndex() to scroll a specific word
        // into view after rendering the column. Without this, jumps to
        // a parasha that starts mid-column (e.g. Balak with its inline
        // setumah at the bottom of col 179) land the user at the TOP
        // of the column, where the previous parasha's text still is.
        w.setAttribute('data-tok-idx', String(tokIdx));
        // Restore any per-word override that was set BEFORE the most
        // recent column re-pack. Without this, tapping a word to
        // cycle stam <-> taam <-> full would write the override on
        // a span that was about to be destroyed by
        // repackPreservingPosition(); the freshly-built span had no
        // override, so the word reverted to its inherited mode and
        // the tap appeared to do nothing. WORD_OV survives the
        // rebuild because it's a JS object on the renderer scope.
        var ov = WORD_OV[String(tokIdx)];
        if (ov) {
            if (ov.nikud) w.setAttribute('data-ov-nikud', ov.nikud);
            if (ov.taam)  w.setAttribute('data-ov-taam',  ov.taam);
        }
    }
    // Initial render: route through applyDisplayToWord so the
    // styLetter split happens at construction time (not just on
    // toggle), AND so any restored data-ov-* override is honored.
    // The default mode is the global state, which on first render is
    // whatever the user last picked (or the app default).
    var hasOv = w.hasAttribute('data-ov-nikud') || w.hasAttribute('data-ov-taam');
    if (typeof tk.styLetter === 'string' || hasOv) {
        applyDisplayToWord(w, getGlobals());
    } else {
        w.textContent = tk.f;
    }
    return w;
}

function makeLineEl() {
    var ln = document.createElement('div');
    ln.className = 'sLine';
    return ln;
}

function makeBlankLineEl() {
    var ln = document.createElement('div');
    ln.className = 'sLine sLineBlank';
    return ln;
}

function makeSetumahGap() {
    var sp = document.createElement('span');
    sp.className = 'sSetumah';
    sp.innerHTML = '&nbsp;';
    return sp;
}

// Minimum visible inter-word gap, in pixels. Even the busiest line
// must keep this much space between consecutive words.
// Minimum visible gap between words. Must match the CSS `column-gap` on
// .sLine (currently 0.4em -> ~6.4px at the 16px base, plus a safety
// margin for rendering rounding). Used by the font-size pre-measure
// pass so it shrinks the column enough that the busiest line still has
// room for a real visible gap between every word.
var MIN_INTERWORD_GAP_PX = 8;

// Pre-render measurement: build a hidden ruler inside the column,
// stuff it with the words for each text line, and measure their
// natural rendered widths. Returns the font-size (in CSS px) that the
// column should use so the busiest line fits in the available width.
//
// `body` is the .readColumn element; the column body and gutter haven't
// been added yet. We build a temporary scaffold to get a representative
// `availWidth`.
// Cached global font-size. Computed once on the first column render
// and reused for every subsequent column so the text size stays
// uniform across the whole humash. Reset to 0 on resize.
var GLOBAL_FONT_SIZE = 0;
var GLOBAL_FONT_AVAIL_WIDTH = 0;

function computeGlobalFontSize(body) {
    if (typeof getComputedStyle === 'undefined') return 16;
    if (!COLUMNS || !TORAH || !TORAH.tokens) return 16;

    // Build a temp scaffold to learn the available column width.
    var sCol = document.createElement('div');
    sCol.className = 'scrollColumn';
    sCol.style.visibility = 'hidden';
    sCol.style.position = 'absolute';
    sCol.style.left = '0';
    sCol.style.right = '0';
    var grid = document.createElement('div');
    grid.className = 'sColGrid';
    var gutter = document.createElement('div');
    gutter.className = 'sColGutter';
    var linesEl = document.createElement('div');
    linesEl.className = 'sColLines';
    grid.appendChild(gutter);
    grid.appendChild(linesEl);
    sCol.appendChild(grid);
    body.appendChild(sCol);

    var availWidth = linesEl.clientWidth;
    var basePx = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--fontSizeIvrit')
    ) || 16;
    sCol.style.fontSize = basePx + 'px';

    // Use cached value if it's still valid (no resize).
    if (GLOBAL_FONT_SIZE > 0 && GLOBAL_FONT_AVAIL_WIDTH === availWidth) {
        body.removeChild(sCol);
        return GLOBAL_FONT_SIZE;
    }

    // Pick a TARGET line for sizing.  Originally we sized for the
    // absolute-busiest line in the whole Torah so every line fit at
    // the global font with zero per-line scaling. That worked, but
    // it made the busiest line (col 78 score=105) drag the global
    // font down by ~30% vs the typical (median ~64) line, leaving
    // most lines with so much slack that even modest kashida looked
    // strained.  Instead we now size for the ~95th percentile
    // busiest line: the bulk of the Torah fits with little slack
    // (and reads naturally) while a small handful of outlier lines
    // get tightened down separately by negative letter-spacing in
    // `applyKashidaSpacing` -- a sub-px adjustment the eye doesn't
    // register, unlike the visible per-line font-size variation
    // that an earlier shrinking strategy produced.
    //
    // Visual units count maqaf-pairs as one (e.g. "עַל־כֵּן" is 1
    // unit visually, even though it holds two word tokens).
    var allLines = [];
    for (var ci = 0; ci < COLUMNS.length; ci++) {
        var col = COLUMNS[ci];
        if (!col.lines) continue;
        for (var li = 0; li < col.lines.length; li++) {
            var ld = col.lines[li];
            if (ld.kind !== 'text' && ld.kind !== 'shirah') continue;
            if (!ld.words || ld.words.length < 2) continue;
            var chars = 0;
            var units = 0;
            for (var wi = 0; wi < ld.words.length; wi++) {
                var tk = TORAH.tokens[ld.words[wi].i];
                if (tk && tk.f) chars += tk.f.length;
                if (tk && tk.mq && wi + 1 < ld.words.length) {
                    units++;
                    wi++;
                } else {
                    units++;
                }
            }
            var segCount = (ld.segments && ld.segments.length) || 1;
            var penalty = (ld.kind === 'shirah') ? 4 * (segCount - 1) : 0;
            var score = chars + penalty + units;
            allLines.push({
                score: score,
                words: ld.words,
                segCount: segCount,
                isShirah: (ld.kind === 'shirah'),
            });
        }
    }
    if (!allLines.length) {
        body.removeChild(sCol);
        GLOBAL_FONT_SIZE = basePx;
        GLOBAL_FONT_AVAIL_WIDTH = availWidth;
        return basePx;
    }
    allLines.sort(function (a, b) { return b.score - a.score; });
    // p~95 by index (5% of lines exceed this width and tighten via
    // negative letter-spacing). Roughly 475 lines out of ~9.5k.
    // Matches the existing comment intent; the previous 0.025 was
    // a more conservative 97.5%-ile that left most lines visibly
    // under-filled, which the kashida pass had to spread into wide
    // inter-word gaps.
    var pickIdx = Math.min(allLines.length - 1,
        Math.max(0, Math.floor(allLines.length * 0.05)));
    var target = allLines[pickIdx];
    var worstWords = target.words;
    var worstSegCount = target.segCount;
    var worstIsShirah = target.isShirah;

    var ruler = document.createElement('div');
    ruler.style.cssText =
        'white-space:nowrap;display:inline-block;visibility:hidden;' +
        'position:absolute;left:-99999px;';
    sCol.appendChild(ruler);
    // Render the busiest line into the ruler using the same maqaf-pair
    // grouping the real DOM uses, so the measurement reflects how the
    // line will actually be laid out (no inter-word gap inside a pair,
    // a slim maqaf glyph instead).
    var html = '';
    for (var wi2 = 0; wi2 < worstWords.length; wi2++) {
        var tk2 = TORAH.tokens[worstWords[wi2].i];
        if (!tk2 || !tk2.f) continue;
        if (tk2.mq && wi2 + 1 < worstWords.length) {
            var nextTk = TORAH.tokens[worstWords[wi2 + 1].i];
            if (nextTk && nextTk.f) {
                html += '<span class="maqafPair">' +
                          '<span class="word">' + escapeHtml(tk2.f) + '</span>' +
                          '<span class="maqafGlyph">\u05BE</span>' +
                          '<span class="word">' + escapeHtml(nextTk.f) + '</span>' +
                        '</span>';
                wi2++;
                continue;
            }
        }
        html += '<span class="word">' + escapeHtml(tk2.f) + '</span>';
    }
    ruler.innerHTML = html;
    // Sum the widths of visual units (a .maqafPair counts as one item,
    // its inner words+glyph already contribute to its offsetWidth).
    var pairs = ruler.getElementsByClassName('maqafPair');
    var loose = [];
    var allWords = ruler.getElementsByClassName('word');
    for (var s = 0; s < allWords.length; s++) {
        var p = allWords[s].parentElement;
        if (!p || !p.classList || !p.classList.contains('maqafPair')) {
            loose.push(allWords[s]);
        }
    }
    var sumW = 0;
    for (var pi = 0; pi < pairs.length; pi++) sumW += pairs[pi].offsetWidth;
    for (var li2 = 0; li2 < loose.length; li2++) sumW += loose[li2].offsetWidth;
    var unitCount = pairs.length + loose.length;
    var nGaps = Math.max(0, unitCount - 1) +
        (worstIsShirah ? 4 * Math.max(0, worstSegCount - 1) : 0);
    var natural = sumW + MIN_INTERWORD_GAP_PX * nGaps;

    body.removeChild(sCol);

    var fs = basePx;
    if (availWidth >= 50 && natural > 0 && natural > availWidth) {
        var minFs = 9;
        fs = Math.max(minFs, basePx * (availWidth / natural) * 0.97);
    }
    GLOBAL_FONT_SIZE = fs;
    GLOBAL_FONT_AVAIL_WIDTH = availWidth;
    return fs;
}


function preMeasureColumnFontSize(body, items, col) {
    if (typeof getComputedStyle === 'undefined') return 16;  // node test
    var basePx = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--fontSizeIvrit')
    ) || 16;

    // Create a temp scaffold that mirrors the real layout (gutter +
    // lines container) so the available width is correct.
    var grid = document.createElement('div');
    grid.className = 'sColGrid';
    grid.style.visibility = 'hidden';
    grid.style.position = 'absolute';
    grid.style.left = '0';
    grid.style.right = '0';
    var gutter = document.createElement('div');
    gutter.className = 'sColGutter';
    var linesEl = document.createElement('div');
    linesEl.className = 'sColLines';
    grid.appendChild(gutter);
    grid.appendChild(linesEl);
    // Need a parent that has the right width: use scrollColumn.
    var sCol = document.createElement('div');
    sCol.className = 'scrollColumn';
    sCol.style.fontSize = basePx + 'px';
    sCol.appendChild(grid);
    body.appendChild(sCol);

    var availWidth = linesEl.clientWidth;
    // Ruler element: a single-line span for measuring each line's
    // natural concatenated word widths.
    var ruler = document.createElement('div');
    ruler.style.cssText =
        'white-space:nowrap;display:inline-block;visibility:hidden;' +
        'position:absolute;left:-99999px;';
    sCol.appendChild(ruler);

    // Fast token-idx -> word item lookup (same logic as render path).
    var wordItems = [];
    for (var k = 0; k < items.length; k++) {
        if (items[k].kind === 'word') wordItems.push(items[k]);
    }
    var itemByIdx = {};
    var seq = 0;
    for (var i = col.start; i < col.end; i++) {
        var tk = TORAH.tokens[i];
        if (tk && tk.k === 'w' && seq < wordItems.length) {
            itemByIdx[String(i)] = wordItems[seq++];
        }
    }

    var maxNatural = 0;
    for (var li = 0; li < col.lines.length; li++) {
        var ld = col.lines[li];
        if (ld.kind === 'shirah') {
            // For shirah lines we measure each segment's natural width
            // separately and demand the line as a whole fits assuming
            // a small minimum gap between segments. The visual gap is
            // larger when there is slack, but for sizing purposes a
            // ~3-char wide gap per segment-boundary is a safe lower
            // bound (otherwise segments touch).
            var html2 = '';
            var segCounts = ld.segments || [(ld.words || []).length];
            for (var wi2 = 0; wi2 < ld.words.length; wi2++) {
                var meta2 = itemByIdx[String(ld.words[wi2].i)];
                if (!meta2) continue;
                html2 += '<span class="word">' + escapeHtml(meta2.tok.f) + '</span>';
            }
            ruler.innerHTML = html2;
            var spans2 = ruler.getElementsByClassName('word');
            var sumW2 = 0;
            for (var s2 = 0; s2 < spans2.length; s2++) sumW2 += spans2[s2].offsetWidth;
            var nGaps = (spans2.length - 1) + 4 * Math.max(0, segCounts.length - 1);
            var natural2 = sumW2 + MIN_INTERWORD_GAP_PX * nGaps;
            if (natural2 > maxNatural) maxNatural = natural2;
            continue;
        }
        if (ld.kind !== 'text' || ld.words.length < 2) continue;
        var html = '';
        for (var wi = 0; wi < ld.words.length; wi++) {
            var meta = itemByIdx[String(ld.words[wi].i)];
            if (!meta) continue;
            html += '<span class="word">' + escapeHtml(meta.tok.f) + '</span>';
        }
        ruler.innerHTML = html;
        var spans = ruler.getElementsByClassName('word');
        var sumW = 0;
        for (var s = 0; s < spans.length; s++) sumW += spans[s].offsetWidth;
        var natural = sumW + MIN_INTERWORD_GAP_PX * (spans.length - 1);
        if (natural > maxNatural) maxNatural = natural;
    }

    // Tear down the scaffold.
    body.removeChild(sCol);

    if (availWidth < 50 || maxNatural <= 0) return basePx;
    if (maxNatural <= availWidth) return basePx;
    // Shrink uniformly so the busiest line fits, then drop another 3%
    // for visible inter-word breathing room.
    var scale = (availWidth / maxNatural) * 0.97;
    var minFs = 9;  // never go smaller than this
    var nextFs = Math.max(minFs, basePx * scale);
    return nextFs;
}

// (remeasureAndScale was removed: the per-line shrink in
// `shrinkOverflowingLines` replaces the column-wide rescale, and the
// post-fontsload refit re-runs both `computeGlobalFontSize` and
// `shrinkOverflowingLines` so we don't need the old whole-column
// rescale path anymore.)

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


// Render a column from a pre-computed list of line shapes (each line
// is either a list of word token-indices or a `blank` placeholder).
// This bypasses the engine's measurement-based packer and produces an
// EXACT match to the ahavativrit.com photograph for the column.
//
// `items` is the same flat list that `layoutLines` consumes; we reuse
// it to recover per-word metadata (verse-start, aliyah-label, chapter,
// verse) that isn't stored in `col.lines`. The mapping is by absolute
// token-index `i`.
function layoutLinesFromOCR(host, items, col) {
    var grid = document.createElement('div');
    grid.className = 'sColGrid';
    var lines = document.createElement('div');
    lines.className = 'sColLines';
    var gutter = document.createElement('div');
    gutter.className = 'sColGutter';
    grid.appendChild(gutter);
    grid.appendChild(lines);
    host.appendChild(grid);

    // Build a fast lookup from token-idx -> item meta.
    var itemByIdx = {};
    for (var k = 0; k < items.length; k++) {
        var it = items[k];
        if (it.kind === 'word' && it.tok) {
            itemByIdx[String(it.tok.idx)] = it;
        }
    }
    // Word tokens don't carry their own absolute index; build the
    // lookup by walking col [start, end) and pairing each `w` token
    // with the next word `item`.
    var wordItems = [];
    for (var fi = 0; fi < items.length; fi++) {
        if (items[fi].kind === 'word') wordItems.push(items[fi]);
    }
    var seq = 0;
    for (var i = col.start; i < col.end; i++) {
        var tk = TORAH.tokens[i];
        if (tk && tk.k === 'w' && seq < wordItems.length) {
            itemByIdx[String(i)] = wordItems[seq];
            seq++;
        }
    }

    var gutterMarks = [];

    // Render each line.
    //
    // `kind: 'blank'` entries: OCR emits a blank for every petucha
    // break, but the Davidovich Stam standard does NOT render mid-
    // column blank rows. The petucha is rendered purely by the
    // previous line ending short and the next line starting fresh.
    // So we skip blank entries when rendering, but USE their presence
    // to mark the preceding text line as `sLineEndShort`.
    for (var li = 0; li < col.lines.length; li++) {
        var ld = col.lines[li];
        if (ld.kind === 'blank') continue;

        // seferBreak: render the 4-line "ארבעה שיטין" halachic gap
        // between books. The new sefer's name (e.g. "במדבר") sits
        // centered just below the gap. The previous text line was
        // already marked sLineEndShort by the parser's blank handling
        // -- but as a safety, mark the most recent rendered text line
        // as end-short here.
        if (ld.kind === 'seferBreak') {
            var lastLine = lines.lastElementChild;
            if (lastLine && lastLine.classList.contains('sLine')) {
                lastLine.classList.add('sLineEndShort');
            }
            var sg = document.createElement('div');
            sg.className = 'seferGap';
            lines.appendChild(sg);
            if (ld.heb) {
                var sm = document.createElement('div');
                sm.className = 'seferMarker';
                sm.textContent = ld.heb;
                lines.appendChild(sm);
            }
            continue;
        }

        // Shirah (special-poetry) lines render as 1-3 inline segments
        // separated by wide gaps. Each segment is a flex item; the line
        // itself uses justify-content: space-between (or center / flex-
        // end depending on segment count) so the segments are pushed to
        // the column edges with auto whitespace between them.
        if (ld.kind === 'shirah') {
            var lineEl = makeLineEl();
            lineEl.classList.add('sLineShirah');
            var segs = ld.segments || [(ld.words || []).length];
            if (segs.length === 1) {
                lineEl.classList.add('sLineShirahCenter');
            }
            // Build each segment as a flex sub-row.
            var segIdx = 0;
            var inSeg = 0;
            var segEl = document.createElement('div');
            segEl.className = 'sShirahSeg';
            var emitSeg = function() {
                lineEl.appendChild(segEl);
                segEl = document.createElement('div');
                segEl.className = 'sShirahSeg';
                segIdx++;
                inSeg = 0;
            };
            for (var swi = 0; swi < ld.words.length; swi++) {
                var swDesc = ld.words[swi];
                if (swDesc.segBreak && inSeg > 0) {
                    emitSeg();
                }
                var smeta = itemByIdx[String(swDesc.i)];
                if (!smeta) continue;
                // Maqaf pair inside a shirah segment.
                if (smeta.tok && smeta.tok.mq && swi + 1 < ld.words.length) {
                    var snDesc = ld.words[swi + 1];
                    var snMeta = itemByIdx[String(snDesc.i)];
                    if (snMeta && !snDesc.segBreak) {
                        var spair = document.createElement('span');
                        spair.className = 'maqafPair';
                        var sw1 = makeWordEl(smeta.tok, smeta.tokIdx);
                        if (smeta.chapter != null) sw1.setAttribute('data-chapter', String(smeta.chapter));
                        if (smeta.verse != null)   sw1.setAttribute('data-verse',   String(smeta.verse));
                        if (smeta.verseStart)      sw1.setAttribute('data-verse-start', '1');
                        if (smeta.aliyahLabel)     sw1.setAttribute('data-aliyah-label', smeta.aliyahLabel);
                        spair.appendChild(sw1);
                        var sglyph = document.createElement('span');
                        sglyph.className = 'maqafGlyph';
                        sglyph.textContent = '\u05BE';
                        spair.appendChild(sglyph);
                        var sw2 = makeWordEl(snMeta.tok, snMeta.tokIdx);
                        if (snMeta.chapter != null) sw2.setAttribute('data-chapter', String(snMeta.chapter));
                        if (snMeta.verse != null)   sw2.setAttribute('data-verse',   String(snMeta.verse));
                        if (snMeta.verseStart)      sw2.setAttribute('data-verse-start', '1');
                        if (snMeta.aliyahLabel)     sw2.setAttribute('data-aliyah-label', snMeta.aliyahLabel);
                        spair.appendChild(sw2);
                        segEl.appendChild(spair);
                        inSeg++;
                        if (smeta.verseStart) {
                            gutterMarks.push({
                                lineIdx: li,
                                verse: smeta.verseStart.verse,
                                chapter: smeta.verseStart.chapter,
                                aliyah: smeta.aliyahLabel || null,
                                wordEl: sw1,
                            });
                        }
                        if (snMeta.verseStart) {
                            gutterMarks.push({
                                lineIdx: li,
                                verse: snMeta.verseStart.verse,
                                chapter: snMeta.verseStart.chapter,
                                aliyah: snMeta.aliyahLabel || null,
                                wordEl: sw2,
                            });
                        }
                        swi++;
                        continue;
                    }
                }
                var sw = makeWordEl(smeta.tok, smeta.tokIdx);
                if (smeta.chapter != null) sw.setAttribute('data-chapter', String(smeta.chapter));
                if (smeta.verse != null)   sw.setAttribute('data-verse',   String(smeta.verse));
                if (smeta.verseStart)      sw.setAttribute('data-verse-start', '1');
                if (smeta.aliyahLabel)     sw.setAttribute('data-aliyah-label', smeta.aliyahLabel);
                segEl.appendChild(sw);
                inSeg++;
                if (smeta.verseStart) {
                    gutterMarks.push({
                        lineIdx: li,
                        verse: smeta.verseStart.verse,
                        chapter: smeta.verseStart.chapter,
                        aliyah: smeta.aliyahLabel || null,
                        wordEl: sw,
                    });
                }
            }
            if (inSeg > 0) lineEl.appendChild(segEl);
            lines.appendChild(lineEl);
            continue;
        }

        var lineEl = makeLineEl();
        var lineHasSetumahGap = false;
        var setumahEls = [];
        for (var wi = 0; wi < ld.words.length; wi++) {
            var wDesc = ld.words[wi];
            var meta = itemByIdx[String(wDesc.i)];
            if (!meta) continue;
            if (wDesc.sg) {
                for (var s = 0; s < wDesc.sg; s++) {
                    var gap = makeSetumahGap();
                    setumahEls.push(gap);
                    lineEl.appendChild(gap);
                }
                lineHasSetumahGap = true;
            }
            // Maqaf-joined word: render this word + the next word as a
            // single visual unit ("עַל־כֵּן") so the line's flex layout
            // treats them as one and `space-between` doesn't split the
            // pair with a wide gap. Each word remains its own .word
            // span for per-word interactivity.
            if (meta.tok && meta.tok.mq && wi + 1 < ld.words.length) {
                var nextDesc = ld.words[wi + 1];
                var nextMeta = itemByIdx[String(nextDesc.i)];
                if (nextMeta) {
                    var pair = document.createElement('span');
                    pair.className = 'maqafPair';
                    var pw1 = makeWordEl(meta.tok, meta.tokIdx);
                    if (meta.chapter != null) pw1.setAttribute('data-chapter', String(meta.chapter));
                    if (meta.verse != null)   pw1.setAttribute('data-verse',   String(meta.verse));
                    if (meta.verseStart)      pw1.setAttribute('data-verse-start', '1');
                    if (meta.aliyahLabel)     pw1.setAttribute('data-aliyah-label', meta.aliyahLabel);
                    pair.appendChild(pw1);
                    var pglyph = document.createElement('span');
                    pglyph.className = 'maqafGlyph';
                    pglyph.textContent = '\u05BE';
                    pair.appendChild(pglyph);
                    var pw2 = makeWordEl(nextMeta.tok, nextMeta.tokIdx);
                    if (nextMeta.chapter != null) pw2.setAttribute('data-chapter', String(nextMeta.chapter));
                    if (nextMeta.verse != null)   pw2.setAttribute('data-verse',   String(nextMeta.verse));
                    if (nextMeta.verseStart)      pw2.setAttribute('data-verse-start', '1');
                    if (nextMeta.aliyahLabel)     pw2.setAttribute('data-aliyah-label', nextMeta.aliyahLabel);
                    pair.appendChild(pw2);
                    lineEl.appendChild(pair);
                    if (meta.verseStart) {
                        gutterMarks.push({
                            lineIdx: li,
                            verse: meta.verseStart.verse,
                            chapter: meta.verseStart.chapter,
                            aliyah: meta.aliyahLabel || null,
                            wordEl: pw1,
                        });
                    }
                    if (nextMeta.verseStart) {
                        gutterMarks.push({
                            lineIdx: li,
                            verse: nextMeta.verseStart.verse,
                            chapter: nextMeta.verseStart.chapter,
                            aliyah: nextMeta.aliyahLabel || null,
                            wordEl: pw2,
                        });
                    }
                    wi++;
                    continue;
                }
            }
            var w = makeWordEl(meta.tok, meta.tokIdx);
            if (meta.chapter != null) w.setAttribute('data-chapter', String(meta.chapter));
            if (meta.verse != null)   w.setAttribute('data-verse',   String(meta.verse));
            if (meta.verseStart)      w.setAttribute('data-verse-start', '1');
            if (meta.aliyahLabel)     w.setAttribute('data-aliyah-label', meta.aliyahLabel);
            lineEl.appendChild(w);
            if (meta.verseStart) {
                gutterMarks.push({
                    lineIdx: li,
                    verse: meta.verseStart.verse,
                    chapter: meta.verseStart.chapter,
                    aliyah: meta.aliyahLabel || null,
                    wordEl: w,
                });
            }
        }
        // The next descriptor is a blank (= petucha) -> this line is
        // the end of a paragraph -> short.
        if (li + 1 < col.lines.length && col.lines[li + 1].kind === 'blank') {
            lineEl.classList.add('sLineEndShort');
        }
        // Any setumah gap (leading or mid-line) means a paragraph
        // boundary lives inside this line. The two halves should not
        // be stretched across the full width by space-between.
        if (lineHasSetumahGap) {
            lineEl.classList.add('sLineEndShort');
            // Make the setumah gap absorb the line's slack so post-
            // setumah words sit at the line-end (left in RTL). The gap
            // keeps a 6ch minimum; it only grows when there is leftover
            // space on a short line.
            for (var gi = 0; gi < setumahEls.length; gi++) {
                setumahEls[gi].classList.add('sSetumahFlex');
            }
        }
        // Source has petucha/setumah AFTER this line's last word
        // (paragraph break that doesn't get its own blank-line
        // descriptor) -> short.
        //
        // CRITICAL: bound the lookahead by `col.end`. Otherwise, on
        // the LAST line of a column we walk into the NEXT column's
        // tokens, where there's almost always a petucha/setumah/
        // chapter/parasha marker before the next word -- and we'd
        // wrongly tag the column's bottom line as short. Net effect
        // pre-fix: every column's last line rendered ragged-left
        // instead of full-justified, even though no paragraph
        // break actually lived inside this column. We cap the scan
        // at col.end so a column boundary is NOT treated as a
        // paragraph boundary (which it isn't -- the next column
        // continues the same paragraph).
        if (ld.words && ld.words.length > 0) {
            var lastIdx = ld.words[ld.words.length - 1].i;
            for (var ti2 = lastIdx + 1; ti2 < col.end; ti2++) {
                var tk2 = TORAH.tokens[ti2];
                if (!tk2) break;
                if (tk2.k === 'w') break;
                if (tk2.k === 'petucha' || tk2.k === 'setumah') {
                    lineEl.classList.add('sLineEndShort');
                    break;
                }
            }
        }
        // NOTE: we INTENTIONALLY do NOT tag the last text line of the
        // column as sLineEndShort. The user wants the bottom-of-column
        // line to render edge-to-edge like the rest of the column
        // (otherwise it looks misaligned vs. the lines above). Only
        // *real* paragraph breaks (petucha/setumah) keep the ragged
        // end; a column boundary is not a paragraph boundary.
        lines.appendChild(lineEl);
    }

    // After every line is in the DOM, distribute each line's leftover
    // slack into letter-spacing within its words (Stam-style kashida
    // stretch). This keeps inter-word gaps tight without changing
    // any line's font-size, so the page is uniform top-to-bottom.
    applyKashidaSpacing(lines);

    // Save gutterMarks on the lines container so refit can call
    // layoutGutter() again after font-size changes.
    lines.__gutterMarks = gutterMarks;
    layoutGutter(gutter, lines, gutterMarks);
}

// Walk every rendered .sLine and absorb any leftover horizontal slack
// into per-line `letter-spacing` instead of letting `space-between`
// stretch the gaps between words. This mimics how a Sefer Torah is
// justified -- the Stam scribe widens specific kashida-letterforms
// to fill the line, NOT the space between words.
//
// We never change a line's font-size (that would create visible
// inconsistency between adjacent lines on the same page). Lines stay
// at the global size; only letter-spacing varies.
//
// `linesEl` is the .sColLines element that contains all .sLine rows.
function applyKashidaSpacing(linesEl) {
    if (!linesEl || !linesEl.getElementsByClassName) return;
    if (typeof getComputedStyle === 'undefined') return;
    var availWidth = linesEl.clientWidth;
    if (!availWidth || availWidth < 50) return;
    var rows = linesEl.getElementsByClassName('sLine');
    // FIRST PASS: find the worst per-line shrink factor needed
    // (after applying the global per-line letter-spacing compression).
    // If any line still overflows even at full compression, we shrink
    // the WHOLE COLUMN uniformly so every row stays at the same
    // visual size. Per-line font-size variance produced an ugly
    // "small line / big line" striping pattern which we explicitly
    // do NOT want.
    //
    // The prose cap is 1.5px/letter -- enough to absorb the natural
    // 1-2 outlier prose lines per column without triggering the
    // column-wide shrink, yet still imperceptible visually (Hebrew
    // letter pairs at -1.5px keep their distinct shapes; only at
    // ~-2.5px do dagesh dots and shva pairs start to merge).
    var COMPRESS_CAP_GLOBAL = 1.5;
    var minColScale = 1.0;
    for (var pi = 0; pi < rows.length; pi++) {
        var prow = rows[pi];
        if (!prow.classList) continue;
        if (prow.classList.contains('sLineEndShort')) continue;
        if (prow.classList.contains('sLineBlank')) continue;
        var pSumW = 0;
        var pLetters = 0;
        var pIsShirah = prow.classList.contains('sLineShirah');
        var pKids = prow.children;
        for (var pj = 0; pj < pKids.length; pj++) {
            var pCh = pKids[pj];
            if (!pCh.classList) continue;
            var isUnit =
                pCh.classList.contains('word') ||
                pCh.classList.contains('maqafPair') ||
                pCh.classList.contains('sSetumah') ||
                (pIsShirah && pCh.classList.contains('sShirahSeg'));
            if (!isUnit) continue;
            pSumW += pCh.offsetWidth;
            if (pCh.classList.contains('sSetumah')) continue;
            var pTxt = pCh.textContent || '';
            var pBase = pTxt.replace(/[\u0591-\u05C7]/g, '')
                            .replace(/[^\u05D0-\u05EA]/g, '');
            pLetters += pBase.length;
        }
        if (pLetters < 2) continue;
        // Choose a letter-spacing budget for this line. Shira
        // tolerates more compression than prose without looking
        // cramped (its words read as breath-units inside each
        // segment, and the visible rhythm comes from the wide
        // gaps BETWEEN segments, not within them). Shira can
        // therefore self-fit at -2px/letter, which is enough
        // to avoid forcing a column-wide font shrink even on
        // the longest line of shirat hayam ("נטית ימינך
        // תבלעמו ארץ"). Prose stays at -1px/letter so the
        // dagesh / shuruq / shva combinations don't visibly
        // collide.
        var perLineCap = pIsShirah ? 2.0 : COMPRESS_CAP_GLOBAL;
        // Estimate width after applying maximum letter-spacing
        // compression. If still over the column, we need a font
        // shrink. Reserve 6px safety: column padding can swallow
        // 1-2px of the text edge and we want a couple of pixels
        // of breathing room for the per-line letter compression
        // we'll do later (which doesn't always reach the full
        // per-line cap on dagesh-heavy / shuruq-heavy lines).
        // Anything more aggressive than that turns the column
        // shrink into the dominant strategy and undoes the whole
        // point of the per-line letter-spacing pass.
        var pCompW = pSumW - perLineCap * pLetters;
        if (pCompW > availWidth - 6) {
            var pScale = (availWidth - 6) / pCompW;
            if (pScale < minColScale) minColScale = pScale;
        }
    }
    if (minColScale < 1.0) {
        // Add a small extra safety; letter widths don't scale
        // perfectly linearly with font-size in DrugulinCLM,
        // especially for the heavier diacritic-stacking glyphs
        // (cantillation marks above + nikkud below + dagesh
        // inside). 3% (i.e. ~0.5-1px on a typical column) is
        // enough to absorb the non-linearity without producing
        // a visibly-smaller column. The earlier 10% safety
        // shrunk Beshalach's shirat-hayam column to ~70% of the
        // regular size even though only one prose line was
        // overflowing by a couple of pixels -- way too
        // aggressive a response to a tiny overflow.
        var safeScale = minColScale * 0.97;
        if (safeScale < 0.6) safeScale = 0.6;
        // Apply the shrink to the whole .scrollColumn so all
        // child rows scale uniformly. (Earlier per-line shrink
        // produced visually-jarring "tall row / short row"
        // striping across the column.) The global -webkit-text-
        // size-adjust:100% rule on `html` keeps Android WebView
        // from re-inflating our shrunk size back to the original.
        var sCol = linesEl.parentElement
            ? linesEl.parentElement.parentElement
            : null;
        if (sCol && sCol.classList && sCol.classList.contains('scrollColumn')) {
            var curFs = parseFloat(getComputedStyle(sCol).fontSize) || 16;
            var shrunkFs = curFs * safeScale;
            if (shrunkFs >= 9) {
                sCol.style.fontSize = shrunkFs.toFixed(1) + 'px';
            }
        }
        if (linesEl.offsetHeight) {/* force reflow */}
    }
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row.classList) continue;
        // sLineEndShort uses flex-start (words flow naturally with a
        // small fixed gap); we leave them alone so the paragraph-end
        // ragged-edge look is preserved.
        if (row.classList.contains('sLineEndShort')) continue;
        // sLineShirah: segment-based layout, normally lets the gaps
        // between 1-3 segments absorb the slack. BUT for ~5% outlier
        // shirah lines (e.g. the busiest brick of Shirat HaYam at the
        // global p95-sized font), the SUM of segment widths can
        // exceed availWidth, which under flex-nowrap causes the line
        // to overflow off the column's start edge (RTL = left). For
        // those, tighten with negative letter-spacing on each segment
        // exactly like the prose path -- visually invisible
        // (sub-pixel per letter) and keeps the segments inside the
        // column. Same compression cap (1.0px) so letters never
        // visibly merge.
        if (row.classList.contains('sLineShirah')) {
            var segs = row.children;
            var sumSeg = 0;
            var letters = 0;
            for (var sj = 0; sj < segs.length; sj++) {
                var seg = segs[sj];
                if (!seg.classList || !seg.classList.contains('sShirahSeg')) continue;
                sumSeg += seg.offsetWidth;
                var stxt = seg.textContent || '';
                var sbase = stxt.replace(/[\u0591-\u05C7]/g, '')
                                .replace(/[^\u05D0-\u05EA]/g, '');
                letters += sbase.length;
            }
            // Shira lines tolerate more letter compression than
            // prose without becoming visually cramped: the words
            // inside a segment already read as a single breath
            // unit, so squeezing them by an extra ~1px each is
            // imperceptible and lets the line self-fit without
            // forcing the column-level font shrink (which would
            // affect EVERY row in the column, including the prose
            // and gutter). Cap at 2.0px (vs. prose's 1.5px).
            if (sumSeg > availWidth - 3 && letters > 1) {
                var sDeficit = sumSeg - (availWidth - 3);
                var SHIRAH_CAP = 2.0;
                var sCompressPx = sDeficit / letters;
                if (sCompressPx > SHIRAH_CAP) sCompressPx = SHIRAH_CAP;
                row.style.letterSpacing = '-' + sCompressPx.toFixed(2) + 'px';
                // Per-line safety net (see prose branch below for
                // rationale): if even max compression didn't quite
                // fit, shrink this single row's font-size by a few
                // percent so the last segment doesn't clip.
                if (row.scrollWidth > availWidth - 2) {
                    var sFit = (availWidth - 2) / row.scrollWidth;
                    if (sFit > 0.85 && sFit < 1) {
                        var sRowFs = parseFloat(getComputedStyle(row).fontSize) || 16;
                        row.style.fontSize = (sRowFs * sFit * 0.99).toFixed(1) + 'px';
                    }
                }
            }
            continue;
        }
        if (row.classList.contains('sLineBlank')) continue;
        // Sum widths of direct flex children (.word, .maqafPair,
        // .sSetumah) and count base Hebrew letters within them.
        var sumW = 0;
        var unitCount = 0;
        var totalLetters = 0;
        var kids = row.children;
        for (var k = 0; k < kids.length; k++) {
            var ch = kids[k];
            if (!ch.classList) continue;
            if (ch.classList.contains('word') ||
                ch.classList.contains('maqafPair') ||
                ch.classList.contains('sSetumah')) {
                sumW += ch.offsetWidth;
                unitCount++;
                if (ch.classList.contains('sSetumah')) continue;
                // Count base Hebrew letters (strip nikud + ta'amim).
                var text = ch.textContent || '';
                var base = text.replace(/[\u0591-\u05C7]/g, '')
                               .replace(/[^\u05D0-\u05EA]/g, '');
                totalLetters += base.length;
            }
        }
        if (unitCount < 2 || totalLetters < 2) continue;
        var fsPx = parseFloat(getComputedStyle(row).fontSize) || 16;
        var nGaps = unitCount - 1;
        // Total horizontal slack to distribute. We reserve ~3px of
        // safety margin to absorb sub-pixel rounding errors that
        // would otherwise push the last word past the column edge
        // (the "letters hidden at the line end" bug -- in RTL the
        // last visual word sits at the column's LEFT edge, which is
        // also where overflow-x:hidden on .readStage would clip).
        var slack = availWidth - sumW - 3;
        if (slack <= 0) {
            // Line is overfull at the global font size (one of the
            // ~5% outlier lines that exceed the p95 used for global
            // sizing). Apply a negative letter-spacing to compress
            // the letters just enough to make it fit. This is a
            // sub-pixel adjustment per letter -- visually invisible,
            // unlike per-line font-size shrinking which produces
            // jarring "small line / big line" alternation.
            //
            // First-pass cap is -1.0px per letter; if even that
            // can't fit, we fall back to shrinking the line's
            // font-size (per-line) by the small fraction needed to
            // fit. We prefer letter-spacing because it's invisible,
            // but font-size shrink is the only fully reliable
            // last-resort: a `sLineKashidaCap` flex-start fallback
            // looks fine on prose lines that are slightly short on
            // slack, but it actively *clips* the last word when the
            // deficit is bigger than what compression can absorb
            // (which happens on long-line columns like Beshalach's
            // pre-Shirat-HaYam prose at the global p95 font).
            var deficit = -slack;
            // Match the column-level pre-pass cap (1.5px) so a
            // line that the pre-pass decided didn't need a column
            // shrink can actually fit at this same compression
            // budget. Without matching, the per-line cap (was
            // 1.0px) was tighter than what the pre-pass assumed
            // (1.5px), so 1-2 outlier lines per column would
            // hit max compression here and STILL overflow,
            // forcing visible clipping.
            var COMPRESS_CAP = 1.5;
            var compressPx = deficit / totalLetters;
            if (compressPx <= COMPRESS_CAP) {
                row.style.letterSpacing = '-' + compressPx.toFixed(2) + 'px';
                row.classList.add('sLineKashidaTight');
                // Final safety net: if even the calculated
                // compression couldn't quite make this single line
                // fit (e.g. because letter-spacing widths don't
                // scale linearly with the column's exact pixel
                // metrics, or because the trailing letter's right
                // bearing pushed past the column edge), shrink
                // JUST this row's font-size by a small amount.
                // This is per-line so it doesn't affect any other
                // row in the column, and the visual size delta is
                // 1-2% which is far below perceptual threshold.
                if (row.scrollWidth > availWidth - 2) {
                    var fitScale = (availWidth - 2) / row.scrollWidth;
                    if (fitScale > 0.85 && fitScale < 1) {
                        var rowFsPx = parseFloat(getComputedStyle(row).fontSize) || 16;
                        row.style.fontSize = (rowFsPx * fitScale * 0.99).toFixed(1) + 'px';
                    }
                }
                continue;
            }
            // Apply max compression. The column-level pre-shrink
            // (above) has already shrunk the whole column's font-
            // size if needed so this line still won't visibly
            // overflow after letter-spacing compression.
            row.style.letterSpacing = '-' + COMPRESS_CAP.toFixed(2) + 'px';
            row.classList.add('sLineKashidaTight');
            // Same per-line safety net as above (see comment).
            if (row.scrollWidth > availWidth - 2) {
                var fitScale2 = (availWidth - 2) / row.scrollWidth;
                if (fitScale2 > 0.85 && fitScale2 < 1) {
                    var rowFsPx2 = parseFloat(getComputedStyle(row).fontSize) || 16;
                    row.style.fontSize = (rowFsPx2 * fitScale2 * 0.99).toFixed(1) + 'px';
                }
            }
            continue;
        }
        // Tikun-print-style justification: pour leftover slack into
        // letter-spacing FIRST (kashida-style stretch) up to a safe
        // cap, then distribute any residual across the inter-word
        // gaps. This matches how a real Tikun-Korim page is set:
        // word-spacing stays tight and uniform (one character-width
        // ish), and the line's "filling" comes from subtly wider
        // letterforms rather than yawning gaps. The previous order
        // (gap-first up to 1.5em, then letter-spacing) made sparse
        // lines visibly stretchy because gaps absorbed almost all
        // the slack before kashida ever activated.
        //
        // Caps:
        //   * letter-spacing: 1.2px absolute. Beyond ~1.2px on a
        //     Hebrew Stam-style font the base letters visibly
        //     disconnect from each other.
        //   * inter-word gap: ~1.0em. Beyond this, gaps start to
        //     feel like a paragraph break instead of a word break.
        // Lines that exceed both caps fall back to flex-start
        // (sLineKashidaCap) -- a ragged-end Stam look rather than
        // blowing up the spacing further.
        var MAX_LS = 1.2;
        var MAX_GAP_PX = Math.max(fsPx * 1.0, 14);
        // Phase 1: pour into letter-spacing first.
        var maxLsAbsorb = MAX_LS * totalLetters;
        var lsAbsorbed = Math.min(slack, maxLsAbsorb);
        var lsPx = lsAbsorbed / totalLetters;
        var remaining = slack - lsAbsorbed;
        // Phase 2: residual goes into inter-word gaps, capped.
        var perGap = 0;
        if (remaining > 0) {
            var maxGapAbsorb = MAX_GAP_PX * nGaps;
            var gapAbsorbed = Math.min(remaining, maxGapAbsorb);
            perGap = gapAbsorbed / nGaps;
            remaining = remaining - gapAbsorbed;
        }
        // Phase 3: still leftover after both caps -> mark the line
        // as kashida-capped so its CSS falls back to flex-start; the
        // residual blank then sits at the line's left edge (RTL
        // ragged-end), like a Stam scribe leaving a small empty tail
        // rather than blowing up word/letter spacing further.
        if (remaining > 1) {
            row.classList.add('sLineKashidaCap');
        } else {
            // Saturated: pin the line to flex-start so the inline
            // column-gap is honoured exactly (without
            // `space-between` redistributing leftover sub-pixels
            // into the visible gap and pushing the last word
            // off-edge).
            row.classList.add('sLineKashidaTight');
        }
        row.style.columnGap = perGap.toFixed(2) + 'px';
        if (lsPx > 0.05) {
            row.style.letterSpacing = lsPx.toFixed(2) + 'px';
        }
    }

    // FINAL SAFETY NET: walk every row in the column and shrink the
    // font of any row whose actual rendered content STILL overshoots
    // the column edge after all the kashida / column-shrink logic
    // above. We use getBoundingClientRect() on the row's first and
    // last *visual* word (in RTL: rightmost child = first word,
    // leftmost child = last word) and compare their span against the
    // column's content-box. This catches the residual ~1-3% of lines
    // where letter-spacing widths don't quite match the linear
    // estimate we used in the pre-pass (DrugulinCLM glyphs with
    // heavy diacritic stacks read a touch wider in practice than
    // their pre-letter-spacing offsetWidth would suggest).
    var lineRect0 = linesEl.getBoundingClientRect();
    var leftEdge = lineRect0.left + 1;       // 1px tolerance
    var rightEdge = lineRect0.right - 1;
    for (var fi = 0; fi < rows.length; fi++) {
        var frow = rows[fi];
        if (!frow.classList) continue;
        if (frow.classList.contains('sLineBlank')) continue;
        // Find leftmost and rightmost rendered child rect.
        var fkids = frow.children;
        if (!fkids.length) continue;
        var minLeft = Infinity, maxRight = -Infinity;
        for (var fk = 0; fk < fkids.length; fk++) {
            var fch = fkids[fk];
            if (!fch.getBoundingClientRect) continue;
            // Only count visible flex units (skip invisible spacers).
            if (fch.offsetWidth <= 0) continue;
            var fr = fch.getBoundingClientRect();
            if (fr.left < minLeft) minLeft = fr.left;
            if (fr.right > maxRight) maxRight = fr.right;
        }
        if (minLeft === Infinity) continue;
        // Overflow if either the leftmost letter sticks out past the
        // column's left edge (most common in RTL: last visual word
        // overshoots) or the rightmost letter past the right edge.
        var overL = leftEdge - minLeft;
        var overR = maxRight - rightEdge;
        var over = Math.max(overL, overR);
        if (over <= 0) continue;
        var contentW = maxRight - minLeft;
        if (contentW <= 0) continue;
        var fitScale = (contentW - over) / contentW;
        // Already at a tiny size? Bail rather than make it
        // unreadable.
        if (fitScale < 0.80 || fitScale >= 1) continue;
        var curRowFs = parseFloat(getComputedStyle(frow).fontSize) || 16;
        // Apply scale with a small extra safety so we don't have to
        // re-measure-and-re-shrink in a loop.
        var newRowFs = curRowFs * fitScale * 0.985;
        if (newRowFs < 9) newRowFs = 9;
        frow.style.fontSize = newRowFs.toFixed(1) + 'px';
    }
}


// Lay out items into <div class="sLine"> rows. Strategy:
//   1) Build all word DOM elements + meta in an "items" pre-list.
//   2) Use a hidden "ruler" element to measure each word's natural
//      rendered width once.
//   3) Greedy line packing using accumulated widths + a fixed inter-word
//      gap (== minimum visual space). When width-so-far + next-word-width
//      + min-gap exceeds the available column width, start a new line.
//   4) Move the actual word DOM into <div class="sLine"> elements, then
//      apply justify-content for the visual stretch.
//
// We avoid using DOM scroll/client widths on the live line because flex
// distribution makes those readings unreliable.
function layoutLines(host, items, col) {
    var grid = document.createElement('div');
    grid.className = 'sColGrid';
    var lines = document.createElement('div');
    lines.className = 'sColLines';
    var gutter = document.createElement('div');
    gutter.className = 'sColGutter';
    grid.appendChild(gutter);
    grid.appendChild(lines);
    host.appendChild(grid);

    // Determine the available width of a line.
    var tmp = document.createElement('div');
    tmp.className = 'sLine sLineMeasure';
    lines.appendChild(tmp);
    var availWidth = tmp.clientWidth || 240;
    lines.removeChild(tmp);

    // Hidden ruler inside `lines` so it inherits the same font/size as
    // actual rendered words. We use a span with .word class (without
    // flex-row distribution) so its offsetWidth is the natural width.
    var ruler = document.createElement('span');
    ruler.className = 'word sRuler';
    ruler.style.position = 'absolute';
    ruler.style.visibility = 'hidden';
    ruler.style.right = '-99999px';
    ruler.style.top = '0';
    ruler.style.whiteSpace = 'nowrap';
    ruler.style.padding = '0';
    lines.appendChild(ruler);
    function measureWord(text) {
        ruler.textContent = text;
        return ruler.offsetWidth;
    }
    // Minimum visual gap between words on a line. Using a thin space (~1
    // character width); flex 'space-between' will stretch it as needed
    // for justification.
    var spaceWidth = measureWord(' ') || 6;

    // For the gutter we collect verse-start marks tied to a specific line.
    var gutterMarks = [];

    // Build a flat sequence of "tokens" the line-packer consumes.
    var packTokens = [];
    for (var k = 0; k < items.length; k++) {
        var it = items[k];
        if (it.kind === 'word') {
            var w = makeWordEl(it.tok, it.tokIdx);
            if (it.chapter != null) w.setAttribute('data-chapter', String(it.chapter));
            if (it.verse != null)   w.setAttribute('data-verse',   String(it.verse));
            if (it.verseStart)      w.setAttribute('data-verse-start', '1');
            if (it.aliyahLabel)     w.setAttribute('data-aliyah-label', it.aliyahLabel);
            var width = measureWord(it.tok.f) + 2;  // small safety
            packTokens.push({
                t: 'w', el: w, width: width,
                verseStart: it.verseStart,
                aliyahLabel: it.aliyahLabel,
            });
        } else if (it.kind === 'petucha') {
            packTokens.push({ t: 'P' });
        } else if (it.kind === 'setumah') {
            packTokens.push({ t: 'S', width: 6 * 14 /* 6 char widths */ });
        } else if (it.kind === 'sefer') {
            packTokens.push({ t: 'sefer', heb: it.heb });
        } else if (it.kind === 'parasha') {
            // Skipped in body (breadcrumb already shows it)
        }
    }

    // Greedy line packing.
    var line = makeLineEl();
    lines.appendChild(line);
    var lineIdx = 0;
    var widthOnLine = 0;
    var itemsOnLine = 0;

    function newLine(makeShort) {
        // Mark the line we're about to leave as short ONLY if this is
        // a forced break (petucha / end-of-column / sefer). A natural
        // word-wrap break leaves the line as full-justified.
        if (makeShort) line.classList.add('sLineEndShort');
        line = makeLineEl();
        lines.appendChild(line);
        lineIdx++;
        widthOnLine = 0;
        itemsOnLine = 0;
    }
    function blankLine() {
        // Petucha break in the measurement-based fallback: just close the
        // current line short and start fresh; do NOT insert an actual blank
        // row. This matches the Davidovich Stam convention (no full-blank
        // line mid-column) and keeps the measurement-path consistent with
        // the OCR-driven path.
        newLine(true);
    }

    for (var k2 = 0; k2 < packTokens.length; k2++) {
        var pt = packTokens[k2];
        if (pt.t === 'sefer') {
            newLine(true);  // close current short
            var sg = document.createElement('div');
            sg.className = 'seferGap';
            lines.appendChild(sg);
            var sm = document.createElement('div');
            sm.className = 'seferMarker';
            sm.textContent = pt.heb || '';
            lines.appendChild(sm);
            lineIdx += 2;
            continue;
        }
        if (pt.t === 'P') {
            blankLine();
            continue;
        }
        if (pt.t === 'S') {
            line.appendChild(makeSetumahGap());
            widthOnLine += pt.width;
            itemsOnLine++;
            continue;
        }
        // word
        var needed = pt.width + (itemsOnLine > 0 ? spaceWidth : 0);
        if (itemsOnLine > 0 && widthOnLine + needed > availWidth) {
            newLine(false);  // line was full; don't mark as short
            needed = pt.width;
        }
        line.appendChild(pt.el);
        widthOnLine += needed;
        itemsOnLine++;
        if (pt.verseStart) {
            gutterMarks.push({
                lineIdx: lineIdx,
                verse: pt.verseStart.verse,
                chapter: pt.verseStart.chapter,
                aliyah: pt.aliyahLabel || null,
                wordEl: pt.el,
            });
        }
    }
    // NOTE: we do NOT tag the column's last line as sLineEndShort.
    // The user wants the bottom-of-column line to render edge-to-
    // edge like the rest (otherwise it looks misaligned vs. the
    // lines above). Only real paragraph breaks keep the ragged end.

    // Done measuring; remove ruler before gutter layout.
    lines.removeChild(ruler);
    layoutGutter(gutter, lines, gutterMarks);
}

function layoutGutter(gutter, lines, marks) {
    // Wipe any previously rendered entries first. layoutGutter() is
    // called twice per column render: once after the initial
    // layoutLinesFromOCR()/layoutLines() pass, and again from refit()
    // after document.fonts.ready (so the marks track the new line
    // offsets after webfonts shift the baseline). Without this clear,
    // refit appended a SECOND copy of every entry on top of the first
    // -- the user saw this as "many numbers appear twice / not aligned",
    // since the two copies landed at slightly different y because the
    // line offsets had shifted between the two passes.
    while (gutter.firstChild) gutter.removeChild(gutter.firstChild);
    // Group marks by their target line. When two (or more) verses start
    // on the same source line — common in a tikun, e.g. the line that
    // both ends one verse and contains the next verse's first word —
    // we render ONE entry per line that stacks every mark for that line
    // vertically. Without this, each mark gets its own absolute box at
    // the line's offsetTop, and the boxes overlap into an unreadable
    // "collapsed" stack.
    var byLine = []; // [{line, marks: [...]}], in order of first encounter
    for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        var wordLine = m.wordEl && m.wordEl.parentNode;
        while (wordLine && !wordLine.classList.contains('sLine')
               && wordLine !== lines) {
            wordLine = wordLine.parentNode;
        }
        if (!wordLine || wordLine === lines) continue;
        var bucket = null;
        for (var bi = 0; bi < byLine.length; bi++) {
            if (byLine[bi].line === wordLine) { bucket = byLine[bi]; break; }
        }
        if (!bucket) {
            bucket = { line: wordLine, marks: [] };
            byLine.push(bucket);
        }
        bucket.marks.push(m);
    }
    // The gutter entries are absolutely positioned inside .sColGutter
    // (the only `position: relative` ancestor), so their `top` must be
    // expressed in the GUTTER's coordinate system. .sLine lives in
    // .sColLines, a sibling of the gutter inside .sColGrid, and its
    // `offsetTop` is measured against whichever ancestor is positioned
    // -- which is NOT the gutter. Using offsetTop directly therefore
    // pinned every verse number to a y that referred to a different
    // origin, so the numbers drifted further down the deeper the line
    // was in the column (the user sees the number "way below" the
    // related passuk). Compute the offset via getBoundingClientRect so
    // the math is independent of the offsetParent chain. Fall back to
    // offsetTop in headless / non-DOM-measure environments (test
    // harness) where getBoundingClientRect returns no useful number.
    var gutterRect = null;
    if (gutter && typeof gutter.getBoundingClientRect === 'function') {
        try { gutterRect = gutter.getBoundingClientRect(); }
        catch (e) { gutterRect = null; }
    }
    for (var gi = 0; gi < byLine.length; gi++) {
        var b = byLine[gi];
        var entry = document.createElement('div');
        entry.className = 'sGutterEntry';
        var topPx = b.line.offsetTop;
        if (gutterRect && typeof b.line.getBoundingClientRect === 'function') {
            try {
                var lineRect = b.line.getBoundingClientRect();
                topPx = lineRect.top - gutterRect.top;
            } catch (e) {}
        }
        entry.style.top = topPx + 'px';
        // The aliyah label (if any) on the FIRST mark applies to the
        // line as a whole — render it once, above any verse numbers.
        for (var mi = 0; mi < b.marks.length; mi++) {
            if (b.marks[mi].aliyah) {
                var al = document.createElement('div');
                al.className = 'sAliyahLabel';
                al.textContent = b.marks[mi].aliyah;
                entry.appendChild(al);
                break;
            }
        }
        for (var mj = 0; mj < b.marks.length; mj++) {
            var m2 = b.marks[mj];
            var vn = document.createElement('div');
            vn.className = 'sVerseNum verseNum';
            vn.setAttribute('data-verse', String(m2.verse));
            vn.setAttribute('data-chapter', String(m2.chapter || ''));
            vn.setAttribute('title', 'הקשה: טעמים · החזקה: ניקוד');
            vn.textContent = hebrewNumeral(m2.verse);
            entry.appendChild(vn);
        }
        gutter.appendChild(entry);
    }
}

function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


// ==================== HEBREW NUMERAL ====================

function hebrewNumeral(n) {
    if (!n || n <= 0) return String(n);
    var units  = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    var tens   = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    var hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
    var result = '';
    var h = Math.floor(n / 100);
    var rem = n % 100;
    if (h > 0) {
        if (h <= 4) result += hundreds[h];
        else result += 'ת' + hundreds[h - 4];
    }
    if (rem === 15) result += 'טו';
    else if (rem === 16) result += 'טז';
    else {
        result += tens[Math.floor(rem / 10)] + units[rem % 10];
    }
    return result;
}


// ==================== NAV + BREADCRUMB ====================

function updateBreadcrumb() {
    // Breadcrumb at the top now ONLY shows the sefer name + chapter:verse
    // anchor for the column. Parasha + aliyah info has moved to the
    // bottom info bar (which is the more useful "where am I in the
    // weekly reading" indicator).
    var bc = document.getElementById('readBreadcrumb');
    if (!bc || !COLUMNS) return;
    var col = COLUMNS[COLUMN_IDX];
    var bits = [];
    if (col.seferHeb) bits.push(col.seferHeb);
    if (col.chapter && col.verse) {
        bits.push(hebrewNumeral(col.chapter) + ' · ' + hebrewNumeral(col.verse));
    }
    bc.textContent = bits.join(' · ') || '—';
}

function updateColInfo() {
    // Bottom info bar: parasha name + (when applicable) the aliyah this
    // column starts in.
    var info = document.getElementById('colInfo');
    if (!info || !COLUMNS) return;
    var col = COLUMNS[COLUMN_IDX];
    var bits = [];
    if (col.parashaHeb) bits.push('פרשת ' + col.parashaHeb);
    if (col.aliyahHeb) bits.push(col.aliyahHeb);
    info.textContent = bits.join(' · ') || '—';
}

function updateNavButtons() {
    var prev = document.getElementById('btnPrev');
    var next = document.getElementById('btnNext');
    if (prev) prev.disabled = (COLUMN_IDX <= 0);
    if (next) next.disabled = (COLUMN_IDX >= COLUMNS.length - 1);
}

function goColumnDelta(d) {
    renderColumn(COLUMN_IDX + d);
    var stage = document.getElementById('readStage');
    if (stage) stage.scrollTop = 0;
}

function goToColumnByTokenIndex(tokenIdx) {
    if (!COLUMNS) return;
    for (var i = 0; i < COLUMNS.length; i++) {
        if (tokenIdx >= COLUMNS[i].start && tokenIdx < COLUMNS[i].end) {
            renderColumn(i, tokenIdx);
            return;
        }
    }
    renderColumn(COLUMNS.length - 1);
}

// Scroll the column container so the word at-or-after `tokenIdx` is
// at the top of the visible viewport. Used right after a jump (e.g.
// parashat Balak, which starts at the BOTTOM of col 179); without
// this the user lands at the top of the column and sees the previous
// parasha's text.
//
// `tokenIdx` may point at a non-word token (parasha marker, aliyah
// marker, verse marker) -- those don't have a DOM word, so we walk
// forward in `data-tok-idx` order until we find the first rendered
// word.
function scrollColumnToToken(tokenIdx) {
    var stage = document.getElementById('readStage');
    if (!stage) return;
    var target = document.querySelector(
        '#readColumn [data-tok-idx="' + tokenIdx + '"]');
    if (!target) {
        // Fallback: scan all words in this column and pick the first
        // one whose tokIdx >= the requested tokenIdx.
        var words = document.querySelectorAll('#readColumn [data-tok-idx]');
        var bestIdx = Infinity;
        for (var i = 0; i < words.length; i++) {
            var ti = parseInt(words[i].getAttribute('data-tok-idx'), 10);
            if (ti >= tokenIdx && ti < bestIdx) {
                bestIdx = ti;
                target = words[i];
            }
        }
    }
    if (!target) return;
    // Find the line element this word lives in.
    var line = target;
    while (line && line !== stage) {
        if (line.classList && line.classList.contains('sLine')) break;
        line = line.parentNode;
    }
    if (!line || line === stage) line = target;
    var stageRect = stage.getBoundingClientRect();
    var lineRect = line.getBoundingClientRect();
    // Scroll so the target line sits a few px below the stage's top
    // (a small visual breathing margin).
    stage.scrollTop += (lineRect.top - stageRect.top) - 8;
}


// ==================== JUMP MENU ====================

function findFirstColumnFor(predicate) {
    if (!COLUMNS) return -1;
    for (var i = 0; i < COLUMNS.length; i++) {
        if (predicate(COLUMNS[i])) return i;
    }
    return -1;
}

function listSefarim() {
    // Walks the token stream and returns `[{name, heb}]` in order
    // for each Humash. We intentionally derive this from tokens
    // rather than a separate `TORAH.sefarim` array on the data file
    // so that the build script and the renderer can't drift apart.
    var seen = {};
    var out = [];
    if (!TORAH) return out;
    for (var i = 0; i < TORAH.tokens.length; i++) {
        var tk = TORAH.tokens[i];
        if (tk.k === 'sefer' && !seen[tk.name]) {
            seen[tk.name] = true;
            out.push({ name: tk.name, heb: tk.heb });
        }
    }
    return out;
}

function listParshiotInSefer(seferName) {
    var seen = {};
    var out = [];
    if (!TORAH) return out;
    var currentSefer = null;
    for (var i = 0; i < TORAH.tokens.length; i++) {
        var tk = TORAH.tokens[i];
        if (tk.k === 'sefer') currentSefer = tk.name;
        if (tk.k === 'parasha' && currentSefer === seferName && !seen[tk.name]) {
            seen[tk.name] = true;
            out.push({ name: tk.name, heb: tk.heb });
        }
    }
    return out;
}

function listAliyotInParasha(parashaName) {
    var seen = {};
    var out = [];
    if (!TORAH) return out;
    var current = null;
    for (var i = 0; i < TORAH.tokens.length; i++) {
        var tk = TORAH.tokens[i];
        if (tk.k === 'parasha') current = tk.name;
        // num >= 8 is the maftir; we intentionally skip it in the
        // jump-menu (the user reads maftir as part of the regular
        // weekly aliyah flow, not as a separate jump target).
        if (tk.k === 'aliyah' && current === parashaName
                && tk.num < 8 && !seen[tk.num]) {
            seen[tk.num] = true;
            out.push({ num: tk.num, heb: tk.heb });
        }
    }
    // The source data omits an explicit "aliyah 1" marker -- the
    // parasha start IS the start of the first aliyah. We synthesise
    // it here so the jump-menu user can pick רִאשׁוֹן like any other
    // aliyah; doJump() handles aliyah=1 by jumping to the parasha
    // start.
    if (!seen[1]) {
        out.unshift({ num: 1, heb: 'ראשון' });
    }
    return out;
}

function openJumpMenu() {
    var ov = document.getElementById('jumpOverlay');
    if (!ov) return;
    var sSel = document.getElementById('jumpSefer');
    sSel.innerHTML = '';
    listSefarim().forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.name; o.textContent = s.heb;
        sSel.appendChild(o);
    });
    // Pre-select current
    if (COLUMNS && COLUMNS[COLUMN_IDX] && COLUMNS[COLUMN_IDX].sefer) {
        sSel.value = COLUMNS[COLUMN_IDX].sefer;
    }
    onJumpSeferChange();
    ov.style.display = 'flex';
}

function closeJumpMenu() {
    var ov = document.getElementById('jumpOverlay');
    if (ov) ov.style.display = 'none';
}
function closeJumpMenuIfBackdrop(e) {
    var ov = document.getElementById('jumpOverlay');
    if (e.target === ov) closeJumpMenu();
}

function onJumpSeferChange() {
    var sefer = document.getElementById('jumpSefer').value;
    var pSel = document.getElementById('jumpParasha');
    pSel.innerHTML = '';
    listParshiotInSefer(sefer).forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.name; o.textContent = p.heb;
        pSel.appendChild(o);
    });
    if (COLUMNS && COLUMNS[COLUMN_IDX] && COLUMNS[COLUMN_IDX].sefer === sefer) {
        if (COLUMNS[COLUMN_IDX].parasha) pSel.value = COLUMNS[COLUMN_IDX].parasha;
    }
    onJumpParashaChange();
}

function onJumpParashaChange() {
    var parasha = document.getElementById('jumpParasha').value;
    var aSel = document.getElementById('jumpAliyah');
    aSel.innerHTML = '';
    var aliyot = listAliyotInParasha(parasha);
    if (aliyot.length === 0) {
        var o = document.createElement('option');
        o.value = ''; o.textContent = '—';
        aSel.appendChild(o);
        return;
    }
    aliyot.forEach(function (a) {
        var o = document.createElement('option');
        o.value = String(a.num); o.textContent = a.heb;
        aSel.appendChild(o);
    });
}

function doJump() {
    var sefer = document.getElementById('jumpSefer').value;
    var parasha = document.getElementById('jumpParasha').value;
    var aliyahStr = document.getElementById('jumpAliyah').value;
    var aliyah = aliyahStr ? parseInt(aliyahStr, 10) : null;

    // Find token index for the requested point
    var tokenIdx = -1;
    var curS = null, curP = null;
    if (TORAH) {
        for (var i = 0; i < TORAH.tokens.length; i++) {
            var tk = TORAH.tokens[i];
            if (tk.k === 'sefer') curS = tk.name;
            if (tk.k === 'parasha') curP = tk.name;
            if (curS === sefer && curP === parasha) {
                // aliyah == null OR aliyah == 1 both mean "start of
                // parasha": the source data has no explicit "aliyah 1"
                // marker, so we treat the parasha start as the first
                // aliyah (see listAliyotInParasha).
                if (aliyah == null || aliyah === 1) {
                    if (tk.k === 'parasha' || tk.k === 'aliyah' || tk.k === 'verse' || tk.k === 'w') {
                        tokenIdx = i; break;
                    }
                } else {
                    if (tk.k === 'aliyah' && tk.num === aliyah) {
                        tokenIdx = i; break;
                    }
                }
            }
        }
    }
    closeJumpMenu();
    if (tokenIdx >= 0) goToColumnByTokenIndex(tokenIdx);
    else if (COLUMNS) {
        // fallback: first column of that sefer
        var idx = findFirstColumnFor(function (c) { return c.sefer === sefer; });
        if (idx >= 0) renderColumn(idx);
    }
}


// ==================== HOME ====================

function goHome() { window.location.href = './index.html'; }


// ==================== EVENTS: tap + swipe ====================

// Gesture model (simple & reliable):
//   word:
//     tap -> cycle through: stam -> ta'amim -> ta'amim+nikud -> stam
//   verse number (right-margin gutter):
//     tap -> same cycle, but applied to every word in the verse
//   Reset: use the "איפוס" button in the toggles panel (clears all overrides).
//
// We still suppress clicks that follow obvious touch-drags (swipe nav)
// by tracking touch movement; nothing else is needed.

var MOVE_TOLERANCE_PX = 12;

// Lightweight on-screen gesture log (toggle by tapping the bar).
function dbg(msg) {
    var bar = document.getElementById('debugBar');
    if (!bar) return;
    var time = new Date().toISOString().slice(14, 23);
    bar.textContent = '[' + time + '] ' + msg;
}
function toggleDebugBar() {
    var bar = document.getElementById('debugBar');
    if (!bar) return;
    bar.classList.toggle('show');
    try {
        localStorage.setItem('tk_debugBar', bar.classList.contains('show') ? '1' : '0');
    } catch (e) {}
}
function initDebugBar() {
    var bar = document.getElementById('debugBar');
    if (!bar) return;
    try {
        if (localStorage.getItem('tk_debugBar') === '1') bar.classList.add('show');
    } catch (e) {}
    bar.textContent = '(gesture log)';
}

function wireTapEvents() {
    var stage = document.getElementById('readColumn');
    if (!stage) return;

    // Track whether the current touch counted as a drag (swipe nav). If
    // it did, we suppress the trailing synthetic click so cycling
    // doesn't fire on top of column navigation.
    var touchStartX = 0, touchStartY = 0;
    var touchMoved = false;

    function findActionable(el) {
        var n = el;
        while (n && n !== stage) {
            if (n.classList) {
                if (n.classList.contains('verseNum')) return { kind: 'verseNum', el: n };
                if (n.classList.contains('word')) return { kind: 'word', el: n };
            }
            n = n.parentNode;
        }
        return null;
    }

    function fireTap(target) {
        if (target.kind === 'word') {
            var next = cycleWordMode(target.el);
            dbg('TAP word ' + target.el.getAttribute('data-f') + ' -> ' + next);
        } else {
            var ch = target.el.getAttribute('data-chapter') || '';
            var v  = target.el.getAttribute('data-verse');
            if (v) {
                var nextV = cycleVerseModeByKey(ch + ':' + v);
                dbg('TAP verse ' + ch + ':' + v + ' -> ' + nextV);
            }
        }
    }

    stage.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { touchMoved = true; return; }
        var t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchMoved = false;
    }, { passive: true });

    stage.addEventListener('touchmove', function (e) {
        if (touchMoved || e.touches.length !== 1) return;
        var t = e.touches[0];
        if (Math.abs(t.clientX - touchStartX) > MOVE_TOLERANCE_PX ||
            Math.abs(t.clientY - touchStartY) > MOVE_TOLERANCE_PX) {
            touchMoved = true;
        }
    }, { passive: true });

    stage.addEventListener('click', function (e) {
        if (touchMoved) {
            touchMoved = false;
            return;
        }
        var target = findActionable(e.target);
        if (!target) return;
        fireTap(target);
    });
}

function wireSwipeNavigation() {
    var stage = document.getElementById('readStage');
    if (!stage) return;

    // Horizontal swipe = column nav. We listen on the whole document so the
    // gesture works whether the touch starts on the stage, on a word, on the
    // gutter, or even on the (empty) margins. The vertical-scroll container
    // (readStage) keeps its native vertical scrolling intact because we only
    // act on touchend when the gesture was clearly horizontal.
    //
    // Recognition rules:
    //   * |dx| >= SWIPE_MIN_X (40 px), AND
    //   * |dx| > |dy| * 1.2  (horizontal-dominant gesture)
    //
    // This is more forgiving than a strict Y cap, which used to misfire on
    // tall columns where a "horizontal" finger swipe naturally drifts a few
    // dozen pixels vertically.

    var SWIPE_MIN_X = 40;
    var DIR_RATIO = 1.2;

    var startX = 0, startY = 0, startT = 0;
    var maxAbsDy = 0;
    var tracking = false;

    function onStart(x, y) {
        startX = x; startY = y; startT = Date.now();
        maxAbsDy = 0;
        tracking = true;
    }
    function onMove(x, y) {
        if (!tracking) return;
        var ady = Math.abs(y - startY);
        if (ady > maxAbsDy) maxAbsDy = ady;
    }
    function onEnd(x, y) {
        if (!tracking) return;
        tracking = false;
        var dx = x - startX;
        var dy = y - startY;
        if (Math.abs(dx) < SWIPE_MIN_X) return;
        // Use the larger of (final dy) and (max dy seen during move) as the
        // vertical-drift estimate. If the user briefly drifted up/down then
        // came back near horizontal, the final dy can be tiny even though
        // the gesture was really vertical scrolling. maxAbsDy catches that.
        var verticalEstimate = Math.max(Math.abs(dy), maxAbsDy);
        if (Math.abs(dx) <= verticalEstimate * DIR_RATIO) return;
        // Hebrew / RTL convention: text advances right-to-left, so swiping
        // RIGHT-to-LEFT on the finger should reveal the *previous* column
        // (you're pulling the next page out of the right, like turning a
        // sefer-Torah page). Swiping LEFT-to-RIGHT advances to the next
        // column.
        //   swipe RIGHT (dx > 0) -> next column (advance in text)
        //   swipe LEFT  (dx < 0) -> previous column
        if (dx > 0) goColumnDelta(1);
        else goColumnDelta(-1);
    }

    document.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { tracking = false; return; }
        onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
        if (e.touches.length !== 1) return;
        onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) { tracking = false; return; }
        onEnd(t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchcancel', function () { tracking = false; }, { passive: true });

    // Mouse fallback for desktop / WebView debugging.
    var mouseDown = false;
    document.addEventListener('mousedown', function (e) {
        mouseDown = true; onStart(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function (e) {
        if (mouseDown) onMove(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', function (e) {
        if (mouseDown) { mouseDown = false; onEnd(e.clientX, e.clientY); }
    });

    // Keyboard arrows for desktop testing
    document.addEventListener('keydown', function (e) {
        // Match the swipe convention above: RIGHT advances, LEFT goes back.
        if (e.key === 'ArrowRight') goColumnDelta(1);
        else if (e.key === 'ArrowLeft') goColumnDelta(-1);
        else if (e.key === 'PageDown') goColumnDelta(1);
        else if (e.key === 'PageUp') goColumnDelta(-1);
    });
}

// ==================== RESIZE / ROTATION ====================
//
// When the device rotates (or the WebView gets resized for any other
// reason: split-screen, foldable unfold, browser dev-tools panel
// toggling, etc.) the column's available width changes. Without this
// handler the rendered column keeps its old global font-size and old
// kashida spacing, which produces words clipping the new edge or
// huge gaps between words.
//
// Strategy: re-render the CURRENT column from scratch on resize. The
// font-size cache (GLOBAL_FONT_SIZE / GLOBAL_FONT_AVAIL_WIDTH) is
// already keyed on availWidth so it self-invalidates when the new
// width is measured -- we just need to trigger a re-render.
//
// We also debounce: continuous resize events (drag-to-resize a
// browser window, or the brief mid-rotation animation on Android)
// would otherwise cause layout thrash. 150 ms after the last resize
// event we run the actual re-render. We also re-render on
// `orientationchange` directly (Android emulators sometimes fire
// orientationchange BEFORE the window-size update has settled, so
// we wait one rAF inside that handler to read the final size).
function wireResizeRerender() {
    var lastWidth = window.innerWidth;
    var lastHeight = window.innerHeight;
    var resizeTimer = null;

    function rerenderIfNeeded() {
        // Skip if we still have the same viewport size as last time
        // -- iOS / WKWebView sometimes fires resize events with the
        // same dimensions when the keyboard toggles.
        var w = window.innerWidth;
        var h = window.innerHeight;
        if (w === lastWidth && h === lastHeight) return;
        lastWidth = w;
        lastHeight = h;
        if (typeof COLUMN_IDX !== 'number' || !COLUMNS) return;
        // Invalidate the font cache explicitly. computeGlobalFontSize
        // also self-invalidates by comparing GLOBAL_FONT_AVAIL_WIDTH
        // to the new availWidth, but the new availWidth depends on
        // the parent .scrollColumn's width, which reflects window
        // size only after layout has settled. Resetting the cache
        // here means the very first call inside renderColumn will
        // unconditionally recompute, which is what we want on
        // rotation.
        GLOBAL_FONT_SIZE = 0;
        GLOBAL_FONT_AVAIL_WIDTH = 0;
        renderColumn(COLUMN_IDX);
    }

    window.addEventListener('resize', function () {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(rerenderIfNeeded, 150);
    });

    window.addEventListener('orientationchange', function () {
        // The orientation change is fired BEFORE the new layout is
        // measurable on some Android WebViews. Defer to the next
        // animation frame so window.innerWidth / innerHeight reflect
        // the post-rotation dimensions.
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () {
                if (resizeTimer) clearTimeout(resizeTimer);
                resizeTimer = setTimeout(rerenderIfNeeded, 50);
            });
        } else {
            setTimeout(rerenderIfNeeded, 50);
        }
    });
}


// ==================== INIT (read.html) ====================

function initReadPage() {
    initDebugBar();
    syncToggleBar();
    // First-launch intro popup. The Flutter app boots straight into the
    // reader (via indexIntro.html → ?parasha=…), so the home screen
    // isn't necessarily the first thing the user sees — we have to
    // gate this here too. The flag is shared with index.html, so once
    // dismissed neither page re-shows it.
    showHelpPopupIfFirstLaunch();
    Promise.all([loadTorah(), loadLayout()]).then(function (results) {
        TORAH = results[0];
        LAYOUT = results[1];
        COLUMNS = buildColumns(TORAH.tokens, LAYOUT);
        var saved = parseInt(localStorage.getItem(POS_KEY), 10);
        if (!Number.isFinite(saved) || saved < 0 || saved >= COLUMNS.length) {
            saved = 0;
        }
        // Allow ?col=N, ?token=N, or ?parasha=Slug override
        try {
            var qs = new URLSearchParams(window.location.search);
            if (qs.has('col')) saved = parseInt(qs.get('col'), 10) || 0;
            if (qs.has('token')) {
                var ti = parseInt(qs.get('token'), 10);
                if (Number.isFinite(ti)) {
                    for (var i = 0; i < COLUMNS.length; i++) {
                        if (ti >= COLUMNS[i].start && ti < COLUMNS[i].end) {
                            saved = i; break;
                        }
                    }
                }
            }
            if (qs.has('parasha')) {
                var pname = qs.get('parasha');
                // We want the column where this parasha BEGINS — the
                // one containing the parasha's `parasha` token. Most
                // parshiyot start mid-column, so the previous parasha
                // is still the "active context" at that column's
                // first word, but the new parasha begins a few words
                // later. Locating the parasha-token directly avoids
                // landing on the *next* column.
                var startTokenIdx = -1;
                for (var ti = 0; ti < TORAH.tokens.length; ti++) {
                    var ttk = TORAH.tokens[ti];
                    if (ttk && ttk.k === 'parasha' && ttk.name === pname) {
                        startTokenIdx = ti;
                        break;
                    }
                }
                if (startTokenIdx >= 0) {
                    for (var kk = 0; kk < COLUMNS.length; kk++) {
                        if (startTokenIdx >= COLUMNS[kk].start &&
                            startTokenIdx <  COLUMNS[kk].end) {
                            saved = kk;
                            break;
                        }
                    }
                } else {
                    // Fall back to active-context match.
                    for (var k = 0; k < COLUMNS.length; k++) {
                        if (COLUMNS[k].parasha === pname) { saved = k; break; }
                    }
                }
            }
            // ?ref=<Sefer>:<chapter>:<verse> — used by special readings
            // (chagim, fasts, etc.) to land on a specific verse.
            if (qs.has('ref') && typeof parseSpecialRef === 'function') {
                var parsed = parseSpecialRef(qs.get('ref'));
                if (parsed) {
                    var refTok = findTokenForRef(
                        TORAH.tokens, parsed.sefer,
                        parsed.chapter, parsed.verse);
                    if (refTok >= 0) {
                        for (var rci = 0; rci < COLUMNS.length; rci++) {
                            if (refTok >= COLUMNS[rci].start &&
                                refTok <  COLUMNS[rci].end) {
                                saved = rci;
                                break;
                            }
                        }
                    }
                }
            }
        } catch (e) {}
        renderColumn(saved);
        wireTapEvents();
        wireSwipeNavigation();
        wireResizeRerender();
    }).catch(function (err) {
        var stage = document.getElementById('readColumn');
        if (stage) stage.innerHTML = "<div class='readError'>שגיאה בטעינת הטקסט: " + escHtml(err.message) + "</div>";
        console.error(err);
    });
}


// ==================== HELP / FIRST-LAUNCH INTRO ====================

// The help popup explains the core gestures (tap a word / tap a verse
// number / global toggles / horizontal swipe) in Hebrew + English.
// It serves two flows that share the SAME `tk_seenIntro` localStorage
// flag:
//   1. Auto-shown the first time the app is opened. Both index.html
//      (home) and read.html (reader) call showHelpPopupIfFirstLaunch()
//      from their init code, so wherever the user lands first they
//      get the explanation. Once dismissed, neither page re-shows it.
//   2. Manual reopen from the "?" icon in the home-screen top bar
//      (showHelpPopup()).
//
// We BUILD the overlay DOM in JS rather than putting it in every HTML
// file so the markup stays in one place and so we can drop it into
// the reader without touching read.html's existing top bar.
function _ensureHelpOverlay() {
    var ov = document.getElementById('helpOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.setAttribute('id', 'helpOverlay');
    ov.className = 'overlay';
    ov.style.display = 'none';
    ov.addEventListener('click', function (e) {
        if (e.target === ov) closeHelpPopup();
    });
    ov.innerHTML = ''
        + '<div class="overlayCard helpCard">'
        + '  <div class="overlayTitle">'
        + '    איך משתמשים באפליקציה'
        + '    <span class="helpTitleEn">How to use this app</span>'
        + '  </div>'
        + '  <div class="helpBlock helpBlockHe">'
        + '    <div class="helpRow">'
        + '      <span class="helpGesture">הקשה על מילה</span>'
        // RTL-aware arrows: in Hebrew the natural reading direction is
        // right-to-left, so the "next step" arrow has to POINT LEFT
        // (i.e. ← / U+2190) to feel like forward motion. The original
        // `→` looked like it pointed back at what the reader already
        // read.
        + '      <span class="helpDesc">מחליפה את התצוגה: ללא סימנים ← טעמים בלבד ← טעמים וניקוד ← וחוזר חלילה.</span>'
        + '    </div>'
        + '    <div class="helpRow">'
        + '      <span class="helpGesture">הקשה על מספר פסוק (בשוליים הימניים)</span>'
        + '      <span class="helpDesc">מחליפה את התצוגה לכל הפסוק באותו מחזור.</span>'
        + '    </div>'
        + '    <div class="helpRow">'
        + '      <span class="helpGesture">כפתורי "טעמים" / "נקודות" שבראש דף הקריאה</span>'
        + '      <span class="helpDesc">קובעים את ברירת המחדל לכל הטקסט.</span>'
        + '    </div>'
        + '    <div class="helpRow">'
        + '      <span class="helpGesture">החלקה אופקית</span>'
        + '      <span class="helpDesc">מעבר בין העמודות, כמו דפדוף בספר תורה.</span>'
        + '    </div>'
        + '  </div>'
        + '  <div class="helpBlock helpBlockEn">'
        + '    <div class="helpRow">'
        + '      <span class="helpGesture">Tap a word</span>'
        + '      <span class="helpDesc">Cycles the display: plain → cantillation only → cantillation + vowels → back to plain.</span>'
        + '    </div>'
        + '    <div class="helpRow">'
        + '      <span class="helpGesture">Tap a verse number (right margin)</span>'
        + '      <span class="helpDesc">Cycles the entire verse the same way.</span>'
        + '    </div>'
        + '    <div class="helpRow">'
        + '      <span class="helpGesture">"Taamim" / "Nikud" buttons at the top of the reader</span>'
        + '      <span class="helpDesc">Set the default for the whole text.</span>'
        + '    </div>'
        + '    <div class="helpRow">'
        + '      <span class="helpGesture">Horizontal swipe</span>'
        + '      <span class="helpDesc">Move between columns, like turning the page of a Sefer Torah.</span>'
        + '    </div>'
        + '  </div>'
        + '  <div class="overlayActions helpActions">'
        + '    <button class="tBtn primary" onclick="closeHelpPopup()">הבנתי / Got it</button>'
        + '  </div>'
        + '</div>';
    document.body.appendChild(ov);
    return ov;
}

function showHelpPopup() {
    var ov = _ensureHelpOverlay();
    ov.style.display = 'flex';
}

function closeHelpPopup() {
    var ov = document.getElementById('helpOverlay');
    if (ov) ov.style.display = 'none';
    try { localStorage.setItem('tk_seenIntro', '1'); } catch (e) {}
}

// Auto-shown on first ever launch (gated by `tk_seenIntro`). Both
// index.html and read.html call this from their startup code, so
// whichever page the user lands on first gets the explanation, and
// neither page re-shows it after the flag is set.
function showHelpPopupIfFirstLaunch() {
    try {
        if (!localStorage.getItem('tk_seenIntro')) showHelpPopup();
    } catch (e) { /* private mode etc. — silently skip. */ }
}

// ==================== INDEX (index.html) ====================


function accordionOpenClose(id) {
    var panel = document.getElementById(id);
    if (!panel) return;
    var btn = panel.previousElementSibling;
    if (panel.style.maxHeight) {
        panel.style.maxHeight = null;
        if (btn) btn.classList.remove('open');
    } else {
        panel.style.maxHeight = panel.scrollHeight + 'px';
        if (btn) btn.classList.add('open');
    }
}

function goRead() { window.location.href = './read.html'; }

function goReadAtParasha(parashaName) {
    // Defer until torah.json is loaded; index page can also pre-resolve
    // for known parshiot via the calendar map. For now, send via query.
    window.location.href = './read.html?parasha=' + encodeURIComponent(parashaName);
}

// Open the dedicated Megilat Esther reader. Esther uses a separate
// HTML page (megilla.html) that loads esther.js / esther_layout.js
// instead of the Torah data, but reuses the same column-rendering
// engine. Last-read column for the megillah is stored under its own
// localStorage key so it doesn't fight with the Torah position.
function goReadMegilla() {
    window.location.href = './megilla.html';
}

// Jump to a specific verse reference, e.g. "Bereshit:21:1". Used by
// the special-readings list on the home screen.
function goReadAtRef(ref) {
    if (!ref) return;
    window.location.href = './read.html?ref=' + encodeURIComponent(ref);
}

// Resolve the upcoming Shabbat's parasha and jump straight into it.
// If the calendar isn't available (cold start, no calendar.json), fall
// back to plain ./read.html which will land on the last-viewed column.
function goReadThisWeek() {
    function go(info) {
        if (info && info.parasha) goReadAtParasha(info.parasha);
        else goRead();
    }
    if (typeof getThisWeekReading === 'function') {
        try {
            var info = getThisWeekReading(new Date());
            if (info) { go(info); return; }
        } catch (e) {}
    }
    if (typeof _loadCalendarOnce === 'function') {
        _loadCalendarOnce(function () {
            var info2 = (typeof getThisWeekReading === 'function')
                ? getThisWeekReading(new Date()) : null;
            go(info2);
        });
        return;
    }
    go(null);
}

function initIndexPage() {
    syncMinhagPill();
    renderSpecialList();
}

function syncMinhagPill() {
    var el = document.getElementById('minhagPillValue');
    if (!el) return;
    var current = (typeof getMinhag === 'function') ? getMinhag() : 'israel';
    el.textContent = current === 'israel' ? 'ארץ ישראל' : 'חוץ לארץ';
}

function toggleMinhag() {
    var current = (typeof getMinhag === 'function') ? getMinhag() : 'israel';
    var next = current === 'israel' ? 'diaspora' : 'israel';
    if (typeof setMinhag === 'function') setMinhag(next);
    syncMinhagPill();
    renderSpecialList();
}

function onMinhagChange(m) {
    if (typeof setMinhag === 'function') setMinhag(m);
    syncMinhagPill();
    renderSpecialList();
}

// Render the categorised list of special readings (chagim, fasts,
// rosh chodesh, four parshiyot, etc.). The list is static — the
// catalog lives in specialReadings.js — so the user can pick any
// reading at any time, regardless of date. Tapping a reading opens
// the reader at the exact verse where the public reading begins.
function renderSpecialList() {
    var list = document.getElementById('specialList');
    if (!list) return;
    if (typeof getSpecialReadingsGrouped !== 'function') {
        list.innerHTML = '<div class="specialEmpty">' +
                         'רשימת קריאות אינה זמינה' +
                         '</div>';
        return;
    }
    var groups = getSpecialReadingsGrouped();
    if (!groups || !groups.length) {
        list.innerHTML = '<div class="specialEmpty">' +
                         'אין קריאות מיוחדות' +
                         '</div>';
        return;
    }
    var html = '';
    for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var groupBodyId = 'specialGroupBody_' + grp.id;
        // All categories start collapsed; the user opens the one
        // they care about. Mirrors the outer accordion behaviour.
        html += '<div class="specialGroup">' +
                  '<div class="specialGroupTitle"' +
                       ' tabindex="0" role="button"' +
                       ' onclick="toggleSpecialGroup(\'' + groupBodyId + '\', this)">' +
                    '<span class="specialGroupChevron">›</span>' +
                    '<span class="specialGroupTitleText">' +
                       escHtml(grp.title) +
                    '</span>' +
                  '</div>' +
                  '<div class="specialGroupBody" id="' +
                       groupBodyId + '">';
        for (var i = 0; i < grp.items.length; i++) {
            var r = grp.items[i];
            html += '<div class="specialItem specialItemClickable"' +
                      ' tabindex="0" role="button"' +
                      ' onclick="goReadAtRef(\'' + r.ref + '\')">' +
                      '<div class="specialName">' +
                        escHtml(r.name) +
                      '</div>' +
                      '<span class="specialJumpArrow"' +
                          ' aria-label="מעבר לקריאה">›</span>' +
                    '</div>';
        }
        html += '</div></div>';
    }
    list.innerHTML = html;
}

// Per-category accordion: expand/collapse the readings inside one
// group when its title row is tapped. We use the same maxHeight
// transition pattern as the outer accordion (`accordionOpenClose`)
// so it animates smoothly. The chevron rotates 90° when open.
function toggleSpecialGroup(bodyId, titleEl) {
    var body = document.getElementById(bodyId);
    if (!body) return;
    var open = !!body.style.maxHeight;
    if (open) {
        body.style.maxHeight = null;
        if (titleEl && titleEl.classList) titleEl.classList.remove('open');
    } else {
        body.style.maxHeight = body.scrollHeight + 'px';
        if (titleEl && titleEl.classList) titleEl.classList.add('open');
    }
    // The outer accordion's maxHeight was sized when only the group
    // headers were visible; expanding any group would clip its body.
    // Lift the outer cap to a value large enough for any content -- the
    // .specialList itself is `max-height:60vh; overflow-y:auto` so the
    // panel never balloons past the viewport.
    var outer = document.getElementById('special');
    if (outer && outer.style.maxHeight) {
        outer.style.maxHeight = '9999px';
    }
}


// ==================== AUTO INIT ====================

document.addEventListener('DOMContentLoaded', function () {
    if (document.body.classList.contains('theBodyMain')) {
        initIndexPage();
    }
    // theReadBody initializes itself via inline DOMContentLoaded in read.html
});

// Smoke tests for assets/html/js/specialReadings.js.
//
// Verifies that:
//   * The catalog parses, ids are unique, every entry has a valid
//     ref string.
//   * Every ref resolves to a real (sefer, chapter, verse) inside
//     torah.json.
//   * Diaspora-only and israel-only filters work as expected.
//   * findTokenForRef finds the verse marker for a given reference.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '..');

const sr = fs.readFileSync(
    path.join(repo, 'assets/html/js/specialReadings.js'),
    'utf8',
);
const torahJson = fs.readFileSync(
    path.join(repo, 'assets/html/data/torah.json'),
    'utf8',
);

const ctx = {
    console, setTimeout, clearTimeout,
    Number, Date, Math, JSON, RegExp,
    module: { exports: {} },
};
vm.createContext(ctx);
vm.runInContext(sr + '\n//# sourceURL=specialReadings.js', ctx);

const TORAH = JSON.parse(torahJson);

let passes = 0, fails = 0;
function ok(cond, msg) {
    if (cond) { console.log('  PASS: ' + msg); passes++; }
    else      { console.log('  FAIL: ' + msg); fails++; }
}

console.log('\n[1] Catalog shape');
const cat = ctx.TK_SPECIAL_READINGS;
ok(Array.isArray(cat) && cat.length >= 30,
   `catalog has ${cat.length} entries (expect >= 30)`);

const ids = new Set();
let dupIds = 0;
for (const r of cat) {
    if (ids.has(r.id)) dupIds++;
    ids.add(r.id);
}
ok(dupIds === 0, `no duplicate ids (found ${dupIds} duplicates)`);

let badRefs = 0;
for (const r of cat) {
    const p = ctx.parseSpecialRef(r.ref);
    if (!p) { console.log(`    bad ref on ${r.id}: "${r.ref}"`); badRefs++; }
}
ok(badRefs === 0, `every entry has parseable ref (${badRefs} bad)`);

console.log('\n[2] Ref resolution against torah.json');
const validSefarim = new Set([
    'Bereshit', 'Shemot', 'Vayikra', 'Bamidbar', 'Devarim',
]);
let unresolved = 0;
for (const r of cat) {
    const p = ctx.parseSpecialRef(r.ref);
    if (!p || !validSefarim.has(p.sefer)) {
        console.log(`    invalid sefer on ${r.id}: ${r.ref}`);
        unresolved++;
        continue;
    }
    const tokIdx = ctx.findTokenForRef(
        TORAH.tokens, p.sefer, p.chapter, p.verse);
    if (tokIdx < 0) {
        console.log(`    not found: ${r.id} -> ${r.ref}`);
        unresolved++;
    }
}
ok(unresolved === 0,
   `all ${cat.length} refs resolve in torah.json (${unresolved} unresolved)`);

console.log('\n[3] Specific known references');
function refIdx(ref) {
    const p = ctx.parseSpecialRef(ref);
    return ctx.findTokenForRef(TORAH.tokens, p.sefer, p.chapter, p.verse);
}
ok(refIdx('Bereshit:21:1') >= 0, 'Bereshit 21:1 exists (Rosh Hashana day 1)');
ok(refIdx('Bereshit:22:1') >= 0, 'Bereshit 22:1 exists (Rosh Hashana day 2)');
ok(refIdx('Vayikra:16:1') >= 0, 'Vayikra 16:1 exists (Yom Kippur shacharit)');
ok(refIdx('Vayikra:18:1') >= 0, 'Vayikra 18:1 exists (Yom Kippur mincha)');
ok(refIdx('Devarim:4:25') >= 0, 'Devarim 4:25 exists (Tisha B\'Av shacharit)');
ok(refIdx('Shemot:32:11') >= 0, 'Shemot 32:11 exists (Vayechal/fasts)');
ok(refIdx('Bamidbar:7:54') >= 0, 'Bamidbar 7:54 exists (Chanukah day 8)');
ok(refIdx('Devarim:33:1') >= 0, 'Devarim 33:1 exists (Simchat Torah)');

console.log('\n[4] Token at returned index is the requested verse');
{
    const idx = refIdx('Bereshit:21:1');
    const t = TORAH.tokens[idx];
    ok(t && t.k === 'verse' && t.num === 1,
       `token at Bereshit 21:1 is {k:verse, num:1} (got ${JSON.stringify(t)})`);
}
{
    const idx = refIdx('Vayikra:16:1');
    const t = TORAH.tokens[idx];
    ok(t && t.k === 'verse' && t.num === 1,
       `token at Vayikra 16:1 is verse marker (got ${JSON.stringify(t)})`);
    // Walk back to find the most recent sefer + chapter, sanity check
    let curSefer = null, curChapter = 0;
    for (let i = 0; i <= idx; i++) {
        const tk = TORAH.tokens[i];
        if (tk.k === 'sefer') curSefer = tk.name;
        else if (tk.k === 'chapter') curChapter = tk.num;
    }
    ok(curSefer === 'Vayikra' && curChapter === 16,
       `context at Vayikra 16:1 idx is sefer=Vayikra ch=16 (got ${curSefer} ${curChapter})`);
}

console.log('\n[5] Diaspora vs Israel filters');
const ilList = ctx.getSpecialReadings('israel');
const dxList = ctx.getSpecialReadings('diaspora');
ok(dxList.length > ilList.length,
   `diaspora has more entries than israel (il=${ilList.length}, dx=${dxList.length})`);

const ilHasPesach2 = ilList.some(r => r.id === 'pesach_2_diaspora');
ok(!ilHasPesach2, 'Pesach day 2 (diaspora) hidden in israel mode');

const dxHasPesach2 = dxList.some(r => r.id === 'pesach_2_diaspora');
ok(dxHasPesach2, 'Pesach day 2 (diaspora) shown in diaspora mode');

console.log('\n[6] Grouping');
const ilGroups = ctx.getSpecialReadingsGrouped('israel');
ok(ilGroups.length >= 7,
   `israel grouping has >= 7 categories (got ${ilGroups.length})`);
const tisha = ilGroups
    .find(g => g.id === 'taaniyot')?.items
    .filter(r => r.id.startsWith('tisha_bav')) || [];
ok(tisha.length === 2,
   `taaniyot has both tisha b'av readings (got ${tisha.length})`);

console.log('\n[7] Catalog covers all categories from order list');
const cats = new Set(cat.map(r => r.cat));
let missing = 0;
for (const c of ctx.TK_SPECIAL_CATEGORY_ORDER) {
    if (!cats.has(c)) { console.log(`    missing category: ${c}`); missing++; }
}
ok(missing === 0,
   `every category in CATEGORY_ORDER has at least one entry (${missing} missing)`);

console.log(`\n--- ${passes} passed, ${fails} failed ---`);
process.exit(fails === 0 ? 0 : 1);

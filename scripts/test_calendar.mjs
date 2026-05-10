// Smoke tests for assets/html/js/calendar.js (now powered by the
// bundled @hebcal/core).
//
// Loads hebcal.bundle.js + calendar.js into a vm context and verifies
// known reference dates / parashiyot.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const hebcal = fs.readFileSync(
    path.join(repoRoot, 'assets/html/js/hebcal.bundle.js'),
    'utf8',
);
const cal = fs.readFileSync(
    path.join(repoRoot, 'assets/html/js/calendar.js'),
    'utf8',
);

let _ls = {};
const ctx = {
    console, setTimeout, clearTimeout,
    localStorage: {
        getItem(k) { return _ls[k] || null; },
        setItem(k, v) { _ls[k] = v; },
        removeItem(k) { delete _ls[k]; },
    },
    Number, Date, Math, JSON, Intl, RegExp, Symbol, BigInt,
    module: { exports: {} },
};
vm.createContext(ctx);
vm.runInContext(hebcal, ctx);
// In a browser the IIFE assigns to `window.HebcalLib`; in vm we just
// expose the IIFE return value.
ctx.HebcalLib = ctx.HebcalLib;       // already global from bundle
vm.runInContext(cal + '\n//# sourceURL=calendar.js', ctx);

let passes = 0, fails = 0;
function ok(cond, msg) {
    if (cond) { console.log('  PASS: ' + msg); passes++; }
    else      { console.log('  FAIL: ' + msg); fails++; }
}

console.log('\n[1] Hebrew/Gregorian conversion');

// 1 Tishrei 5784 = Sat 16 Sep 2023.
let h1 = ctx.getHebrewDate(new Date(2023, 8, 16));
ok(h1 && h1.y === 5784 && h1.m === 7 && h1.d === 1,
   `2023-09-16 -> 1 Tishrei 5784 (got ${h1 && h1.y}/${h1.m}/${h1.d})`);

// 14 Nisan 5784 = Mon 22 Apr 2024 (Erev Pesach).
let h2 = ctx.getHebrewDate(new Date(2024, 3, 22));
ok(h2 && h2.y === 5784 && h2.m === 1 && h2.d === 14,
   `2024-04-22 -> 14 Nisan 5784 (got ${h2 && h2.y}/${h2.m}/${h2.d})`);

// 24 Kislev 5785 = Wed 25 Dec 2024 (eve of 1st Chanukah candle).
let h3 = ctx.getHebrewDate(new Date(2024, 11, 25));
ok(h3 && h3.y === 5785 && h3.m === 9 && h3.d === 24,
   `2024-12-25 -> 24 Kislev 5785 (got ${h3 && h3.y}/${h3.m}/${h3.d})`);

console.log('\n[2] Parasha schedule (verified spot checks)');

// Wednesday 23 Oct 2024 -> upcoming Shabbat is 26 Oct 2024 -> Bereshit.
let r1 = ctx.getThisWeekReading(new Date(2024, 9, 23), 'israel');
ok(r1 && r1.parasha === 'Bereshit',
   `2024-10-23 (Israel) upcoming = Bereshit (got ${r1 && r1.parasha})`);

// Friday 1 Nov 2024 -> upcoming Shabbat 2 Nov 2024 -> Noach.
let r2 = ctx.getThisWeekReading(new Date(2024, 10, 1), 'israel');
ok(r2 && r2.parasha === 'Noah',
   `2024-11-01 -> Noah (got ${r2 && r2.parasha})`);

// Wed 18 Dec 2024 -> Shabbat 21 Dec 2024 = Vayeshev.
let r3 = ctx.getThisWeekReading(new Date(2024, 11, 18), 'israel');
ok(r3 && r3.parasha === 'Vayeshev',
   `2024-12-18 -> Vayeshev (got ${r3 && r3.parasha})`);

// Both minhagim agree on 2026-05-09 (Shabbat = 9 May 2026):
//   Israel: Behar (separate -- 5786 is leap; 8th day Pesach was Thu).
//   Diaspora: same.
let r4i = ctx.getThisWeekReading(new Date(2026, 4, 7), 'israel');
let r4d = ctx.getThisWeekReading(new Date(2026, 4, 7), 'diaspora');
ok(r4i && r4d,
   `2026-05-09 readings exist (Israel=${r4i && r4i.parasha}, Diaspora=${r4d && r4d.parasha})`);

// Combined parasha example: 5784 (non-leap), Matot-Masei combined in
// BOTH minhagim (the 9-Av runup). Shabbat 3 Aug 2024.
let r5 = ctx.getThisWeekReading(new Date(2024, 6, 31), 'israel');
ok(r5 && r5.parasha === 'Matot' && r5.combinedWith === 'Massey',
   `2024-08-03 -> Matot + Massey (got ${r5 && r5.parasha} + ${r5 && r5.combinedWith})`);

console.log('\n[3] Israel/Diaspora divergence');

// Year 5784: Pesach 1st day = Tue 23 April 2024. 8th day chu"l =
// Tue 30 April -- NOT Shabbat. So Israel and chu"l should agree on
// the parasha for the whole year.
let saturday1 = ctx.getThisWeekReading(new Date(2024, 4, 4), 'israel');
let saturday2 = ctx.getThisWeekReading(new Date(2024, 4, 4), 'diaspora');
ok(saturday1 && saturday2 && saturday1.parasha === saturday2.parasha,
   `2024-05-04: Israel=${saturday1 && saturday1.parasha}, ` +
   `chu"l=${saturday2 && saturday2.parasha}`);

console.log('\n[4] Four special parashiyot exist for current year');
let sp = ctx.getFourSpecialParashiyot(new Date(2024, 0, 15));
console.log('  ', sp);
ok(sp && sp.shekalim && sp.zachor && sp.para && sp.hachodesh,
   'all four resolved');

console.log('\n[5] Upcoming chagim around Pesach 5786');
let chags = ctx.getUpcomingSpecialDays(new Date(2026, 2, 28), 14);
console.log('  found:', chags.map(c => c.gregISO + ' ' + c.desc).join(' | '));
ok(chags.some(c => /Pesach/i.test(c.desc)),
   'Pesach detected in window');

console.log('\n[6] Rosh Chodesh detection');
// 1 Nisan 5786 = 19 March 2026 (Thursday).
let rc = ctx.getUpcomingSpecialDays(new Date(2026, 2, 18), 4);
console.log('  RC events:', rc.map(c => c.gregISO + ' ' + c.desc).join(' | '));
ok(rc.some(c => c.slug === 'rosh_chodesh'),
   'rosh chodesh detected');

console.log(`\n--- ${passes} passed, ${fails} failed ---`);
process.exit(fails === 0 ? 0 : 1);

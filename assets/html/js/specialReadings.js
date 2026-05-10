/* ====================================================================
   SPECIAL TORAH READINGS
   --------------------------------------------------------------------
   A static, halacha-driven catalog of Torah readings for chagim, fasts,
   rosh chodesh and the four special parashiyot. Each entry maps a
   named occasion to a precise reference (sefer + chapter + verse) at
   which the reading begins. Clicking an entry on the home screen jumps
   the reader to the column that contains that reference.

   We intentionally use a STATIC catalog (not derived from the Hebrew
   calendar) because the user wants to be able to learn any of these
   readings at any time, regardless of date.

   Where a single occasion has multiple readings (Tisha B'Av shacharit
   vs mincha; Yom Kippur shacharit vs mincha) each reading is its own
   entry so the user can pick which one to learn.

   Entry shape:
     { id, cat, name, ref, [diasporaOnly], [israelOnly], [note] }

   - id            stable string identifier
   - cat           one of CATEGORY_ORDER below
   - name          Hebrew display name
   - ref           "<Sefer>:<chapter>:<verse>" — start of reading
   - diasporaOnly  hide for the IL minhag
   - israelOnly    hide for the diaspora minhag
   - note          short Hebrew note to display next to the name
   ==================================================================== */

var TK_SPECIAL_CATEGORY_ORDER = [
    'pesach',
    'shavuot',
    'yamim_noraim',
    'sukkot',
    'chanukah',
    'purim',
    'taaniyot',
    'rosh_chodesh',
    'arba_parashiyot',
];

var TK_SPECIAL_CATEGORY_TITLE = {
    pesach:           'פסח',
    shavuot:          'שבועות',
    yamim_noraim:     'ימים נוראים',
    sukkot:           'סוכות / שמיני עצרת / שמחת תורה',
    chanukah:         'חנוכה',
    purim:            'פורים',
    taaniyot:         'ימי תענית',
    rosh_chodesh:     'ראש חודש',
    arba_parashiyot:  'ארבע פרשיות',
};

// References below follow common Sephardic / Ashkenazic practice for
// the START of each public reading (where the ba'al kore opens his
// scroll). The user can scroll forward from there to read the full
// portion.
var TK_SPECIAL_READINGS = [
    // ===== פסח =====
    { id: 'pesach_1', cat: 'pesach',
      name: 'פסח - יום ראשון',
      ref: 'Shemot:12:21' },
    { id: 'pesach_2_diaspora', cat: 'pesach',
      name: 'פסח - יום שני',
      ref: 'Vayikra:22:26',
      diasporaOnly: true },
    { id: 'pesach_chm_1', cat: 'pesach',
      name: 'חול המועד פסח - יום א׳',
      ref: 'Shemot:13:1' },
    { id: 'pesach_chm_2', cat: 'pesach',
      name: 'חול המועד פסח - יום ב׳',
      ref: 'Shemot:22:24' },
    { id: 'pesach_chm_3', cat: 'pesach',
      name: 'חול המועד פסח - יום ג׳',
      ref: 'Shemot:34:1' },
    { id: 'pesach_chm_4', cat: 'pesach',
      name: 'חול המועד פסח - יום ד׳',
      ref: 'Bamidbar:9:1' },
    { id: 'pesach_7', cat: 'pesach',
      name: 'פסח - יום שביעי (שירת הים)',
      ref: 'Shemot:13:17' },
    { id: 'pesach_8_diaspora', cat: 'pesach',
      name: 'פסח - יום שמיני',
      ref: 'Devarim:14:22',
      diasporaOnly: true },

    // ===== שבועות =====
    { id: 'shavuot_1', cat: 'shavuot',
      name: 'שבועות - יום ראשון (עשרת הדברות)',
      ref: 'Shemot:19:1' },
    { id: 'shavuot_2_diaspora', cat: 'shavuot',
      name: 'שבועות - יום שני',
      ref: 'Devarim:14:22',
      diasporaOnly: true },

    // ===== ימים נוראים =====
    { id: 'rh_1', cat: 'yamim_noraim',
      name: 'ראש השנה - יום ראשון',
      ref: 'Bereshit:21:1' },
    { id: 'rh_2', cat: 'yamim_noraim',
      name: 'ראש השנה - יום שני (עקדת יצחק)',
      ref: 'Bereshit:22:1' },
    { id: 'yk_shacharit', cat: 'yamim_noraim',
      name: 'יום כיפור - שחרית',
      ref: 'Vayikra:16:1' },
    { id: 'yk_mincha', cat: 'yamim_noraim',
      name: 'יום כיפור - מנחה (פרשת עריות)',
      ref: 'Vayikra:18:1' },

    // ===== סוכות / שמיני עצרת / שמחת תורה =====
    { id: 'sukkot_1', cat: 'sukkot',
      name: 'סוכות - יום ראשון',
      ref: 'Vayikra:22:26' },
    { id: 'sukkot_2_diaspora', cat: 'sukkot',
      name: 'סוכות - יום שני',
      ref: 'Vayikra:22:26',
      diasporaOnly: true },
    { id: 'sukkot_chm_a', cat: 'sukkot',
      name: 'חול המועד סוכות - יום א׳',
      ref: 'Bamidbar:29:17' },
    { id: 'sukkot_chm_b', cat: 'sukkot',
      name: 'חול המועד סוכות - יום ב׳',
      ref: 'Bamidbar:29:20' },
    { id: 'sukkot_chm_c', cat: 'sukkot',
      name: 'חול המועד סוכות - יום ג׳',
      ref: 'Bamidbar:29:23' },
    { id: 'sukkot_chm_d', cat: 'sukkot',
      name: 'חול המועד סוכות - יום ד׳',
      ref: 'Bamidbar:29:26' },
    { id: 'hoshana_rabbah', cat: 'sukkot',
      name: 'הושענא רבה',
      ref: 'Bamidbar:29:26' },
    { id: 'shemini_atzeret', cat: 'sukkot',
      name: 'שמיני עצרת',
      ref: 'Devarim:14:22' },
    { id: 'simchat_torah', cat: 'sukkot',
      name: 'שמחת תורה (וזאת הברכה + בראשית)',
      ref: 'Devarim:33:1' },

    // ===== חנוכה =====
    { id: 'chanukah_1', cat: 'chanukah',
      name: 'חנוכה - יום א׳',
      ref: 'Bamidbar:7:1' },
    { id: 'chanukah_2', cat: 'chanukah',
      name: 'חנוכה - יום ב׳',
      ref: 'Bamidbar:7:18' },
    { id: 'chanukah_3', cat: 'chanukah',
      name: 'חנוכה - יום ג׳',
      ref: 'Bamidbar:7:24' },
    { id: 'chanukah_4', cat: 'chanukah',
      name: 'חנוכה - יום ד׳',
      ref: 'Bamidbar:7:30' },
    { id: 'chanukah_5', cat: 'chanukah',
      name: 'חנוכה - יום ה׳',
      ref: 'Bamidbar:7:36' },
    { id: 'chanukah_6', cat: 'chanukah',
      name: 'חנוכה - יום ו׳',
      ref: 'Bamidbar:7:42' },
    { id: 'chanukah_7', cat: 'chanukah',
      name: 'חנוכה - יום ז׳',
      ref: 'Bamidbar:7:48' },
    { id: 'chanukah_8', cat: 'chanukah',
      name: 'חנוכה - יום ח׳',
      ref: 'Bamidbar:7:54' },

    // ===== פורים =====
    { id: 'purim', cat: 'purim',
      name: 'פורים (ויבא עמלק)',
      ref: 'Shemot:17:8' },

    // ===== ימי תענית =====
    // Minor public fasts all read the same "Vayechal" portion
    // (Shemot 32:11-14 + 34:1-10) at both shacharit and mincha. We
    // keep one entry per fast so the user can pick by name.
    { id: 'fast_17_tammuz', cat: 'taaniyot',
      name: 'שבעה עשר בתמוז (ויחל)',
      ref: 'Shemot:32:11' },
    { id: 'tisha_bav_shacharit', cat: 'taaniyot',
      name: 'תשעה באב - שחרית (כי תוליד)',
      ref: 'Devarim:4:25' },
    { id: 'tisha_bav_mincha', cat: 'taaniyot',
      name: 'תשעה באב - מנחה (ויחל)',
      ref: 'Shemot:32:11' },
    { id: 'fast_gedaliah', cat: 'taaniyot',
      name: 'צום גדליה (ויחל)',
      ref: 'Shemot:32:11' },
    { id: 'fast_10_tevet', cat: 'taaniyot',
      name: 'עשרה בטבת (ויחל)',
      ref: 'Shemot:32:11' },
    { id: 'fast_esther', cat: 'taaniyot',
      name: 'תענית אסתר (ויחל)',
      ref: 'Shemot:32:11' },

    // ===== ראש חודש =====
    { id: 'rosh_chodesh', cat: 'rosh_chodesh',
      name: 'ראש חודש',
      ref: 'Bamidbar:28:1' },

    // ===== ארבע פרשיות =====
    { id: 'shekalim', cat: 'arba_parashiyot',
      name: 'שקלים',
      ref: 'Shemot:30:11' },
    { id: 'zachor', cat: 'arba_parashiyot',
      name: 'זכור',
      ref: 'Devarim:25:17' },
    { id: 'parah', cat: 'arba_parashiyot',
      name: 'פרה',
      ref: 'Bamidbar:19:1' },
    { id: 'hachodesh', cat: 'arba_parashiyot',
      name: 'החודש',
      ref: 'Shemot:12:1' },
];

// Returns readings filtered for the active minhag (israel | diaspora),
// in catalog order. Used by the home screen renderer.
function getSpecialReadings(minhag) {
    var m = minhag || (typeof getMinhag === 'function' ? getMinhag() : 'israel');
    var il = (m === 'israel');
    var out = [];
    for (var i = 0; i < TK_SPECIAL_READINGS.length; i++) {
        var r = TK_SPECIAL_READINGS[i];
        if (il && r.diasporaOnly) continue;
        if (!il && r.israelOnly) continue;
        out.push(r);
    }
    return out;
}

function getSpecialReadingById(id) {
    for (var i = 0; i < TK_SPECIAL_READINGS.length; i++) {
        if (TK_SPECIAL_READINGS[i].id === id) return TK_SPECIAL_READINGS[i];
    }
    return null;
}

// Group readings by category, preserving CATEGORY_ORDER. Empty
// categories are dropped (in case a future minhag filter empties one).
function getSpecialReadingsGrouped(minhag) {
    var list = getSpecialReadings(minhag);
    var byCat = {};
    for (var i = 0; i < list.length; i++) {
        var c = list[i].cat;
        if (!byCat[c]) byCat[c] = [];
        byCat[c].push(list[i]);
    }
    var groups = [];
    for (var j = 0; j < TK_SPECIAL_CATEGORY_ORDER.length; j++) {
        var cat = TK_SPECIAL_CATEGORY_ORDER[j];
        if (byCat[cat] && byCat[cat].length) {
            groups.push({
                id: cat,
                title: TK_SPECIAL_CATEGORY_TITLE[cat] || cat,
                items: byCat[cat],
            });
        }
    }
    return groups;
}

// Parse "<Sefer>:<chapter>:<verse>" into {sefer, chapter, verse}, or
// null on bad input.
function parseSpecialRef(ref) {
    if (typeof ref !== 'string') return null;
    var p = ref.split(':');
    if (p.length !== 3) return null;
    var ch = parseInt(p[1], 10);
    var v = parseInt(p[2], 10);
    if (!p[0] || !Number.isFinite(ch) || !Number.isFinite(v)) return null;
    return { sefer: p[0], chapter: ch, verse: v };
}

// Locate the token index where a given reference begins. Walks the
// flat token stream from index 0, tracking the current sefer/chapter/
// verse. Returns -1 when not found.
//
// The returned index points at the {k:'verse', num:V} marker for the
// requested verse — the first word of the reading is the next
// {k:'w'} token after it.
function findTokenForRef(tokens, sefer, chapter, verse) {
    if (!tokens || !tokens.length) return -1;
    var curSefer = null;
    var curChapter = 0;
    for (var i = 0; i < tokens.length; i++) {
        var tk = tokens[i];
        if (!tk) continue;
        if (tk.k === 'sefer') {
            curSefer = tk.name;
            continue;
        }
        if (tk.k === 'chapter') {
            curChapter = tk.num;
            continue;
        }
        if (tk.k === 'verse') {
            if (curSefer === sefer
                && curChapter === chapter
                && tk.num === verse) {
                return i;
            }
        }
    }
    return -1;
}

// Node-time export (used by tests).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TK_SPECIAL_READINGS: TK_SPECIAL_READINGS,
        TK_SPECIAL_CATEGORY_ORDER: TK_SPECIAL_CATEGORY_ORDER,
        TK_SPECIAL_CATEGORY_TITLE: TK_SPECIAL_CATEGORY_TITLE,
        getSpecialReadings: getSpecialReadings,
        getSpecialReadingById: getSpecialReadingById,
        getSpecialReadingsGrouped: getSpecialReadingsGrouped,
        parseSpecialRef: parseSpecialRef,
        findTokenForRef: findTokenForRef,
    };
}

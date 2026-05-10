/* ====================================================================
   READING CALENDAR
   --------------------------------------------------------------------
   Thin wrapper around @hebcal/core. The bundle (assets/html/js/
   hebcal.bundle.js) MUST be loaded BEFORE this file. It exposes
   window.HebcalLib = { HDate, Sedra, HebrewCalendar, Event, flags,
                        months, Locale }.

   Public API (all synchronous, fully offline):
     getMinhag()                   -> 'israel' | 'diaspora' (default 'israel')
     setMinhag(m)                  -> persist to localStorage
     getThisWeekReading(d?, m?)    -> {parasha, combinedWith, shabbatISO,
                                       hebrew, minhag} | null
     getHebrewDate(d?)             -> {y, m, d, monthName, str}
     getUpcomingSpecialDays(d, n?) -> [{gregISO, slug, hebrew, ...}]
     getFourSpecialParashiyot(d?)  -> {shekalim, zachor, para, hachodesh}
                                      (each = ISO date of the Shabbat)

   Parasha slugs returned to the rest of the app match the slugs already
   used by index.html (`Bereshit`, `LehLeha`, `Vayera`, `HayeSara`,
   `Toldot`, `Vayetze`, `Vayishlah`, `Vayeshev`, `Vayehi`, `Beshalah`,
   `KiTissa`, `Pekoudey`, `Zav`, `Tazria`, `Mezora`, `AhareiMot`,
   `Behoukotay`, `Behaaloteha`, `ShelahLeha`, `Hukat`, `Pinhas`,
   `Massey`, `Vaethanan`, `Reeh`, `KiTztze`, `KiTavo`, `Nizavim`,
   `Vayeleh`, `Haazinu`, `VezotHaberaha`, ...).
   ==================================================================== */

// ---------- Slug mapping (Hebcal name -> our internal slug) ----------
//
// Hebcal uses one canonical English transliteration; our index.html
// already has its own slugs (legacy from learnTorahApp). Maintain a
// map both directions.

var TK_HEBCAL_TO_SLUG = {
    'Bereshit': 'Bereshit',
    'Noach': 'Noah',
    'Lech-Lecha': 'LehLeha',
    'Vayera': 'Vayera',
    'Chayei Sara': 'HayeSara',
    'Toldot': 'Toldot',
    'Vayetzei': 'Vayetze',
    'Vayishlach': 'Vayishlah',
    'Vayeshev': 'Vayeshev',
    'Miketz': 'Miketz',
    'Vayigash': 'Vayigash',
    'Vayechi': 'Vayehi',
    'Shemot': 'Shemot',
    'Vaera': 'Vaera',
    'Bo': 'Bo',
    'Beshalach': 'Beshalah',
    'Yitro': 'Yitro',
    'Mishpatim': 'Mishpatim',
    'Terumah': 'Terouma',
    'Tetzaveh': 'Tetzave',
    'Ki Tisa': 'KiTissa',
    'Vayakhel': 'Vayakhel',
    'Pekudei': 'Pekoudey',
    'Vayikra': 'Vayikra',
    'Tzav': 'Zav',
    'Shmini': 'Shemini',
    'Tazria': 'Tazria',
    'Metzora': 'Mezora',
    'Achrei Mot': 'AhareiMot',
    'Kedoshim': 'Kedoshim',
    'Emor': 'Emor',
    'Behar': 'Behar',
    'Bechukotai': 'Behoukotay',
    'Bamidbar': 'Bamidbar',
    'Nasso': 'Nasso',
    "Beha'alotcha": 'Behaaloteha',
    "Sh'lach": 'ShelahLeha',
    'Korach': 'Korah',
    'Chukat': 'Hukat',
    'Balak': 'Balak',
    'Pinchas': 'Pinhas',
    'Matot': 'Matot',
    'Masei': 'Massey',
    'Devarim': 'Devarim',
    'Vaetchanan': 'Vaethanan',
    'Eikev': 'Ekev',
    "Re'eh": 'Reeh',
    'Shoftim': 'Shoftim',
    'Ki Teitzei': 'KiTztze',
    'Ki Tavo': 'KiTavo',
    'Nitzavim': 'Nizavim',
    'Vayeilech': 'Vayeleh',
    "Ha'azinu": 'Haazinu',
    'Vezot Haberakhah': 'VezotHaberaha',
};

function _hebcalToSlug(name) {
    return TK_HEBCAL_TO_SLUG[name] || name;
}

// ---------- Helpers ----------

function _isoFromDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function _upcomingShabbat(d) {
    var dt = new Date(d.getTime());
    dt.setHours(12, 0, 0, 0);
    var add = (6 - dt.getDay() + 7) % 7;
    dt.setDate(dt.getDate() + add);
    return dt;
}

function _isHebcalReady() {
    return typeof HebcalLib !== 'undefined'
        && HebcalLib && HebcalLib.HDate && HebcalLib.Sedra;
}

// ---------- Minhag (persisted) ----------

function getMinhag() {
    try {
        var v = localStorage.getItem('tk_minhag');
        if (v === 'diaspora' || v === 'israel') return v;
    } catch (e) {}
    return 'israel';
}
function setMinhag(m) {
    if (m !== 'israel' && m !== 'diaspora') return;
    try { localStorage.setItem('tk_minhag', m); } catch (e) {}
}

// ---------- Hebrew date ----------

var TK_MONTH_HEB = [
    '', 'ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול',
    'תשרי', 'חשון', 'כסלו', 'טבת', 'שבט',
    'אדר', 'אדר ב׳',
];
function _monthHeb(m, leap) {
    if (m === 12 && leap) return 'אדר א׳';
    if (m === 13) return 'אדר ב׳';
    return TK_MONTH_HEB[m] || '';
}

function getHebrewDate(d) {
    if (!_isHebcalReady()) return null;
    var hd = new HebcalLib.HDate(d || new Date());
    var y = hd.getFullYear();
    var m = hd.getMonth();
    var day = hd.getDate();
    var leap = hd.isLeapYear();
    return {
        y: y,
        m: m,
        d: day,
        monthName: _monthHeb(m, leap),
        str: day + ' ' + _monthHeb(m, leap) + ' ' + y,
        isLeap: leap,
    };
}

// ---------- This week's parasha ----------

function getThisWeekReading(d, minhag) {
    if (!_isHebcalReady()) return null;
    var ref = d || new Date();
    var sat = _upcomingShabbat(ref);
    var m = minhag || getMinhag();
    var il = (m === 'israel');
    var hd = new HebcalLib.HDate(sat);
    var year = hd.getFullYear();
    var sedra = new HebcalLib.Sedra(year, il);
    var entry;
    try {
        entry = sedra.lookup(hd.abs());
    } catch (e) {
        // Sometimes the Shabbat falls in next Hebrew year (Rosh Hashana
        // boundary); retry with year+1.
        try {
            sedra = new HebcalLib.Sedra(year + 1, il);
            entry = sedra.lookup(hd.abs());
        } catch (e2) { return null; }
    }
    if (!entry || !entry.parsha || !entry.parsha.length) return null;

    var primary = _hebcalToSlug(entry.parsha[0]);
    var combined = entry.parsha.length > 1
        ? _hebcalToSlug(entry.parsha[1]) : null;
    return {
        parasha: primary,
        combinedWith: combined,
        hebcalNames: entry.parsha.slice(),
        shabbatISO: _isoFromDate(sat),
        hebrew: hd.renderGematriya(true),
        chag: entry.chag || null,
        minhag: m,
    };
}

// ---------- Upcoming chagim / rosh chodesh / special shabbatot ----------

function getUpcomingSpecialDays(d, days) {
    if (!_isHebcalReady()) return [];
    days = days || 30;
    var start = new Date((d || new Date()).getTime());
    start.setHours(0, 0, 0, 0);
    var end = new Date(start.getTime());
    end.setDate(end.getDate() + days);

    var il = (getMinhag() === 'israel');
    var f = HebcalLib.flags;
    var mask = f.CHAG | f.LIGHT_CANDLES | f.YOM_TOV_ENDS
            | f.CHANUKAH_CANDLES | f.ROSH_CHODESH | f.SPECIAL_SHABBAT
            | f.MINOR_HOLIDAY | f.MAJOR_FAST | f.MINOR_FAST
            | f.CHOL_HAMOED;

    var events;
    try {
        events = HebcalLib.HebrewCalendar.calendar({
            start: start,
            end: end,
            il: il,
            mask: mask,
            sedrot: false,
            candlelighting: false,
            noModern: true,
        });
    } catch (e) {
        return [];
    }

    var out = [];
    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (!ev.observedIn(il)) continue;
        var date = ev.getDate();
        var greg = date.greg();
        // Resolve the parasha-of-the-week target the user can JUMP to
        // for this event:
        //  - Shabbat events (special parshiyot, special-shabbat) -> the
        //    parasha read on that Shabbat itself.
        //  - Chag / fast / rosh chodesh on a non-Shabbat -> the parasha
        //    of the upcoming Shabbat (closest reading).
        // If we cannot resolve, the row is rendered non-clickable.
        var jumpParasha = null;
        try {
            var info = getThisWeekReading(greg, getMinhag());
            if (info && info.parasha) jumpParasha = info.parasha;
        } catch (e2) {}
        out.push({
            gregISO: _isoFromDate(greg),
            hebrew: date.renderGematriya(true),
            desc: ev.getDesc(),
            descHebrew: ev.render('he-x-NoNikud'),
            mask: ev.getFlags(),
            slug: _categorize(ev),
            isShabbat: greg.getDay() === 6,
            jumpParasha: jumpParasha,
        });
    }
    return out;
}

function _categorize(ev) {
    var f = HebcalLib.flags;
    var m = ev.getFlags();
    if (m & f.ROSH_CHODESH) return 'rosh_chodesh';
    if (m & f.SPECIAL_SHABBAT) return 'special_shabbat';
    if (m & f.CHANUKAH_CANDLES) return 'chanukah';
    if (m & f.CHAG) return 'chag';
    if (m & f.CHOL_HAMOED) return 'chol_hamoed';
    if (m & f.MAJOR_FAST) return 'major_fast';
    if (m & f.MINOR_FAST) return 'minor_fast';
    if (m & f.MINOR_HOLIDAY) return 'minor_holiday';
    return 'other';
}

// ---------- Four special parashiyot ----------

function getFourSpecialParashiyot(d) {
    if (!_isHebcalReady()) return null;
    var ref = d || new Date();
    var hd = new HebcalLib.HDate(ref);
    var year = hd.getFullYear();
    // Look for these events in the window (Adar - Nisan) of the
    // current Hebrew year.
    var months = HebcalLib.months;
    var firstAdar = new Date(new HebcalLib.HDate(
        1, hd.isLeapYear() ? months.ADAR_I : months.ADAR_II, year,
    ).greg());
    var lastNisan = new Date(new HebcalLib.HDate(
        30, months.NISAN, year,
    ).greg());

    var events;
    try {
        events = HebcalLib.HebrewCalendar.calendar({
            start: firstAdar,
            end: lastNisan,
            il: getMinhag() === 'israel',
            mask: HebcalLib.flags.SPECIAL_SHABBAT,
            sedrot: false,
            candlelighting: false,
            noModern: true,
        });
    } catch (e) {
        return null;
    }

    var out = { shekalim: null, zachor: null, para: null, hachodesh: null };
    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var iso = _isoFromDate(ev.getDate().greg());
        var desc = ev.getDesc();
        if (desc === 'Shabbat Shekalim') out.shekalim = iso;
        else if (desc === 'Shabbat Zachor') out.zachor = iso;
        else if (desc === 'Shabbat Parah') out.para = iso;
        else if (desc === 'Shabbat HaChodesh') out.hachodesh = iso;
    }
    return out;
}

// ---------- Backward-compat shim ----------
//
// Older callers do `_loadCalendarOnce(cb)` then call
// getThisWeekReading. Now everything is synchronous, but keep the
// shim so we don't break those callers.
function _loadCalendarOnce(cb) {
    if (cb) cb({});
}

// ---------- Node-time export (for tests) ----------
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getMinhag: getMinhag,
        setMinhag: setMinhag,
        getThisWeekReading: getThisWeekReading,
        getHebrewDate: getHebrewDate,
        getUpcomingSpecialDays: getUpcomingSpecialDays,
        getFourSpecialParashiyot: getFourSpecialParashiyot,
        TK_HEBCAL_TO_SLUG: TK_HEBCAL_TO_SLUG,
    };
}

// Tree-shake just what we need from @hebcal/core. Whatever we export
// here ends up on `window.HebcalLib`.

export {
    HDate,            // Hebrew date class
    Sedra,            // weekly parasha schedule for a Hebrew year
    HebrewCalendar,   // generates events (chagim, rosh chodesh, etc.)
    Event,
    flags,            // event-type bitmask constants
    months,           // Hebrew month enum (NISAN=1, IYYAR=2, ...)
    Locale,           // Hebrew/English/transliteration string lookups
} from '@hebcal/core';

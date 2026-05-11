#!/usr/bin/env python3
"""Patch torah.json with kri/ketiv information from OSHB.

Background
==========

The Torah scroll text (kethiv -- כתיב, "what is WRITTEN") and the
spoken reading tradition (qere -- קרי, "what is READ") differ at a
finite set of places. Each affected word has TWO forms whose
consonants differ. Both forms are masoretic; neither replaces the
other -- the kethiv is the scroll spelling, the qere is the read
spelling, and a Torah reader must produce the qere with their voice
while the parchment in front of them carries the kethiv.

The four diacritic-display modes our app exposes are:
  - full (taamim + nikud)    -> default
  - nikud only               -> after tapping the taamim pill
  - taamim only              -> after tapping the nikud pill
  - plain (no nikud,no taam) -> after tapping both pills

The qere is voweled (vowels exist only in the reading tradition).
The kethiv is unvoweled (it's the scroll's exact letter sequence).
So the mode-to-form mapping is:

  - full / nikud / taamim   -> qere  (we already have it: `f`/`n`/`t`)
  - plain                   -> kethiv (currently we wrongly fall back
                                       to `s`, which is the qere's
                                       consonants -- not the scroll)

This script:
  1. Reads OSHB's WLC XML for the five Chumash books.
  2. Extracts every <w type="x-ketiv">...</w> pair (kethiv + qere).
  3. Locates the corresponding word token inside our torah.json
     by matching (sefer_he, chapter, verse) and the plain-consonant
     form of the qere against the existing `s` field.
  4. Sets that token's `ket` field to the OSHB kethiv text.
  5. Rewrites torah.json AND regenerates torah.js (the in-WebView
     shim that wraps the same JSON).

Why a build-time patch and not runtime
======================================

The runtime renderer (tikunScript.js) should not have to do
network-dependent lookups. We bake the kethiv into the bundled
content so the OTA-distributed update is self-contained.

Provenance
==========

OSHB (Open Scriptures Hebrew Bible) is a public-domain machine
transcription of the Leningrad Codex (Codex Leningradensis B19A,
the oldest complete masoretic Tanakh manuscript). The k/q tagging
in OSHB tracks the Leningrad masorah faithfully.

If you want the Aleppo Codex masorah instead, swap the data source;
the format used here would need adjustment.
"""

from __future__ import annotations
import json
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "assets" / "html" / "data" / "torah.json"
JS_SHIM = ROOT / "assets" / "html" / "data" / "torah.js"
CACHE = Path("/tmp") / "oshb"
CACHE.mkdir(parents=True, exist_ok=True)


OSHB_BASE = "https://raw.githubusercontent.com/openscriptures/morphhb/master/wlc"
BOOKS = [
    # (OSHB osis id, file name, Hebrew name as in torah.json)
    ("Gen",  "Gen.xml",  "בראשית"),
    ("Exod", "Exod.xml", "שמות"),
    ("Lev",  "Lev.xml",  "ויקרא"),
    ("Num",  "Num.xml",  "במדבר"),
    ("Deut", "Deut.xml", "דברים"),
]

OSIS_NS = "{http://www.bibletechnologies.net/2003/OSIS/namespace}"

# Hebrew nikud + taamim ranges + maqaf + sof-pasuq -- everything
# that's NOT a base consonant. We strip these to compare the OSHB
# qere against our `s` field (which is plain consonants).
DIACRITICS_RE = re.compile(
    "["
    "\u0591-\u05BD"  # taamim
    "\u05BF"          # rafe
    "\u05C1-\u05C7"  # shin/sin/holam/dagesh marks
    "\u05BE"          # maqaf
    "\u05C0"          # paseq
    "\u05C3"          # sof-pasuq
    "\u05F3\u05F4"    # geresh/gershayim
    "]"
)


def _plain(s: str) -> str:
    """Strip diacritics + sof-pasuq + leading/trailing whitespace."""
    s = unicodedata.normalize("NFC", s)
    return DIACRITICS_RE.sub("", s).replace("׃", "").replace("/", "").strip()


# ---------------------------------------------------------------------------
# Fetch / parse OSHB
# ---------------------------------------------------------------------------

def _fetch(name: str) -> str:
    cached = CACHE / name
    if cached.exists() and cached.stat().st_size > 1000:
        return cached.read_text(encoding="utf-8")
    url = f"{OSHB_BASE}/{name}"
    # The corporate proxy can't see the public internet from off-VPN;
    # we explicitly unset it for this fetch.
    env = os.environ.copy()
    for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
        env.pop(k, None)
    print(f"  downloading {url} ...", file=sys.stderr)
    proxy_handler = urllib.request.ProxyHandler({})  # disable system proxies
    opener = urllib.request.build_opener(proxy_handler)
    with opener.open(url, timeout=60) as resp:
        txt = resp.read().decode("utf-8")
    cached.write_text(txt, encoding="utf-8")
    return txt


def extract_kq(book_osis: str, xml_text: str, sefer_he: str
               ) -> list[tuple[str, int, int, str, str]]:
    """Yield (sefer_he, chapter, verse, kethiv, qere_plain) for each
    kri/ketiv occurrence in this book."""
    root = ET.fromstring(xml_text)
    out: list[tuple[str, int, int, str, str]] = []
    for verse in root.iter(f"{OSIS_NS}verse"):
        osis_id = verse.attrib.get("osisID")
        if not osis_id or not osis_id.startswith(f"{book_osis}."):
            continue
        parts = osis_id.split(".")
        if len(parts) != 3:
            continue
        try:
            ch, vs = int(parts[1]), int(parts[2])
        except ValueError:
            continue
        # Walk children in order; each <w type="x-ketiv"> is followed
        # by a <note type="variant"> whose <rdg type="x-qere"> wraps
        # the qere <w>.
        children = list(verse)
        for i, ch_el in enumerate(children):
            if ch_el.tag != f"{OSIS_NS}w":
                continue
            if ch_el.attrib.get("type") != "x-ketiv":
                continue
            kethiv = (ch_el.text or "").strip()
            # The very next sibling should be the note carrying the qere.
            qere_plain = ""
            if i + 1 < len(children) and children[i + 1].tag == f"{OSIS_NS}note":
                note = children[i + 1]
                rdg = note.find(f"{OSIS_NS}rdg[@type='x-qere']")
                if rdg is not None:
                    qw = rdg.find(f"{OSIS_NS}w")
                    if qw is not None and qw.text:
                        qere_plain = _plain(qw.text)
            if kethiv and qere_plain:
                out.append((sefer_he, ch, vs, _plain(kethiv), qere_plain))
    return out


# ---------------------------------------------------------------------------
# Patch torah.json
# ---------------------------------------------------------------------------

def patch(catalog: list[tuple[str, int, int, str, str]]
          ) -> tuple[int, list[tuple[str, int, int, str, str]]]:
    with DATA.open(encoding="utf-8") as fh:
        data = json.load(fh)
    tokens = data["tokens"]

    # Index word tokens by (sefer, chapter, verse) -> list of indices.
    by_verse: dict[tuple[str, int, int], list[int]] = {}
    cur_sefer = cur_chap = cur_verse = None
    for i, t in enumerate(tokens):
        k = t.get("k")
        if k == "sefer":
            cur_sefer = t.get("heb")
        elif k == "chapter":
            cur_chap = t.get("num")
        elif k == "verse":
            cur_verse = t.get("num")
        elif k == "w":
            by_verse.setdefault((cur_sefer, cur_chap, cur_verse), []).append(i)

    matched = 0
    missed: list[tuple[str, int, int, str, str]] = []
    for entry in catalog:
        sefer, ch, vs, kethiv, qere_plain = entry
        idxs = by_verse.get((sefer, ch, vs), [])
        target = None
        for i in idxs:
            if _plain(tokens[i].get("s", "")) == qere_plain:
                target = i
                break
        if target is None:
            missed.append(entry)
            continue
        tokens[target]["ket"] = kethiv
        matched += 1

    # Re-serialise. Use a compact form to keep the file small (matches
    # how it was built originally).
    with DATA.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))

    if JS_SHIM.exists():
        payload = DATA.read_text(encoding="utf-8")
        JS_SHIM.write_text(
            "window.__TORAH_DATA__ = " + payload + ";\n",
            encoding="utf-8",
        )

    return matched, missed


def main() -> int:
    print("Fetching OSHB Torah books ...", file=sys.stderr)
    catalog: list[tuple[str, int, int, str, str]] = []
    for osis, fname, sefer_he in BOOKS:
        xml = _fetch(fname)
        entries = extract_kq(osis, xml, sefer_he)
        print(f"  {sefer_he:>8}: {len(entries)} kri/ketiv", file=sys.stderr)
        catalog.extend(entries)
    print(f"Total Torah kri/ketiv catalogued: {len(catalog)}", file=sys.stderr)

    matched, missed = patch(catalog)
    print(f"\nPatched {matched}/{len(catalog)} entries into torah.json.")
    if missed:
        print(
            f"\n{len(missed)} entries could not be matched (qere "
            f"plain consonants not found among that verse's word "
            f"tokens). Listing first 10:",
            file=sys.stderr,
        )
        for e in missed[:10]:
            print(f"  {e}", file=sys.stderr)
    return 0 if not missed else 2


if __name__ == "__main__":
    raise SystemExit(main())

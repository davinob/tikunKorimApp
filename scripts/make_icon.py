#!/usr/bin/env python3
"""Generate the launcher icon for tikunKorimApp.

Design (single 1024x1024 PNG that flutter_launcher_icons fans out into
all the mipmap densities + the round + adaptive variants):

  - Soft parchment background — same color used on the reading page
    (the "feel" the user sees inside the app).
  - Two scroll-shaped roller circles framing the page, suggesting an
    open Sefer Torah viewed from the front.
  - A single large Hebrew letter — ת — rendered in the StamAshkenazCLM
    font, the very same scribal style used inside the app for the
    rendered Torah text. The ת is the last letter of the Hebrew
    alphabet AND the last letter of the word "תורה", so it reads
    instantly as "Hebrew sacred-text app" without committing to a
    long phrase that would shrink unreadably small at the launcher
    size.
  - A subtle warm shadow under the letter so it pops at small sizes.

Why a single letter and not a multi-word title:
  - At the launcher size (48-96px on most devices) any multi-letter
    Hebrew text (e.g. "תיקון קוראים") becomes a smear. Modern launcher
    icons are recognised by silhouette + colour, not legible text.
  - The StamAshkenazCLM ת has a strong, distinctive silhouette
    (heavy left foot + thin right foot + bar across the top) that
    survives downscaling and reads as "Torah scroll text" even at
    small sizes.

We also emit the adaptive-icon FOREGROUND layer (the same letter on
a transparent background, scaled into the safe zone — Android crops
adaptive icons to a 66dp inner circle / squircle / etc. depending on
the launcher, so the foreground must live inside the central 66% of
the canvas). The flutter_launcher_icons package handles wiring this
into res/mipmap-anydpi-v26/ic_launcher.xml + the corresponding XML
drawable + a background colour resource.
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "icon"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Source font: same Stam font used inside the reader (so the icon's
# letter and the words on the reading page feel like one design).
FONT_PATH = ROOT / "assets" / "html" / "fonts" / "StamAshkenazCLM.ttf"

# Brand palette:
#   - parchment (#F4ECD8): the colour of `--colorParchment` in stylesTikun.css.
#   - ink (#2A1A0A): the dark warm brown of `--colorScrollInk`.
#   - accent gold (#B07B2D): used for verse numbers / aliyah labels.
PARCHMENT = (244, 236, 216, 255)
INK = (42, 26, 10, 255)
GOLD = (176, 123, 45, 255)
ROLLER = (101, 67, 33, 255)  # dark walnut for the scroll rollers


def make_full_icon(size: int = 1024) -> Image.Image:
    """The full 1024x1024 launcher icon (background + foreground in
    one image). Used for the legacy square mipmap-{m,h,xh,xxh,xxxh}dpi
    PNGs and as the Play Store 512x512 store icon (downscaled)."""
    img = Image.new("RGBA", (size, size), PARCHMENT)
    draw = ImageDraw.Draw(img)

    # ---- Scroll silhouette ----
    # Two circular roller-caps top & bottom give the icon a "scroll
    # framed by wood" silhouette without trying to draw fiddly handles
    # at icon resolution (anything thinner than ~1.5% of the icon
    # disappears at 48px).
    roller_h = int(size * 0.13)
    draw.rectangle((0, 0, size, roller_h), fill=ROLLER)
    draw.rectangle((0, size - roller_h, size, size), fill=ROLLER)
    # Highlight strip on each roller.
    hl = int(roller_h * 0.18)
    draw.rectangle(
        (0, roller_h - hl - 2, size, roller_h - 2),
        fill=(132, 92, 50, 255),
    )
    draw.rectangle(
        (0, size - roller_h, size, size - roller_h + hl),
        fill=(132, 92, 50, 255),
    )

    # ---- Central Hebrew letter ת ----
    letter = "ת"
    # Pick the largest font size that fits inside the central
    # parchment band with a comfortable margin. We binary-search
    # because Stam fonts have unusual metrics (very tall ascenders,
    # short descenders) and Pillow's default sizing doesn't match
    # the bbox the user actually perceives.
    band_h = size - 2 * roller_h
    target_h = int(band_h * 0.74)
    target_w = int(size * 0.62)

    def fits(font_size: int) -> bool:
        f = ImageFont.truetype(str(FONT_PATH), font_size)
        bbox = f.getbbox(letter)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        return w <= target_w and h <= target_h

    lo, hi = 100, 2000
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fits(mid):
            lo = mid
        else:
            hi = mid - 1
    font_size = lo
    font = ImageFont.truetype(str(FONT_PATH), font_size)

    bbox = font.getbbox(letter)
    lw = bbox[2] - bbox[0]
    lh = bbox[3] - bbox[1]
    # Center inside the central band.
    cx = (size - lw) // 2 - bbox[0]
    cy = roller_h + (band_h - lh) // 2 - bbox[1]

    # Subtle warm shadow under the letter so it pops at 48px.
    shadow_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.text((cx + int(size * 0.012), cy + int(size * 0.018)),
            letter, font=font, fill=(0, 0, 0, 90))
    shadow_layer = shadow_layer.filter(
        ImageFilter.GaussianBlur(radius=int(size * 0.012)))
    img.alpha_composite(shadow_layer)

    # The letter itself.
    draw = ImageDraw.Draw(img)
    draw.text((cx, cy), letter, font=font, fill=INK)

    # ---- Thin gold inner frame ----
    # Echoes the gutter / aliyah-label gold inside the reader.
    inset = int(size * 0.045)
    frame_h = max(2, int(size * 0.005))
    draw.rectangle(
        (inset, roller_h + inset // 2,
         size - inset, roller_h + inset // 2 + frame_h),
        fill=GOLD,
    )
    draw.rectangle(
        (inset, size - roller_h - inset // 2 - frame_h,
         size - inset, size - roller_h - inset // 2),
        fill=GOLD,
    )
    return img


def make_adaptive_foreground(size: int = 1024) -> Image.Image:
    """Adaptive-icon foreground (Android 8+).

    Android adaptive icons are 108dp, of which only the central 66dp
    is guaranteed visible (the launcher crops the outer 21dp ring as
    a circle / squircle / teardrop / etc.). We render the letter at
    the same size as the legacy icon but on a TRANSPARENT
    background, with the same gold frame strips and a very thin
    parchment-coloured fill BEHIND the letter to keep stroke contrast
    when launchers compose it over the brown background colour.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Safe zone = central 66% of the canvas. Anything outside may be
    # cropped by the launcher.
    safe = int(size * 0.66)
    safe_off = (size - safe) // 2

    # Soft parchment circle as the visible "scroll page".
    page = Image.new("RGBA", img.size, (0, 0, 0, 0))
    pd = ImageDraw.Draw(page)
    pd.ellipse(
        (safe_off, safe_off, safe_off + safe, safe_off + safe),
        fill=PARCHMENT,
    )
    img.alpha_composite(page)

    # Gold frame ring just inside the safe edge.
    rd = ImageDraw.Draw(img)
    ring_w = max(3, int(size * 0.012))
    rd.ellipse(
        (safe_off, safe_off, safe_off + safe, safe_off + safe),
        outline=GOLD, width=ring_w,
    )

    # Letter ת sized to fit the safe circle.
    letter = "ת"
    target = int(safe * 0.66)

    def fits(font_size: int) -> bool:
        f = ImageFont.truetype(str(FONT_PATH), font_size)
        b = f.getbbox(letter)
        return (b[2] - b[0]) <= target and (b[3] - b[1]) <= target

    lo, hi = 100, 2000
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fits(mid):
            lo = mid
        else:
            hi = mid - 1
    font = ImageFont.truetype(str(FONT_PATH), lo)
    bbox = font.getbbox(letter)
    lw = bbox[2] - bbox[0]
    lh = bbox[3] - bbox[1]
    cx = (size - lw) // 2 - bbox[0]
    cy = (size - lh) // 2 - bbox[1]

    # Shadow + letter.
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.text((cx + int(size * 0.012), cy + int(size * 0.018)),
            letter, font=font, fill=(0, 0, 0, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=int(size * 0.012)))
    img.alpha_composite(shadow)

    rd2 = ImageDraw.Draw(img)
    rd2.text((cx, cy), letter, font=font, fill=INK)
    return img


def make_feature_graphic(width: int = 1024, height: int = 500) -> Image.Image:
    """Play Store feature graphic (REQUIRED, 1024x500 PNG/JPEG).

    This is the wide banner that sits at the top of the store listing
    page on phones (and is also used for promo placements). The Play
    Console rejects anything that isn't exactly 1024x500. We mirror
    the launcher-icon palette and place the same Stam ת on the right
    edge with the app name in Hebrew + English to its left -- this
    way the banner reads as part of the same brand even when shown
    next to the launcher icon.
    """
    img = Image.new("RGBA", (width, height), PARCHMENT)
    draw = ImageDraw.Draw(img)

    # Walnut top + bottom strip for the Sefer-Torah-roller motif.
    strip = int(height * 0.13)
    draw.rectangle((0, 0, width, strip), fill=ROLLER)
    draw.rectangle((0, height - strip, width, height), fill=ROLLER)
    draw.rectangle((0, strip - 4, width, strip), fill=(132, 92, 50, 255))
    draw.rectangle((0, height - strip, width, height - strip + 4),
                   fill=(132, 92, 50, 255))

    # ת on the right edge (RTL: the visual "starting" side for Hebrew).
    letter = "ת"
    target_h = int((height - 2 * strip) * 0.85)

    def fits(font_size: int) -> bool:
        f = ImageFont.truetype(str(FONT_PATH), font_size)
        b = f.getbbox(letter)
        return (b[3] - b[1]) <= target_h

    lo, hi = 100, 1500
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fits(mid):
            lo = mid
        else:
            hi = mid - 1
    font_letter = ImageFont.truetype(str(FONT_PATH), lo)
    bbox = font_letter.getbbox(letter)
    lw = bbox[2] - bbox[0]
    lh = bbox[3] - bbox[1]
    cx = width - lw - bbox[0] - int(width * 0.07)
    cy = strip + ((height - 2 * strip) - lh) // 2 - bbox[1]
    # Shadow.
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.text((cx + 8, cy + 12), letter, font=font_letter, fill=(0, 0, 0, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=10))
    img.alpha_composite(shadow)
    draw = ImageDraw.Draw(img)
    draw.text((cx, cy), letter, font=font_letter, fill=INK)

    # Title block on the LEFT (LTR text fits left-aligned into the
    # space the ת doesn't occupy on the right).
    drugulin = ROOT / "assets" / "html" / "fonts" / "DrugulinCLM-Bold.otf"
    title_font = ImageFont.truetype(str(drugulin), int(height * 0.22))
    sub_font = ImageFont.truetype(str(drugulin), int(height * 0.10))

    # Pillow draws codepoints in the source order without applying
    # BiDi reordering. To get a Hebrew phrase to read correctly
    # (right-to-left) on a left-to-right canvas, we reverse BOTH
    # word order AND each word's letters: the first visible word on
    # the right edge must be drawn last (i.e. rightmost in the
    # source), and the letters of each word must be flipped so that
    # the canvas's left-to-right scan produces the correct RTL
    # reading. Reversing the entire string at once does both at
    # once. (Words with combining nikud / te'amim would need a full
    # BiDi pass, but the title is plain consonants only.)
    title_he = "תיקון קוראים"[::-1]
    title_en = "Tikun Korim"
    sub = "Learn the cantillation"

    # Position at left, vertically centered around the band.
    x0 = int(width * 0.08)
    title_he_bbox = title_font.getbbox(title_he)
    th = title_he_bbox[3] - title_he_bbox[1]
    title_en_bbox = title_font.getbbox(title_en)
    teh = title_en_bbox[3] - title_en_bbox[1]
    sub_bbox = sub_font.getbbox(sub)
    sh = sub_bbox[3] - sub_bbox[1]
    block_h = th + 16 + teh + 24 + sh
    y0 = strip + ((height - 2 * strip) - block_h) // 2 - title_he_bbox[1]
    draw.text((x0, y0), title_he, font=title_font, fill=INK)
    y1 = y0 + th + 16 - title_en_bbox[1] + title_he_bbox[1]
    draw.text((x0, y1), title_en, font=title_font, fill=INK)
    y2 = y1 + teh + 24 - sub_bbox[1] + title_en_bbox[1]
    draw.text((x0, y2), sub, font=sub_font, fill=GOLD)
    return img


def main() -> int:
    print(f"Generating launcher icons under {OUT_DIR}")
    full = make_full_icon(1024)
    full.save(OUT_DIR / "ic_launcher.png", "PNG")
    print(f"  ic_launcher.png  1024x1024  {(OUT_DIR / 'ic_launcher.png').stat().st_size} bytes")

    fg = make_adaptive_foreground(1024)
    fg.save(OUT_DIR / "ic_launcher_foreground.png", "PNG")
    print(f"  ic_launcher_foreground.png  1024x1024  {(OUT_DIR / 'ic_launcher_foreground.png').stat().st_size} bytes")

    # Play Store hi-res icon: same image, downscaled to 512x512 with
    # the high-quality LANCZOS resampler. The Play Console rejects
    # hi-res icons that aren't EXACTLY 512x512 PNG / JPEG.
    play = full.resize((512, 512), Image.LANCZOS)
    play.save(OUT_DIR / "play_store_icon_512.png", "PNG")
    print(f"  play_store_icon_512.png  512x512  {(OUT_DIR / 'play_store_icon_512.png').stat().st_size} bytes")

    feat = make_feature_graphic(1024, 500)
    feat.save(OUT_DIR / "play_feature_graphic_1024x500.png", "PNG")
    print(f"  play_feature_graphic_1024x500.png  1024x500  {(OUT_DIR / 'play_feature_graphic_1024x500.png').stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

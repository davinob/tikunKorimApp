#!/usr/bin/env python3
"""Generate the launcher icon for tikunKorimApp.

Design approach (per the user's request: "take the same image and
just fill it with the brown color"):

  - Source: the existing learnTorahApp launcher icon
    (`ic_launcher.png` from its `mipmap-xxxhdpi` folder), which is
    a Sefer-Torah-scroll silhouette composed of two rectangular
    rollers + a parchment page with horizontal text strokes, drawn
    in a flat blue (#3F51F5-ish).
  - Transformation: keep the silhouette pixel-for-pixel identical
    so the three sibling apps (learnTorah / learnTanah / tikun)
    read as one design family. Re-colour every "blue" pixel to a
    saddle/walnut brown to differentiate the tikun reader, while
    leaving the white/transparent pixels alone.
  - Upscale the recoloured 192x192 source to 1024x1024 using
    Pillow's LANCZOS resampler, which preserves the crisp edges
    of the rectangular shapes.
  - Emit:
      assets/icon/ic_launcher.png            (1024x1024 full icon)
      assets/icon/ic_launcher_foreground.png (1024x1024 adaptive
                                              foreground, scaled into
                                              the central 66% safe
                                              zone with a transparent
                                              outer ring)
      assets/icon/play_store_icon_512.png    (512x512 store icon)
      assets/icon/play_feature_graphic_1024x500.png (banner)
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "icon"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Source silhouette: the learnTorahApp scroll icon. Highest-res copy
# we have on disk is the 192x192 xxxhdpi mipmap; we upscale.
SOURCE_ICON = (
    ROOT.parent
    / "learnTorahApp"
    / "android"
    / "app"
    / "src"
    / "main"
    / "res"
    / "mipmap-xxxhdpi"
    / "ic_launcher.png"
)

# Brand palette: brown for tikun (vs. blue for Torah, green for Tanah).
# Saddle/walnut brown that reads warmly against parchment-cream and
# also against pure white.
BROWN = (101, 67, 33, 255)
PARCHMENT = (244, 236, 216, 255)
INK = (42, 26, 10, 255)
GOLD = (176, 123, 45, 255)

FONT_PATH = ROOT / "assets" / "html" / "fonts" / "StamAshkenazCLM.ttf"


def _recolor_to_brown(src: Image.Image) -> Image.Image:
    """Replace every silhouette pixel with full-saturation brown,
    using the original pixel's "darkness" (1 - lightness) as the
    output alpha. White / very-light pixels become fully transparent;
    deep-blue interior pixels become fully opaque brown. This keeps
    edge antialiasing crisp without desaturating the interior, since
    every silhouette pixel is the SAME brown -- only its opacity
    changes along the antialiased edge."""
    src = src.convert("RGBA")
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    pa = src.load()
    pb = out.load()
    br, bg, bb, _ = BROWN
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = pa[x, y]
            if a < 5:
                # Already transparent; leave it.
                pb[x, y] = (0, 0, 0, 0)
                continue
            # Compute "ink coverage": how dark / non-white this
            # pixel is. 0 = pure white background, 255 = pure
            # silhouette interior. We use the minimum channel as
            # the proxy for darkness (works for both white-on-blue
            # and white-on-anything backgrounds), which gives a
            # smooth falloff at antialiased edges.
            mn = min(r, g, b)
            coverage = 255 - mn
            if coverage < 8:
                pb[x, y] = (0, 0, 0, 0)
            else:
                pb[x, y] = (br, bg, bb, min(255, coverage * a // 255))
    return out


def _load_recoloured(target: int = 1024) -> Image.Image:
    """Load the source learnTorahApp icon, recolour to brown, and
    upscale to `target`x`target` pixels with LANCZOS."""
    if not SOURCE_ICON.exists():
        raise FileNotFoundError(
            f"Source icon not found at {SOURCE_ICON}. This script "
            f"depends on the learnTorahApp repo being a sibling of "
            f"tikunKorimApp on disk."
        )
    src = Image.open(SOURCE_ICON).convert("RGBA")
    rec = _recolor_to_brown(src)
    return rec.resize((target, target), Image.LANCZOS)


def make_full_icon(size: int = 1024) -> Image.Image:
    """Full launcher icon: brown scroll silhouette on white."""
    icon = _load_recoloured(size)
    bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    bg.alpha_composite(icon)
    return bg


def make_adaptive_foreground(size: int = 1024) -> Image.Image:
    """Adaptive foreground (Android 8+).

    Android adaptive icons are composed of background + foreground
    layers. The foreground is 108dp, of which only the central 66dp
    is guaranteed visible (the launcher crops the outer 21dp ring).
    We draw the recoloured scroll into the central ~66% of the
    canvas on a fully transparent ground, so the launcher shows the
    scroll on top of whatever background colour pubspec.yaml
    configures (white)."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * 0.66)
    inset = (size - inner) // 2
    icon = _load_recoloured(inner)
    canvas.alpha_composite(icon, (inset, inset))
    return canvas


def make_feature_graphic(width: int = 1024, height: int = 500) -> Image.Image:
    """Play Store feature graphic (REQUIRED, 1024x500 PNG/JPEG).

    Uses the same palette as the launcher icon: white background,
    brown scroll silhouette on the right (RTL "starting" side for a
    Hebrew-language app), and the title in Hebrew + English on the
    left."""
    img = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)

    icon_h = int(height * 0.86)
    icon_y = (height - icon_h) // 2
    icon = _load_recoloured(icon_h)
    img.alpha_composite(icon, (width - icon_h - int(width * 0.05), icon_y))

    drugulin = ROOT / "assets" / "html" / "fonts" / "DrugulinCLM-Bold.otf"
    title_font = ImageFont.truetype(str(drugulin), int(height * 0.20))
    sub_font = ImageFont.truetype(str(drugulin), int(height * 0.10))

    title_he = "תיקון קוראים"[::-1]
    title_en = "Tikun Korim"
    sub = "Learn the cantillation"

    x0 = int(width * 0.06)
    title_he_bbox = title_font.getbbox(title_he)
    th = title_he_bbox[3] - title_he_bbox[1]
    title_en_bbox = title_font.getbbox(title_en)
    teh = title_en_bbox[3] - title_en_bbox[1]
    sub_bbox = sub_font.getbbox(sub)
    sh = sub_bbox[3] - sub_bbox[1]
    block_h = th + 16 + teh + 24 + sh
    y0 = (height - block_h) // 2 - title_he_bbox[1]
    draw.text((x0, y0), title_he, font=title_font, fill=BROWN)
    y1 = y0 + th + 16 - title_en_bbox[1] + title_he_bbox[1]
    draw.text((x0, y1), title_en, font=title_font, fill=BROWN)
    y2 = y1 + teh + 24 - sub_bbox[1] + title_en_bbox[1]
    draw.text((x0, y2), sub, font=sub_font, fill=GOLD)
    return img


def main() -> int:
    print(f"Generating launcher icons under {OUT_DIR}")
    full = make_full_icon(1024)
    full.save(OUT_DIR / "ic_launcher.png", "PNG")
    print(
        f"  ic_launcher.png  1024x1024  "
        f"{(OUT_DIR / 'ic_launcher.png').stat().st_size} bytes"
    )

    fg = make_adaptive_foreground(1024)
    fg.save(OUT_DIR / "ic_launcher_foreground.png", "PNG")
    print(
        f"  ic_launcher_foreground.png  1024x1024  "
        f"{(OUT_DIR / 'ic_launcher_foreground.png').stat().st_size} bytes"
    )

    play = full.resize((512, 512), Image.LANCZOS)
    play.save(OUT_DIR / "play_store_icon_512.png", "PNG")
    print(
        f"  play_store_icon_512.png  512x512  "
        f"{(OUT_DIR / 'play_store_icon_512.png').stat().st_size} bytes"
    )

    # Feature graphic: render at 2x (2048x1000) for retina-quality
    # downscaling, then flatten alpha to a flat-white RGB image so
    # Play Console accepts it (Play rejects PNGs with an alpha
    # channel on the feature-graphic field with the misleading
    # error "You can't select or crop this image because it's too
    # small"). We save BOTH:
    #   - play_feature_graphic_1024x500.png  (the spec size)
    #   - play_feature_graphic_2048x1000.png (a doubled version
    #     in case Play Console asks for a high-DPI source on
    #     particular screen densities)
    # Both are flat-RGB JPEG-equivalents wrapped in PNG.
    feat = make_feature_graphic(2048, 1000)
    flat = Image.new("RGB", feat.size, (255, 255, 255))
    flat.paste(feat, mask=feat.split()[3] if feat.mode == "RGBA" else None)
    flat.save(OUT_DIR / "play_feature_graphic_2048x1000.png", "PNG")
    print(
        f"  play_feature_graphic_2048x1000.png  2048x1000  "
        f"{(OUT_DIR / 'play_feature_graphic_2048x1000.png').stat().st_size} bytes"
    )
    flat_small = flat.resize((1024, 500), Image.LANCZOS)
    flat_small.save(OUT_DIR / "play_feature_graphic_1024x500.png", "PNG")
    print(
        f"  play_feature_graphic_1024x500.png  1024x500  "
        f"{(OUT_DIR / 'play_feature_graphic_1024x500.png').stat().st_size} bytes"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

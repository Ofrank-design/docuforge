#!/usr/bin/env python3
"""
Regenerates every derived brand file from the originals in docs-assets/source/.
Requires Pillow:  pip install pillow      Run:  python3 scripts/brand-assets.py

Outputs
  docs-assets/            README images (logo, hero, showcase, icon)
  packages/cli/starter/public/    icon set copied into new projects by `docuforge init`
  fixtures/sample-docs/public/    icon set + social image used by the sample site
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs-assets" / "source"
NAVY = (11, 16, 40, 255)  # the dark tile colour from the brand sheet's app icon


def crop_alpha(im: Image.Image, pad_ratio: float = 0.0) -> Image.Image:
    box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(box)
    if pad_ratio:
        side = max(im.size)
        pad = int(side * pad_ratio)
        canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
        canvas.paste(im, (pad, pad))
        im = canvas
    return im


def square(im: Image.Image) -> Image.Image:
    side = max(im.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas


def tile(mark: Image.Image, size: int, radius_ratio: float = 0.22, inset: float = 0.62) -> Image.Image:
    """Mark centred on a dark rounded tile (used where transparency is not allowed, e.g. iOS)."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(out).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=NAVY)
    m = mark.resize((int(size * inset), int(size * inset)), Image.LANCZOS)
    out.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return out


def save_png(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)


def main() -> None:
    icon = square(crop_alpha(Image.open(SRC / "icon.png").convert("RGBA"), pad_ratio=0.06))
    wordmark = crop_alpha(Image.open(SRC / "logo.png").convert("RGBA"), pad_ratio=0.04)

    # --- icon set -----------------------------------------------------------------
    for public in (ROOT / "packages/cli/starter/public", ROOT / "fixtures/sample-docs/public"):
        save_png(icon.resize((192, 192), Image.LANCZOS), public / "favicon.png")
        save_png(icon.resize((256, 256), Image.LANCZOS), public / "logo-mark.png")
        save_png(tile(icon, 180), public / "apple-touch-icon.png")
        icon.resize((256, 256), Image.LANCZOS).save(
            public / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
        )

    # --- social image (1200x630, ~1.9:1) cropped from the hero ---------------------
    hero = Image.open(SRC / "hero.png").convert("RGB")
    w, h = hero.size
    target = 1200 / 630
    ch = int(w / target)
    top = max(0, (h - ch) // 2)
    og = hero.crop((0, top, w, top + ch)).resize((1200, 630), Image.LANCZOS)
    og.save(ROOT / "fixtures/sample-docs/public/og-image.jpg", quality=84, optimize=True, progressive=True)

    # --- README images --------------------------------------------------------------
    assets = ROOT / "docs-assets"
    save_png(wordmark.resize((900, round(900 * wordmark.height / wordmark.width)), Image.LANCZOS), assets / "logo.png")
    save_png(icon.resize((256, 256), Image.LANCZOS), assets / "icon.png")
    hero.resize((1600, round(1600 * h / w)), Image.LANCZOS).save(assets / "hero.jpg", quality=82, optimize=True, progressive=True)
    show = Image.open(SRC / "showcase.png").convert("RGB")
    sw, sh = show.size
    show.resize((1536, round(1536 * sh / sw)), Image.LANCZOS).save(assets / "showcase.jpg", quality=82, optimize=True, progressive=True)

    print("brand assets written")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Builds the real images used by fixtures/sample-docs from the brand originals. Requires Pillow."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs-assets" / "source"
OUT = ROOT / "fixtures" / "sample-docs"

hero = Image.open(SRC / "hero.png").convert("RGB")      # 1774 x 887
show = Image.open(SRC / "showcase.png").convert("RGB")  # 1536 x 1024


def fit(im: Image.Image, width: int) -> Image.Image:
    return im.resize((width, round(width * im.height / im.width)), Image.LANCZOS)


def png(im: Image.Image, path: Path, colors: int = 256) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.quantize(colors=colors, method=Image.MEDIANCUT).save(path, optimize=True)


# overview (PNG), terminal (PNG), config screenshot (JPEG), pipeline (WebP), demo (GIF), diagram (SVG)
png(fit(hero.crop((780, 150, 1774, 760)), 900), OUT / "images/overview.png")
terminal = hero.crop((1385, 390, 1745, 660))
png(fit(terminal, 640), OUT / "getting-started/images/install-terminal.png")
(OUT / "getting-started/images").mkdir(parents=True, exist_ok=True)
fit(hero.crop((830, 190, 1510, 660)), 800).save(OUT / "getting-started/images/config-file.jpg", quality=80, optimize=True)
(OUT / "guides/images").mkdir(parents=True, exist_ok=True)
fit(show.crop((0, 0, 1536, 650)), 900).save(OUT / "guides/images/deploy-pipeline.webp", quality=78)
frames = [fit(terminal.crop((0, 0, 360, h)), 480).quantize(colors=64) for h in (140, 200, 270)]
(OUT / "reference/images").mkdir(parents=True, exist_ok=True)
frames[0].save(OUT / "reference/images/cli-demo.gif", save_all=True, append_images=frames[1:], duration=700, loop=0, optimize=True)

(OUT / "guides/images/auth-flow.svg").write_text(
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 140" role="img" aria-labelledby="t">
  <title id="t">Authentication flow: client sends a token, the API verifies it, the job runs</title>
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#4338ca"/></marker></defs>
  <g font-family="system-ui,sans-serif" font-size="15" text-anchor="middle">
    <rect x="10" y="40" width="160" height="60" rx="10" fill="#eef0ff" stroke="#4338ca"/><text x="90" y="76" fill="#1b2030">Client</text>
    <rect x="240" y="40" width="160" height="60" rx="10" fill="#eef0ff" stroke="#4338ca"/><text x="320" y="76" fill="#1b2030">API</text>
    <rect x="470" y="40" width="160" height="60" rx="10" fill="#eef0ff" stroke="#4338ca"/><text x="550" y="76" fill="#1b2030">Job runner</text>
    <path d="M170 70H236" stroke="#4338ca" stroke-width="2" marker-end="url(#a)"/><text x="203" y="32" fill="#52607a" font-size="12">token</text>
    <path d="M400 70H466" stroke="#4338ca" stroke-width="2" marker-end="url(#a)"/><text x="433" y="32" fill="#52607a" font-size="12">verified</text>
  </g></svg>
''',
    encoding="utf-8",
)
print("sample images written")

"""Development only: package rendered PNGs and make lightweight previews.

Requires Pillow; normal application builds use the committed images directly.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


parser = argparse.ArgumentParser()
parser.add_argument("--source-dir", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / "src/assets/guide-presets"
output.mkdir(parents=True, exist_ok=True)
for name in ("front", "profile-right", "three-quarter-right"):
    image = Image.open(args.source_dir / f"guide-{name}.png").convert("RGBA")
    image.save(output / f"guide-{name}.png", optimize=True)
    image.thumbnail((320, 320), Image.Resampling.LANCZOS)
    image.save(output / f"preview-{name}.png", optimize=True)

contact = Image.new("RGB", (1200, 280), "#faf7f0")
draw = ImageDraw.Draw(contact)
font = ImageFont.truetype("DejaVuSans.ttf", 16)
views = (("front", False, "Front"), ("profile-right", True, "Left profile"), ("profile-right", False, "Right profile"), ("three-quarter-right", True, "Left 3/4"), ("three-quarter-right", False, "Right 3/4"))
for index, (name, mirrored, label) in enumerate(views):
    image = Image.open(output / f"preview-{name}.png").convert("RGBA")
    image.thumbnail((240, 240), Image.Resampling.LANCZOS)
    if mirrored:
        image = ImageOps.mirror(image)
    contact.paste(image, (index * 240, 0), image)
    draw.text((index * 240 + 120, 254), label, fill="#4a3830", anchor="mm", font=font)
preview = root / "docs/images/guide-presets-preview.png"
preview.parent.mkdir(exist_ok=True)
contact.save(preview, optimize=True)

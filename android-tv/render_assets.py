"""Rasterize the repository's SVG identity for the Android launcher."""
from pathlib import Path
import cairosvg

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "android-tv" / "app" / "src" / "main" / "res" / "drawable-nodpi"
OUTPUT.mkdir(parents=True, exist_ok=True)
cairosvg.svg2png(url=str(ROOT / "luma-logo.svg"),
                 write_to=str(OUTPUT / "luma_icon.png"), output_width=512, output_height=512)
cairosvg.svg2png(url=str(ROOT / "luma-tv-banner.svg"),
                 write_to=str(OUTPUT / "luma_banner.png"), output_width=640, output_height=360)
print("Android TV icon and banner rendered.")

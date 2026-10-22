#!/usr/bin/env python3
"""Build the four-time artwork used by the Hill Light landing page.

One wide master (flower.jpg) is graded four times and cropped into the two
wallpaper ratios used across the site: 16:9 for the page and 21:9 for wide
screens. Each page image is written at a full and a phone-sized width in
AVIF + WebP + JPEG; the downloadable wallpapers are full-size JPEGs. The
organization avatar and social cards come from the same master, so the site
and the GitHub organization share one image.

Requirements: Python 3.10+, Pillow with AVIF support, numpy.

    python scripts/build-art.py --flower flower.jpg

The output is written to assets/img/times, assets/img/wallpapers and
assets/img/brand. Every value in the GRADES table is also shown in the
"显影配方" table on the landing page, so change them together.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
THEMES = ("dawn", "noon", "dusk", "night")
MASTER_SIZE = (2520, 1080)       # 21:9, close to the 2416x1024 source
WALL_16_SIZE = (1920, 1080)
PAGE_SIZE = (1600, 900)
PAGE_SMALL_SIZE = (800, 450)     # srcset candidate for phones and tablets
WIDE_PREVIEW_SIZE = (1680, 720)
WIDE_SMALL_SIZE = (840, 360)

# --------------------------------------------------------------------------
# Grade parameters. Exposure and white balance are applied in linear light;
# the rest works on display-referred values. Keep the numbers in sync with
# index.html (the recipe table) when you edit them.
# --------------------------------------------------------------------------

GRADES = {
    "dawn": {
        "exposure": 0.90,
        "gain": (0.92, 0.99, 1.10),
        "lift": 0.060,
        "gamma": 1.10,
        "contrast": 0.86,
        "saturation": 0.62,
        "shadow_tint": (0.55, 0.64, 0.82),
        "shadow_strength": 0.16,
        "highlight_tint": (1.00, 0.91, 0.94),
        "highlight_strength": 0.10,
        "glow": {"x": 0.30, "y": 0.15, "radius": 0.58, "color": (1.00, 0.86, 0.92), "strength": 0.18},
        "mist": {"y": 0.55, "sigma": 0.20, "color": (0.88, 0.92, 0.99), "strength": 0.25},
        "duotone": {"shadow": (0.22, 0.27, 0.38), "highlight": (0.98, 0.90, 0.90), "strength": 0.10},
        "sky_dim": 0.0,
        "moon": None,
        "vignette": 0.08,
        "bloom": 0.14,
        "clarity": 0.03,
        "grain": 0.012,
    },
    "noon": {
        "exposure": 1.06,
        "gain": (1.02, 1.01, 0.99),
        "lift": 0.005,
        "gamma": 0.98,
        "contrast": 1.08,
        "saturation": 1.10,
        "shadow_tint": (0.38, 0.52, 0.44),
        "shadow_strength": 0.05,
        "highlight_tint": (1.00, 0.98, 0.90),
        "highlight_strength": 0.05,
        "glow": {"x": 0.30, "y": 0.15, "radius": 0.50, "color": (1.00, 0.96, 0.84), "strength": 0.10},
        "mist": None,
        "duotone": None,
        "sky_dim": 0.0,
        "moon": None,
        "vignette": 0.06,
        "bloom": 0.08,
        "clarity": 0.16,
        "grain": 0.005,
    },
    "dusk": {
        "exposure": 0.66,
        "gain": (1.20, 0.97, 0.70),
        "lift": 0.015,
        "gamma": 0.98,
        "contrast": 1.08,
        "saturation": 1.00,
        "shadow_tint": (0.25, 0.33, 0.52),
        "shadow_strength": 0.26,
        "highlight_tint": (1.00, 0.66, 0.36),
        "highlight_strength": 0.42,
        "glow": {"x": 0.30, "y": 0.15, "radius": 0.55, "color": (1.00, 0.52, 0.22), "strength": 0.50},
        "mist": {"y": 0.42, "sigma": 0.16, "color": (1.00, 0.72, 0.45), "strength": 0.22},
        "duotone": {"shadow": (0.12, 0.10, 0.18), "highlight": (1.00, 0.72, 0.44), "strength": 0.18},
        "sky_dim": 0.0,
        "moon": None,
        "vignette": 0.26,
        "bloom": 0.22,
        "clarity": 0.05,
        "grain": 0.008,
    },
    "night": {
        "exposure": 0.30,
        "gain": (0.78, 0.94, 1.22),
        "lift": 0.000,
        "gamma": 1.00,
        "contrast": 1.10,
        "saturation": 0.50,
        "shadow_tint": (0.10, 0.18, 0.38),
        "shadow_strength": 0.30,
        "highlight_tint": (0.60, 0.74, 1.00),
        "highlight_strength": 0.35,
        "glow": {"x": 0.30, "y": 0.15, "radius": 0.38, "color": (0.72, 0.86, 1.00), "strength": 0.18},
        "mist": {"y": 0.55, "sigma": 0.18, "color": (0.35, 0.48, 0.68), "strength": 0.10},
        "duotone": {"shadow": (0.03, 0.06, 0.13), "highlight": (0.55, 0.68, 0.88), "strength": 0.60},
        "sky_dim": 0.22,
        "moon": {"x": 0.30, "y": 0.15, "radius": 0.030, "halo": 0.14, "strength": 1.0},
        "vignette": 0.40,
        "bloom": 0.30,
        "clarity": 0.02,
        "grain": 0.016,
    },
}


def srgb_to_linear(value: np.ndarray) -> np.ndarray:
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return np.where(value <= 0.0031308, value * 12.92, 1.055 * value ** (1 / 2.4) - 0.055)


def luma(value: np.ndarray) -> np.ndarray:
    return value[..., 0] * 0.2126 + value[..., 1] * 0.7152 + value[..., 2] * 0.0722


def blur(value: np.ndarray, radius: float) -> np.ndarray:
    radius = max(0.1, radius)
    image = Image.fromarray((np.clip(value, 0, 1) * 255).astype(np.uint8))
    image = image.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(image, dtype=np.float32) / 255.0


def cover(image: Image.Image, width: int, height: int, focus_x: float = 0.5, focus_y: float = 0.5) -> Image.Image:
    """Resize to cover and crop around a normalized focus point."""
    source_w, source_h = image.size
    scale = max(width / source_w, height / source_h)
    new_size = (math.ceil(source_w * scale), math.ceil(source_h * scale))
    resized = image.resize(new_size, Image.LANCZOS)
    left = int(round((new_size[0] - width) * focus_x))
    top = int(round((new_size[1] - height) * focus_y))
    return resized.crop((left, top, left + width, top + height))


def radial_field(width: int, height: int, spec: dict) -> np.ndarray:
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    xs = xs / max(width - 1, 1)
    ys = ys / max(height - 1, 1)
    aspect = width / height
    dx = (xs - spec["x"]) * (aspect / 1.7778)
    dy = ys - spec["y"]
    distance = np.sqrt(dx * dx + dy * dy) / max(spec["radius"], 0.001)
    return np.clip(np.exp(-distance * distance * 2.4) * spec["strength"], 0.0, 1.0)


def duotone(value: np.ndarray, spec: dict) -> np.ndarray:
    light = luma(value)[..., None]
    shadow = np.array(spec["shadow"], dtype=np.float32)
    highlight = np.array(spec["highlight"], dtype=np.float32)
    tone = shadow * (1.0 - light) + highlight * light
    return value * (1.0 - spec["strength"]) + tone * spec["strength"]


def dim_sky(value: np.ndarray, strength: float, horizon: float = 0.45) -> np.ndarray:
    height = value.shape[0]
    ys = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
    mask = np.clip((horizon - ys) / horizon, 0.0, 1.0) ** 1.3
    return value * (1.0 - mask * strength)[..., None]


def add_moon(value: np.ndarray, spec: dict) -> np.ndarray:
    height, width = value.shape[:2]
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    dx = (xs / width - spec["x"]) * (width / height)
    dy = ys / height - spec["y"]
    distance = np.sqrt(dx * dx + dy * dy)
    core = np.exp(-((distance / spec["radius"]) ** 6)) * spec["strength"]
    halo = np.exp(-((distance / spec["halo"]) ** 2)) * 0.45 * spec["strength"]
    colour = np.array(spec.get("color", (0.90, 0.95, 1.00)), dtype=np.float32)
    light = np.clip(core + halo, 0.0, 1.0)[..., None] * colour
    return 1.0 - (1.0 - value) * (1.0 - light)


def grade(image: Image.Image, theme: str) -> Image.Image:
    params = GRADES[theme]
    array = np.asarray(image, dtype=np.float32) / 255.0
    height, width = array.shape[:2]

    # Exposure and white balance in linear light.
    linear = srgb_to_linear(array) * params["exposure"]
    linear *= np.array(params["gain"], dtype=np.float32)
    array = linear_to_srgb(linear)

    # Lift, gamma, contrast: a calm film-like curve.
    array = array * (1.0 - params["lift"]) + params["lift"]
    array = np.clip(array, 0.0, 1.0) ** (1.0 / params["gamma"])
    array = (array - 0.5) * params["contrast"] + 0.5
    array = np.clip(array, 0.0, 1.0)

    # Saturation around luminance.
    grey = luma(array)[..., None]
    array = grey + (array - grey) * params["saturation"]
    array = np.clip(array, 0.0, 1.0)

    # Tint shadows and highlights separately, the way a split-tone would.
    light = luma(array)
    shadow_weight = np.clip(1.0 - light * 2.2, 0.0, 1.0) ** 1.5
    highlight_weight = np.clip((light - 0.42) / 0.58, 0.0, 1.0) ** 1.4
    shadow_tint = np.array(params["shadow_tint"], dtype=np.float32)
    highlight_tint = np.array(params["highlight_tint"], dtype=np.float32)
    shadow_alpha = (shadow_weight * params["shadow_strength"])[..., None]
    highlight_alpha = (highlight_weight * params["highlight_strength"])[..., None]
    array = array * (1.0 - shadow_alpha) + shadow_tint * shadow_alpha
    array = array * (1.0 - highlight_alpha) + highlight_tint * highlight_alpha

    # Mist band.
    if params["mist"]:
        mist = params["mist"]
        ys = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
        mask = np.exp(-0.5 * ((ys - mist["y"]) / mist["sigma"]) ** 2) * mist["strength"]
        colour = np.array(mist["color"], dtype=np.float32)
        array = array * (1.0 - mask[..., None]) + colour * mask[..., None]

    # Sun / moon glow, added with a screen blend.
    glow = radial_field(width, height, params["glow"])[..., None]
    glow_colour = np.array(params["glow"]["color"], dtype=np.float32)
    array = 1.0 - (1.0 - array) * (1.0 - glow * glow_colour)

    # Bloom around the brightest areas.
    if params["bloom"] > 0:
        light = luma(array)
        highlights = np.clip((light - 0.62) / 0.38, 0.0, 1.0)[..., None]
        bloom = blur(array * highlights, max(width, height) * 0.012) * params["bloom"]
        array = 1.0 - (1.0 - array) * (1.0 - bloom)

    # Night keeps a duotone base, a darker sky and one moon; dusk gets a
    # gentler warm duotone. Keep these after the bloom so the light does not
    # wash the colour back out.
    if params.get("duotone"):
        array = duotone(array, params["duotone"])
    if params.get("sky_dim"):
        array = dim_sky(array, params["sky_dim"])
    if params.get("moon"):
        array = add_moon(array, params["moon"])

    # Local clarity: a little more definition in the leaves and water.
    if params["clarity"] > 0:
        detail = array - blur(array, max(width, height) * 0.004)
        array = array + detail * params["clarity"]

    # Vignette.
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    nx = (xs / max(width - 1, 1) - 0.5) * 2.0
    ny = (ys / max(height - 1, 1) - 0.5) * 2.0
    radius = np.sqrt(nx * nx + ny * ny) / math.sqrt(2.0)
    vignette = np.clip((radius - 0.28) / 0.72, 0.0, 1.0) ** 1.8 * params["vignette"]
    array *= (1.0 - vignette)[..., None]

    # A little grain, deterministic per theme.
    if params["grain"] > 0:
        rng = np.random.default_rng(20261022 + THEMES.index(theme))
        grain = rng.normal(0.0, params["grain"], size=(height, width, 1)).astype(np.float32)
        array = array + grain

    array = np.clip(array, 0.0, 1.0)
    return Image.fromarray((array * 255.0 + 0.5).astype(np.uint8))


def save_picture(image: Image.Image, base: Path, *, avif_quality: int = 58, webp_quality: int = 82, jpg_quality: int = 84) -> None:
    """Write the three formats used by the <picture> elements."""
    base.parent.mkdir(parents=True, exist_ok=True)
    image.save(base.with_suffix(".avif"), "AVIF", quality=avif_quality)
    image.save(base.with_suffix(".webp"), "WEBP", quality=webp_quality, method=6)
    image.save(base.with_suffix(".jpg"), "JPEG", quality=jpg_quality, optimize=True, progressive=True)


def save_wallpaper(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "JPEG", quality=90, optimize=True, progressive=True)


def contact_sheet(rows: list[tuple[str, list[Image.Image]]], path: Path) -> None:
    cell_w, cell_h, gap, label_h = 480, 270, 16, 34
    width = max(len(images) for _, images in rows) * cell_w + (max(len(images) for _, images in rows) + 1) * gap
    height = len(rows) * (cell_h + label_h) + (len(rows) + 1) * gap
    sheet = Image.new("RGB", (width, height), "#1b2223")
    draw = ImageDraw.Draw(sheet)
    for row_index, (label, images) in enumerate(rows):
        y = gap + row_index * (cell_h + label_h + gap)
        draw.text((gap, y + 8), label, fill="#d7ddd9")
        for column, image in enumerate(images):
            x = gap + column * (cell_w + gap)
            sheet.paste(image.resize((cell_w, cell_h), Image.LANCZOS), (x, y + label_h))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "PNG")


def build_avatar(flower: Image.Image, brand: Path) -> None:
    # A square crop around the mountain and the river bend. The subject stays
    # inside the central 80% because GitHub masks avatars into a circle.
    square = cover(flower, 1024, 1024, 0.50, 0.42)
    square.resize((460, 460), Image.LANCZOS).save(brand / "org-avatar.png", "PNG", optimize=True)
    square.resize((180, 180), Image.LANCZOS).save(brand / "org-avatar-180.png", "PNG", optimize=True)
    square.resize((180, 180), Image.LANCZOS).save(brand / "icon-180.png", "PNG", optimize=True)


def build_social(dusk: Image.Image, brand: Path) -> None:
    cover(dusk, 1200, 630).save(brand / "og-cover.jpg", "JPEG", quality=86, optimize=True, progressive=True)
    cover(dusk, 1280, 640).save(brand / "repo-social.jpg", "JPEG", quality=87, optimize=True, progressive=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flower", type=Path, default=Path("flower.jpg"), help="painterly source image")
    parser.add_argument("--out", type=Path, default=ROOT / "assets/img/times", help="theme image output directory")
    parser.add_argument("--wallpapers", type=Path, default=ROOT / "assets/img/wallpapers", help="wallpaper output directory")
    parser.add_argument("--brand", type=Path, default=ROOT / "assets/img/brand", help="brand asset output directory")
    parser.add_argument("--preview", type=Path, default=None, help="write a contact sheet to this path")
    args = parser.parse_args()

    flower = Image.open(args.flower).convert("RGB")
    master = cover(flower, *MASTER_SIZE, 0.50, 0.50)

    page_images = []
    wide_images = []
    graded = {}
    args.out.mkdir(parents=True, exist_ok=True)
    args.wallpapers.mkdir(parents=True, exist_ok=True)
    args.brand.mkdir(parents=True, exist_ok=True)

    for theme in THEMES:
        art = grade(master, theme)
        graded[theme] = art

        # 16:9 is a centre crop of the 21:9 master, so both ratios share one
        # grade and one set of highlights.
        art_16 = art.crop((
            (MASTER_SIZE[0] - WALL_16_SIZE[0]) // 2,
            0,
            (MASTER_SIZE[0] + WALL_16_SIZE[0]) // 2,
            WALL_16_SIZE[1],
        ))
        page = art_16.resize(PAGE_SIZE, Image.LANCZOS)
        page_small = page.resize(PAGE_SMALL_SIZE, Image.LANCZOS)
        wide = art.resize(WIDE_PREVIEW_SIZE, Image.LANCZOS)
        wide_small = wide.resize(WIDE_SMALL_SIZE, Image.LANCZOS)

        save_picture(page, args.out / f"flower-{theme}-1600")
        save_picture(page_small, args.out / f"flower-{theme}-800")
        save_picture(wide, args.out / f"wide-{theme}-1680")
        save_picture(wide_small, args.out / f"wide-{theme}-840")
        save_wallpaper(art_16, args.wallpapers / f"hill-light-{theme}-16x9.jpg")
        save_wallpaper(art, args.wallpapers / f"hill-light-{theme}-21x9.jpg")

        page_images.append(page)
        wide_images.append(wide)
        print(f"built {theme:5s}  page {PAGE_SIZE[0]}x{PAGE_SIZE[1]} + {PAGE_SMALL_SIZE[0]}x{PAGE_SMALL_SIZE[1]} · wide {WIDE_PREVIEW_SIZE[0]}x{WIDE_PREVIEW_SIZE[1]} + {WIDE_SMALL_SIZE[0]}x{WIDE_SMALL_SIZE[1]} · wallpapers {WALL_16_SIZE[0]}x{WALL_16_SIZE[1]} / {MASTER_SIZE[0]}x{MASTER_SIZE[1]}")

    build_avatar(flower, args.brand)
    build_social(graded["dusk"], args.brand)
    print(f"brand assets  {args.brand}")

    if args.preview:
        contact_sheet(
            [("16:9 / page", page_images), ("21:9 / wide", wide_images)],
            args.preview,
        )
        print(f"contact sheet {args.preview}")


if __name__ == "__main__":
    main()

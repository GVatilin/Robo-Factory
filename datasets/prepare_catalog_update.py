"""Download reviewed image candidates and assemble a repeatable catalog update.

python datasets/prepare_catalog_update.py
Review contact sheets and set approved=true only for verified model images in
datasets/catalog_update_package/bundle.json before uploading the package.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse
from datetime import date
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageDraw, ImageFont, ImageOps
import requests

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "catalog_update_package"
FORCE_REFRESH = False


def fetch_candidate(item):
    item = dict(item)
    image = item.get("image")
    if not image or not image.get("url"):
        return item
    image = dict(image)
    item["image"] = image
    try:
        if urlsplit(image["url"]).scheme not in {"http", "https"}:
            raise ValueError("Expected a public HTTP(S) image URL")
        cache = OUT / "download-cache" / (sha256(image["url"].encode()).hexdigest() + ".bin")
        if cache.is_file() and not FORCE_REFRESH:
            content = cache.read_bytes()
        else:
            response = requests.get(image["url"], timeout=(12, 40), stream=True,
                headers={"User-Agent": "Mozilla/5.0 (compatible; RoboFactoryCatalog/1.0)", "Referer": image["page_url"]})
            response.raise_for_status()
            content = b""
            for chunk in response.iter_content(65536):
                content += chunk
                if len(content) > 10 * 1024 * 1024:
                    raise ValueError("Image exceeds 10 MB")
            cache.write_bytes(content)
        source_hash = sha256(content).hexdigest()
        original = Image.open(BytesIO(content))
        if original.width * original.height > 40_000_000:
            raise ValueError("Image exceeds 40 megapixels")
        original.load()
        if min(original.size) < 100 or max(original.size) < 300:
            raise ValueError("Image is too small for a product card")
        prepared = ImageOps.exif_transpose(original).convert("RGBA" if "A" in original.getbands() or "transparency" in original.info else "RGB")
        if prepared.mode == "RGBA":
            if prepared.getchannel("A").point(lambda alpha: 255 if alpha > 20 else 0).getbbox() is None:
                raise ValueError("Image is a transparent placeholder")
            visible = Image.new("RGBA", prepared.size, "white")
            visible.alpha_composite(prepared)
            visible = visible.convert("RGB")
        else:
            visible = prepared
        if all(high - low < 4 for low, high in visible.getextrema()):
            raise ValueError("Image is a blank placeholder")
        source_size = list(prepared.size)
        prepared.thumbnail((1600, 1600))
        buffer = BytesIO()
        prepared.save(buffer, format="WEBP", quality=90)
        data = buffer.getvalue()
        digest = sha256(data).hexdigest()
        relative = "assets/" + digest + ".webp"
        (OUT / relative).write_bytes(data)
        image.update(file=relative, sha256=digest, original_sha256=source_hash,
            width=prepared.width, height=prepared.height, original_dimensions=source_size,
            retrieved_at=date.fromtimestamp(cache.stat().st_mtime).isoformat(), approved=False)
        image.pop("download_error", None)
    except Exception as exc:
        image["download_error"] = str(exc)[:300]
        image["approved"] = False
    return item


def contact_sheets(products):
    candidates = [(i, p) for i, p in enumerate(products) if (p.get("image") or {}).get("file")]
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    for page in range(0, len(candidates), 30):
        sheet = Image.new("RGB", (1500, 1500), "#edf2f7")
        draw = ImageDraw.Draw(sheet)
        for position, (index, item) in enumerate(candidates[page:page + 30]):
            x, y = position % 5 * 300, position // 5 * 250
            photo = Image.open(OUT / item["image"]["file"]).convert("RGBA")
            photo.thumbnail((280, 190))
            sheet.paste(photo, (x + (300-photo.width)//2, y + (195-photo.height)//2), photo)
            label = f"{index}: {item['product_name']}"
            draw.text((x+8, y+197), label[:34], fill="#172a42", font=font)
            draw.text((x+8, y+217), label[34:68], fill="#172a42", font=font)
        sheet.save(OUT / f"contact-{page//30+1}.jpg", quality=93)


def main():
    global FORCE_REFRESH
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-images", action="store_true", help="Download images again, ignoring the local cache")
    FORCE_REFRESH = parser.parse_args().refresh_images
    (OUT / "assets").mkdir(parents=True, exist_ok=True)
    (OUT / "download-cache").mkdir(exist_ok=True)
    entries = []
    for path in sorted(ROOT.glob("research_round2_*.json")):
        entries.extend(json.loads(path.read_text(encoding="utf-8"))["products"])
    if not entries:
        raise SystemExit("No reviewed manifests found")
    with ThreadPoolExecutor(max_workers=8) as executor:
        products = list(executor.map(fetch_candidate, entries))
    review_file = ROOT / "catalog_image_review.json"
    if review_file.is_file():
        reviews = {(r["product_name"], r["manufacturer"], r["url"]): r
                   for r in json.loads(review_file.read_text(encoding="utf-8"))["images"]}
        for product in products:
            image = product.get("image") or {}
            review = reviews.get((product["product_name"], product["manufacturer"], image.get("url")))
            if review and review.get("sha256") == image.get("sha256"):
                image["approved"] = bool(review["approved"])
                image["review_note"] = review.get("note", "")
    bundle = {"version": 2, "prepared_at": date.today().isoformat(), "products": products}
    (OUT / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    contact_sheets(products)
    print(json.dumps({"entries":len(products), "models":len({(p['product_name'],p['manufacturer']) for p in products}),
        "specs":sum(len(p.get('specs',[])) for p in products),
        "images_downloaded":sum(bool((p.get('image') or {}).get('file')) for p in products),
        "images_approved":sum(bool((p.get('image') or {}).get('approved')) for p in products),
        "image_errors":[{"product":p['product_name'],"error":p['image']['download_error']} for p in products if (p.get('image') or {}).get('download_error')]}, ensure_ascii=False))


if __name__ == "__main__":
    main()

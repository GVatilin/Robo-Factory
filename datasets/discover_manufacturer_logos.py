"""Collect logo candidates from reviewed company websites; selection is manual.

Operator dependencies: requests, beautifulsoup4, Pillow, resvg-py.
Input/output live in ignored research_cache, never downloaded by a public API.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
import base64
import json
from pathlib import Path
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from PIL import Image, ImageChops, ImageOps
import requests
import resvg_py

ROOT = Path(__file__).parent / "research_cache"
OUT = ROOT / "logos"
OUT.mkdir(exist_ok=True)
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CatalogEvidence/1.0)"}


def download(url):
    cache = OUT / (sha256(url.encode()).hexdigest() + ".bin")
    if cache.exists():
        return cache.read_bytes()
    if url.startswith("data:"):
        head, body = url.split(",", 1)
        if ";base64" not in head:
            from urllib.parse import unquote
            return unquote(body).encode()
        return base64.b64decode(body)
    with requests.get(url, headers=HEADERS, timeout=(6, 12), stream=True) as r:
        r.raise_for_status()
        data = bytearray()
        for chunk in r.iter_content(65536):
            data.extend(chunk)
            if len(data) > 5_000_000:
                raise ValueError("File too large")
    cache.write_bytes(data)
    return bytes(data)


def render(data):
    if b"<svg" in data[:1500]:
        svg = data.decode("utf-8-sig")
        if re.search(r"<!ENTITY|<!DOCTYPE|<script|<foreignObject", svg, re.I):
            raise ValueError("Unsupported SVG content")
        # resvg never runs JS; reject local/external image dependencies as well.
        if re.search(r'(?:href|src)\s*=\s*["\'](?!#|data:)[^"\']+', svg, re.I):
            raise ValueError("SVG requires external resources")
        data = resvg_py.svg_to_bytes(svg_string=svg, width=700, skip_system_fonts=True)
    img = Image.open(BytesIO(data))
    if img.width * img.height > 25_000_000 or max(img.size) < 24:
        raise ValueError("Unusable dimensions")
    if img.format == "ICO":
        img = img.ico.getimage(max(img.ico.sizes()))
    img = ImageOps.exif_transpose(img).convert("RGBA")
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        raise ValueError("Empty transparent image")
    img = img.crop(bbox)
    # Trim opaque white margins as well as transparent padding.
    if all(min(img.getpixel(p)[:3]) > 245 for p in [(0, 0), (img.width-1, 0), (0, img.height-1), (img.width-1, img.height-1)]):
        diff = ImageChops.difference(img.convert("RGB"), Image.new("RGB", img.size, "white"))
        content = diff.point(lambda v: 255 if v > 25 else 0).getbbox()
        if content: img = img.crop(content)
    img = ImageOps.contain(img, (640, 400), Image.Resampling.LANCZOS)
    # White wordmarks need a dark backing; retain original brand colors.
    pixels = [p for p in img.resize((80, 50)).getdata() if p[3] > 100]
    white_ratio = sum(min(p[:3]) > 210 for p in pixels) / max(len(pixels), 1)
    dark_ratio = sum(max(p[:3]) < 100 for p in pixels) / max(len(pixels), 1)
    transparent = img.getchannel("A").getextrema()[0] < 128
    light = white_ratio > .85 or (transparent and white_ratio > .2 and dark_ratio < .15)
    background = "#172a42" if light else "#ffffff"
    canvas = Image.new("RGB", (700, 460), background)
    canvas.paste(img, ((700-img.width)//2, (460-img.height)//2), img)
    stream = BytesIO(); canvas.save(stream, "WEBP", quality=94)
    return stream.getvalue(), background


def discover(item):
    item = dict(item); item["candidates"] = []
    if not item.get("page_url"):
        return item
    try:
        html = download(item["page_url"])
        (OUT / f"page-{item['id']}.html").write_bytes(html)
        soup = BeautifulSoup(html, "html.parser")
        item["title"] = soup.title.get_text(strip=True) if soup.title else ""
        candidates = []
        for n, tag in enumerate(soup.find_all(["img", "svg", "link"])):
            attrs = str(tag.attrs).lower()
            parents = " ".join(str(p.attrs) for p in list(tag.parents)[:3] if hasattr(p, "attrs")).lower()
            logo = bool(re.search(r"logo|логотип|brand", attrs + parents))
            if tag.name == "link":
                if "icon" not in str(tag.get("rel", "")): continue
                url = tag.get("href"); score = 15 if "apple" in attrs else 5
            elif tag.name == "svg":
                if not logo: continue
                use = tag.find("use")
                if use:
                    href = use.get("href") or use.get("xlink:href") or ""
                    file, _, fragment = href.partition("#")
                    symbols = BeautifulSoup(download(urljoin(item["page_url"], file)), "xml") if file else soup
                    symbol = symbols.find(id=fragment)
                    if symbol:
                        viewbox = symbol.get("viewBox") or symbol.get("viewbox") or tag.get("viewBox") or tag.get("viewbox") or "0 0 300 100"
                        text = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}">'+symbol.decode_contents()+"</svg>"
                    else: continue
                else:
                    text = str(tag)
                if "xmlns=" not in text: text = text.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
                for lower, proper in (("viewbox", "viewBox"), ("clippath", "clipPath"), ("lineargradient", "linearGradient"),
                                      ("radialgradient", "radialGradient"), ("gradientunits", "gradientUnits"),
                                      ("gradienttransform", "gradientTransform"), ("preserveaspectratio", "preserveAspectRatio")):
                    text = text.replace(lower, proper)
                url = "data:image/svg+xml;base64," + base64.b64encode(text.encode()).decode()
                score = 90
            else:
                if not logo and n > 10: continue
                url = tag.get("data-original") or tag.get("data-src") or tag.get("src")
                score = 100 if logo else 1
                if re.search(r"footer|white|light", attrs + parents): score -= 8
                if "header" in parents: score += 12
            if not url: continue
            candidates.append((score, urljoin(item["page_url"], url), str(tag.get("alt", ""))))
        seen = set()
        for score, url, alt in sorted(candidates, key=lambda c: -c[0]):
            if url in seen: continue
            seen.add(url)
            try:
                raw = download(url)
                data, background = render(raw)
                digest = sha256(data).hexdigest(); path = OUT / f"{item['id']}-{len(item['candidates'])}-{digest[:12]}.webp"
                path.write_bytes(data)
                item["candidates"].append(dict(url=url if not url.startswith('data:') else item['page_url']+'#inline-logo',
                    file=path.name, sha256=digest, original_sha256=sha256(raw).hexdigest(), score=score, alt=alt, background=background))
            except Exception:
                continue
            if len(item["candidates"]) >= 5: break
    except Exception as exc:
        item["error"] = str(exc)[:200]
    return item


if __name__ == "__main__":
    seeds = json.loads((ROOT / "logo-seeds.json").read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(discover, seeds))
    (OUT / "candidates.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"companies": len(results), "with_candidates": sum(bool(x['candidates']) for x in results),
                      "missing": [{"id": x['id'], "name": x['name'], "error": x.get('error')} for x in results if not x['candidates']]}, ensure_ascii=False))

"""Find and download openly licensed category illustrations from Wikimedia Commons.

Discovery never silently assigns an image: choose a file title in the manifest first.
Downloads are local snapshots with attribution, license and SHA-256. No hotlinking.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import hashlib
import html
import json
from pathlib import Path
import re
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
AGENT = 'RoboFactoryCatalog/1.0 (educational robotics catalogue; Commons attribution retained)'


def request(url):
    if urlparse(url).scheme != 'https' or not urlparse(url).hostname.endswith('.wikimedia.org'):
        raise ValueError('Only HTTPS Wikimedia assets are accepted')
    with urlopen(Request(url, headers={'User-Agent': AGENT}), timeout=45) as response:
        data = response.read(10_000_001)
    if len(data) > 10_000_000:
        raise ValueError('Image exceeds 10 MB')
    return data


def plain(value):
    return html.unescape(re.sub('<[^>]*>', '', value or '')).strip()


def lookup(asset, discovery):
    params = dict(action='query', prop='imageinfo', iiprop='url|extmetadata|size', iiurlwidth=960, format='json')
    if discovery:
        params.update(generator='search', gsrsearch=asset['query']+' filetype:bitmap', gsrnamespace=6, gsrlimit=5)
    else:
        params['titles'] = asset['commons_title']
    pages = json.loads(request('https://commons.wikimedia.org/w/api.php?'+urlencode(params))).get('query', {}).get('pages', {})
    results = []
    for page in pages.values():
        for info in page.get('imageinfo', []):
            meta = info.get('extmetadata', {})
            value = lambda key: plain(meta.get(key, {}).get('value'))
            license_name = value('LicenseShortName')
            if not any(term in license_name.lower() for term in ('cc by', 'cc0', 'public domain')):
                continue
            results.append(dict(commons_title=page['title'], page_url=info['descriptionurl'],
                                download_url=info.get('thumburl', info['url']), author=value('Artist'),
                                license=license_name, license_url=value('LicenseUrl'),
                                description=value('ImageDescription'), width=info['width'], height=info['height']))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discover', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((HERE/'catalog_illustrations.json').read_text(encoding='utf-8'))
    cache = HERE/'illustrations'
    cache.mkdir(exist_ok=True)
    def process(asset):
        key=asset['key']
        target=cache/f'{key}.json'
        if args.discover:
            results=lookup(asset, True)
            (cache/f'{key}.candidates.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
            return key, [r['commons_title'] for r in results]
        if not asset.get('commons_title'):
            raise ValueError(f'{key}: choose a Commons file first')
        if target.exists():
            old=json.loads(target.read_text(encoding='utf-8'))
            file=cache/old['file']
            if old['commons_title']==asset['commons_title'] and file.exists() and hashlib.sha256(file.read_bytes()).hexdigest()==old['sha256']:
                return key, 'cached'
        found=lookup(asset, False)
        if len(found)!=1:
            raise ValueError(f'{key}: image or open license not found')
        metadata=found[0]
        data=request(metadata['download_url'])
        filename=key+'.image'
        (cache/filename).write_bytes(data)
        metadata.update(file=filename, sha256=hashlib.sha256(data).hexdigest(), retrieved_at=date.today().isoformat())
        target.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
        return key, 'downloaded'
    with ThreadPoolExecutor(max_workers=3) as pool:
        for key, result in pool.map(process, manifest['assets']):
            print(key, json.dumps(result, ensure_ascii=False), flush=True)


if __name__=='__main__':
    main()

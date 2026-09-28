"""Import reviewed model images and official specifications with field-level provenance.

docker compose exec -T backend python /datasets/load_catalog_evidence.py --apply
Sources are curated in the manifests; this importer never infers specifications from names.
"""
import argparse
import asyncio
from datetime import date
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import shutil
from urllib.parse import urlsplit
import uuid

from load_datasets import add_backend_to_path

HERE = Path(__file__).resolve().parent


def checked_file(name, checksum):
    root = (HERE / 'evidence').resolve()
    path = (root / name).resolve()
    if not path.is_relative_to(root):
        raise ValueError('Invalid asset path')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != checksum:
        raise ValueError(f'Checksum mismatch: {name}')
    return data


async def main(apply):
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.core.config import settings
    from app.db.session import SessionLocal, engine
    from app.models import DataSource, Product, ProductImage, ProductSpecValue, SpecDefinition
    from app.models.enums import SourceType
    from app.services.product_images import decode_upload, remove_files, write_files

    evidence = json.loads((HERE / 'catalog_evidence.json').read_text(encoding='utf-8'))
    official = json.loads((HERE / 'official_enrichment.json').read_text(encoding='utf-8'))
    extra = HERE / 'catalog_enrichment_extended.json'
    if extra.is_file():
        official['products'].extend(json.loads(extra.read_text(encoding='utf-8'))['products'])
    research_file = HERE / 'catalog_research_index.json'
    research = json.loads(research_file.read_text(encoding='utf-8')) if research_file.is_file() else {'products': []}
    today = date.today()
    checked_file(evidence['document'], evidence['document_sha256'])
    written, replaced = [], []
    report = dict(applied=apply, images_replaced=0, specifications_written=0, conflicts=[], protected=[], official_models=0, research_models=0)
    try:
        async with SessionLocal() as session:
            products = list((await session.scalars(select(Product).options(
                selectinload(Product.manufacturer), selectinload(Product.sources),
                selectinload(Product.image), selectinload(Product.spec_values).selectinload(ProductSpecValue.source),
            ).with_for_update())).all())
            lookup = {(p.name, p.manufacturer.name if p.manufacturer else ''): p for p in products}
            definitions = {d.code: d for d in (await session.scalars(select(SpecDefinition))).all()}
            sources = {s.code: s for s in (await session.scalars(select(DataSource))).all()}
            prepared = {}
            # Validate exact identity, hashes and images before any mutation.
            for item in evidence['products']:
                product = lookup[(item['product_name'], item['manufacturer'])]
                if not product.image or (product.image.is_illustration and not product.image.uploaded_by_id):
                    # A deliberately uncertain match stays labelled as an illustration. Do not replace it again.
                    existing_source = next((s for s in sources.values() if product.image and s.id == product.image.source_id), None)
                    if existing_source and (existing_source.code or '').startswith('catalog-page:'):
                        continue
                    prepared[product.id] = decode_upload(checked_file(item['file'], item['sha256']))
            for item in official['products']:
                lookup[(item['product_name'], item['manufacturer'])]
                if not item['url'].startswith('https://'):
                    raise ValueError('Official source must use HTTPS')
                date.fromisoformat(item['retrieved_at'])
                for value in item['specs']:
                    definitions[value['code']]
            report['images_replaced'] = len(prepared)
            if not apply:
                print(json.dumps(report, ensure_ascii=False))
                return

            documents = settings.upload_dir / 'catalog-documents'
            documents.mkdir(parents=True, exist_ok=True)
            for original, name in [
                (HERE / 'evidence' / evidence['document'], 'organizer-catalog.pdf'),
                (HERE / 'Примеры_решений_типы_объектов.docx', 'solution-examples.docx'),
                (HERE / 'catalog_export_v4_semicolon.csv', 'catalog-export.csv'),
            ]:
                target = documents / name
                temporary = target.with_suffix('.tmp')
                shutil.copyfile(original, temporary)
                temporary.replace(target)
            for code, source in sources.items():
                if code == 'organizer_solution_examples':
                    source.url = '/api/v1/catalog-documents/solution-examples.docx'
                elif code and code.startswith('catalog_import:'):
                    source.url = '/api/v1/catalog-documents/catalog-export.csv'

            async def source_for(code, title, url, publisher, received, kind):
                source = sources.get(code)
                if source is None:
                    source = DataSource(code=code, title=title, source_type=kind, url=url,
                                        publisher=publisher, retrieved_at=received)
                    session.add(source)
                    sources[code] = source
                    await session.flush()
                return source

            for item in evidence['products']:
                product = lookup[(item['product_name'], item['manufacturer'])]
                source = await source_for(f"catalog-page:{item['page']}",
                    f"{evidence['document_title']}, стр. {item['page']}", item['source_url'], 'ФЦ БАС', today, SourceType.ORGANIZER)
                source.notes = 'Изображения конкретных изделий из предоставленного каталога. SHA-256: ' + evidence['document_sha256']
                if source not in product.sources:
                    product.sources.append(source)
                if product.id in prepared:
                    image_id = uuid.uuid4()
                    written.append(image_id)
                    width, height, size = write_files(prepared[product.id], image_id)
                    img = product.image
                    if img is None:
                        img = ProductImage(product_id=product.id)
                        session.add(img)
                    else:
                        replaced.append(img.id)
                    img.id, img.width, img.height, img.size_bytes = image_id, width, height, size
                    img.original_name = f"organizer-catalog-page-{item['page']}-column-{item['column']}"
                    img.source_id, img.caption, img.is_illustration = source.id, item['caption'], item['is_illustration']

            for item in official['products']:
                product = lookup[(item['product_name'], item['manufacturer'])]
                received = date.fromisoformat(item['retrieved_at'])
                source_code = 'official-catalog:' + hashlib.sha256(item['url'].encode()).hexdigest()[:24]
                source = await source_for(source_code, item['title'], item['url'], item['manufacturer'], received,
                                          SourceType(item.get('source_type', 'manufacturer')))
                source.notes = 'Характеристики сверены с указанной публикацией; подтверждение источником не означает независимых испытаний. Условия и расхождения указаны у каждого значения.'
                if source not in product.sources:
                    product.sources.append(source)
                if product.manufacturer and not product.manufacturer.website and item.get('source_type', 'manufacturer') == 'manufacturer':
                    host = urlsplit(item['url']).netloc
                    if host not in {'storage.yandexcloud.net', 'drive.google.com'}:
                        product.manufacturer.website = 'https://' + ('www.geoscan.ru' if host == 'download.geoscan.ru' else host)
                values = {v.spec_definition_id: v for v in product.spec_values}
                payload = dict(product.source_payload or {})
                history = list(payload.get('enrichment_history', []))
                for spec in item['specs']:
                    definition = definitions[spec['code']]
                    value = values.get(definition.id)
                    if value and (not value.source or (value.source.source_type != SourceType.ORGANIZER and value.source.code != source_code)):
                        report['protected'].append({'product': product.name, 'spec': spec['code']})
                        continue
                    if value is None:
                        value = ProductSpecValue(product_id=product.id, spec_definition_id=definition.id)
                        session.add(value)
                    elif (value.source_id != source.id
                          or value.value_numeric != (Decimal(str(spec['value'])) if 'value' in spec else None)
                          or value.value_numeric_max != (Decimal(str(spec['value_max'])) if 'value_max' in spec else None)
                          or value.value_text != spec.get('text')
                          or value.is_confirmed != spec['confirmed']
                          or value.note != spec.get('note')):
                        history.append({'code':spec['code'], 'numeric':str(value.value_numeric) if value.value_numeric is not None else None,
                            'max':str(value.value_numeric_max) if value.value_numeric_max is not None else None,
                            'text':value.value_text, 'source_id':value.source_id, 'confirmed':value.is_confirmed, 'note':value.note,
                            'retrieved_at':value.retrieved_at.isoformat() if value.retrieved_at else None,
                            'replaced_at':received.isoformat(), 'replacement_source':source_code})
                    value.value_numeric = Decimal(str(spec['value'])) if 'value' in spec else None
                    value.value_numeric_max = Decimal(str(spec['value_max'])) if 'value_max' in spec else None
                    value.value_text, value.value_bool = spec.get('text'), None
                    value.unit = spec.get('unit', definition.unit)
                    value.source_id, value.retrieved_at = source.id, received
                    value.is_confirmed, value.is_assumption, value.note = spec['confirmed'], False, spec.get('note')
                    report['specifications_written'] += 1
                    if not spec['confirmed']:
                        report['conflicts'].append({'product':product.name, 'spec':spec['code'], 'note':spec.get('note'), 'source':item['url']})
                payload['enrichment_history'] = history
                if item.get('conflict_resolutions'):
                    resolutions = {r['code']: r for r in payload.get('catalog_conflict_resolutions', [])}
                    resolutions.update({r['code']: r for r in item['conflict_resolutions']})
                    payload['catalog_conflict_resolutions'] = list(resolutions.values())
                field_evidence = dict(payload.get('field_evidence', {}))
                for field, content in item.get('fields', {}).items():
                    if field not in {'limitations', 'service_life_years'}:
                        raise ValueError('Unsupported product field: ' + field)
                    if getattr(product, field) is None or field_evidence.get(field, {}).get('source_id') == source.id:
                        setattr(product, field, content)
                        field_evidence[field] = {'source_id': source.id, 'retrieved_at': received.isoformat(), 'is_confirmed': True}
                payload['field_evidence'] = field_evidence
                payload['official_enrichment'] = {'source':item['url'], 'retrieved_at':received.isoformat(), 'version':official['version']}
                product.source_payload = payload
                product.last_verified_at = received
            report['official_models'] = len({(i['product_name'], i['manufacturer']) for i in official['products']})
            for item in research['products']:
                product = lookup[(item['product_name'], item['manufacturer'])]
                payload = dict(product.source_payload or {})
                payload['catalog_research'] = {k: v for k, v in item.items() if k not in {'product_name', 'manufacturer'}}
                product.source_payload = payload
                report['research_models'] += 1
            # Make original organizer sources discoverable on every card, including legacy imports.
            for product in products:
                for value in product.spec_values:
                    if value.source and value.source not in product.sources:
                        product.sources.append(value.source)
                if product.external_id:
                    for code, source in sources.items():
                        if code and code.startswith('catalog_import:') and source not in product.sources:
                            product.sources.append(source)
            await session.commit()
            written.clear()
            remove_files(*replaced)
            (settings.upload_dir / 'catalog-enrichment-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False), flush=True)
    except BaseException:
        remove_files(*written)
        raise
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    add_backend_to_path()
    asyncio.run(main(args.apply))

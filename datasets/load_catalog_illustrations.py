"""Fill missing product images with locally downloaded, attributed illustrations.

docker compose exec -T backend python /datasets/load_catalog_illustrations.py --apply
Existing photographs and manual uploads are never replaced. Re-running adds only missing images.
"""
import argparse
import asyncio
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
import uuid

from load_datasets import add_backend_to_path

HERE = Path(__file__).resolve().parent


async def main(apply):
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.db.session import SessionLocal, engine
    from app.models import DataSource, Product, ProductImage
    from app.models.enums import SourceType
    from app.services.product_images import decode_upload, remove_files, write_files

    manifest=json.loads((HERE/'catalog_illustrations.json').read_text(encoding='utf-8'))
    assets={asset['key']:asset for asset in manifest['assets']}
    by_type={code:asset['key'] for asset in assets.values() for code in asset['types']}
    rules=[(re.compile(rule['pattern'], re.I), rule['asset']) for rule in manifest.get('name_rules', [])]
    cache=HERE/'illustrations'
    prepared={}
    written=[]
    try:
        async with SessionLocal() as session:
            products=list((await session.scalars(select(Product).options(selectinload(Product.solution_type), selectinload(Product.image)).order_by(Product.id).with_for_update())).all())
            pending=[]
            missing=[]
            for product in products:
                if product.image:
                    continue
                key=next((key for pattern,key in rules if pattern.search(product.name)), None)
                key=key or by_type.get(product.solution_type.code if product.solution_type else '')
                if not key:
                    missing.append({'id':product.id,'name':product.name})
                else:
                    pending.append((product,key))
            if missing:
                raise ValueError('No explicit image mapping for: '+json.dumps(missing,ensure_ascii=False))
            # Validate every needed source before touching files or database rows.
            for key in sorted({key for _,key in pending}):
                metadata=json.loads((cache/f'{key}.json').read_text(encoding='utf-8'))
                if metadata['commons_title']!=assets[key]['commons_title']:
                    raise ValueError(f'{key}: manifest and cached source differ')
                file=(cache/metadata['file']).resolve()
                if not file.is_relative_to(cache.resolve()):
                    raise ValueError(f'{key}: invalid cached path')
                data=file.read_bytes()
                if hashlib.sha256(data).hexdigest()!=metadata['sha256']:
                    raise ValueError(f'{key}: checksum mismatch')
                prepared[key]=(metadata,decode_upload(data))
            report={'products':len(products),'already_have_images':len(products)-len(pending),'new_illustrations':len(pending),'assets_used':len(prepared),'applied':apply}
            if not apply:
                print(json.dumps(report,ensure_ascii=False))
                return
            sources={}
            for key,(metadata,_) in prepared.items():
                code='catalog-illustration:'+key
                source=await session.scalar(select(DataSource).where(DataSource.code==code))
                if source is None:
                    source=DataSource(code=code)
                    session.add(source)
                source.title='Иллюстрация типа: '+assets[key]['label']
                source.source_type=SourceType.REVIEW
                source.url=metadata['page_url']
                source.publisher=('Wikimedia Commons / '+metadata['author'])[:300]
                source.retrieved_at=date.fromisoformat(metadata['retrieved_at'])
                source.notes=(f"Автор: {metadata['author']}. Лицензия: {metadata['license']} ({metadata['license_url'] or metadata['page_url']}). "
                              'Изменения: уменьшение размера и перекодирование в WebP. '
                              'Показан похожий тип оборудования; изображение не подтверждает внешний вид или ТТХ модели каталога.')
                sources[key]=source
            await session.flush()
            for product,key in pending:
                image_id=uuid.uuid4()
                written.append(image_id)
                width,height,size=write_files(prepared[key][1],image_id)
                session.add(ProductImage(id=image_id,product_id=product.id,original_name=prepared[key][0]['commons_title'][:300],
                                         width=width,height=height,size_bytes=size,source_id=sources[key].id,
                                         is_illustration=True,caption='Иллюстрация типа: '+assets[key]['label']+'. Конкретная модель может отличаться.'))
            await session.commit()
            written.clear()
            print(json.dumps(report,ensure_ascii=False),flush=True)
    except BaseException:
        remove_files(*written)
        raise
    finally:
        await engine.dispose()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true',help='Save images and sources to database; otherwise show the import plan')
    args=parser.parse_args()
    add_backend_to_path()
    asyncio.run(main(args.apply))

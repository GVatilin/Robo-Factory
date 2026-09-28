"""Extract model images from the organizer PDF, retaining page references and SHA-256.

Run on the host with PyMuPDF: python datasets/prepare_catalog_evidence.py --pdf PATH
Source assets are extracted, not generated. Ambiguous matches abort the preparation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
from urllib.request import urlopen

import fitz

HERE = Path(__file__).resolve().parent
# Reviewed title corrections for the PDF's damaged embedded font mapping.
OVERRIDES = {(16,2):33,(17,0):34,(27,1):60,(32,0):71,(35,0):75,(37,2):83,
             (39,0):87,(40,0):90,(46,0):103,(46,1):104,(47,1):107,(48,0):109,
             (52,0):114,(53,1):117,(54,0):119,(55,1):123,(56,2):126,(61,0):75,
             (66,0):142,(71,2):149,(73,2):155,(74,2):158,(80,2):168,(85,0):180,
             (89,0):149,(90,0):180}


def normalize(text):
    return ''.join(c if c.isalnum() else '.' if ord(c)<32 else '' for c in text.lower().replace('ё','е'))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf',type=Path,required=True)
    parser.add_argument('--api',default='http://localhost:8080/api/v1')
    args=parser.parse_args()
    products=json.load(urlopen(args.api+'/products?limit=200'))['items']
    by_id={p['id']:p for p in products}
    output=HERE/'evidence';output.mkdir(exist_ok=True)
    pdf_hash=hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    shutil.copyfile(args.pdf,output/'organizer-catalog.pdf')
    doc=fitz.open(args.pdf)
    result={}
    for index,page in enumerate(doc):
        if index<5:
            continue
        titles={}
        for block in page.get_text('dict')['blocks']:
            if block['type']!=0:
                continue
            for line in block['lines']:
                for span in line['spans']:
                    if abs(span['size']-19.5)<.1:
                        column=int((span['bbox'][0]-48)//453)
                        titles.setdefault(column,[]).append(span['text'])
        images=page.get_image_info(xrefs=True) if titles else []
        for column,spans in titles.items():
            pattern=normalize(''.join(spans))
            candidates=[p for p in products if re.fullmatch(pattern,normalize(p['name']))]
            override=OVERRIDES.get((index+1,column))
            if override:
                candidates=[by_id[override]]
            photos=[i for i in images if i['bbox'][1]>=60 and i['bbox'][3]<=351
                    and i['bbox'][2]-i['bbox'][0]>70 and i['bbox'][3]-i['bbox'][1]>70
                    and int(((i['bbox'][0]+i['bbox'][2])/2-48)//453)==column]
            if len(candidates)!=1 or len(photos)!=1 or not photos[0]['xref']:
                raise ValueError(f'Ambiguous image on page {index+1}, column {column}: {spans}')
            product=candidates[0]
            if product['id'] in result:
                continue
            xref=photos[0]['xref']
            original=doc.extract_image(xref)
            if original.get('smask'):
                pixmap=fitz.Pixmap(fitz.Pixmap(doc,xref),fitz.Pixmap(doc,original['smask']))
                data=pixmap.tobytes('png')
            else:
                data=original['image']
            filename=f"product-{product['id']}.image"
            (output/filename).write_bytes(data)
            result[product['id']]={'product_name':product['name'],'manufacturer':product['manufacturer']['name'],
                'page':index+1,'column':column+1,'file':filename,'sha256':hashlib.sha256(data).hexdigest(),
                'source_url':f'/api/v1/catalog-documents/organizer-catalog.pdf#page={index+1}',
                'is_illustration':product['id']==83,
                'caption':('Каталог ФЦ БАС: обозначение 85ТК. Соответствие модификации 85.0ТК требует уточнения.' if product['id']==83 else f"{product['name']}. Изображение из каталога ФЦ БАС, стр. {index+1}.")}
    manifest={'version':1,'document':'organizer-catalog.pdf','document_sha256':pdf_hash,
              'document_title':'ФЦ БАС — Каталог внедрения, август 2026','products':list(result.values())}
    (HERE/'catalog_evidence.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'products':len(result),'document_sha256':pdf_hash}))


if __name__=='__main__':
    main()

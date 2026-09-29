from datetime import date
from pathlib import Path
from zipfile import BadZipFile
from xml.etree.ElementTree import ParseError

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select, func, or_
from starlette.concurrency import run_in_threadpool
from openpyxl.utils.exceptions import InvalidFileException

from app.api.deps import CatalogEditor, DbSession
from app.core.config import settings
from app.models import SpecDefinition, SolutionType, Process, Product
from app.schemas.products import SourceIn, SpecValueIn
from app.services.products import normalize_specs
from app.services.catalog_ai_import import extract_text, extract_products, MAX_TEXT

router = APIRouter(prefix="/catalog-import", tags=["Импорт решений"])


class ExtractedSpec(SpecValueIn):
    quote: str = Field(min_length=1, max_length=2000)


class ExtractedProduct(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    name: str = Field(min_length=2, max_length=300)
    manufacturer: str = Field(max_length=300)
    purpose: str = Field(max_length=2000)
    description: str = Field(max_length=10000)
    limitations: str = Field(max_length=5000)
    country: str = Field(max_length=100)
    solution_type_id: int | None
    process_ids: list[int] = Field(max_length=100)
    quote: str = Field(min_length=1, max_length=2000)
    specs: list[ExtractedSpec] = Field(max_length=100)


class Extraction(BaseModel):
    products: list[ExtractedProduct] = Field(max_length=5)
    notes: list[str] = Field(max_length=50)


@router.post("/preview", summary="Распознать решения через GPT без сохранения в каталог")
async def preview(db: DbSession, user: CatalogEditor, file: UploadFile | None = File(None),
                  text: str = Form("", max_length=MAX_TEXT), source_title: str = Form("", max_length=500),
                  source_url: str = Form("", max_length=1000), source_type: str = Form("public_spec")):
    if bool(file) == bool(text.strip()):
        raise HTTPException(422, "Выберите файл или вставьте текст документа — один способ за раз.")
    filename = None
    if file:
        filename = Path(file.filename or "document").name
        content = await file.read(2_000_001)
        await file.close()
        if not content or len(content) > 2_000_000:
            raise HTTPException(422, "Выберите непустой XLSX, CSV или TXT до 2 МБ.")
        try:
            text = await run_in_threadpool(extract_text, content, filename)
        except (ValueError, BadZipFile, KeyError, ParseError, OSError, InvalidFileException):
            raise HTTPException(422, "Не удалось прочитать файл. Нужен XLSX без формул (до 1000 строк и 30 колонок), CSV или TXT: до 2 МБ и 25 000 символов. Можно вставить текст вручную.") from None
    try:
        source = SourceIn(source_type=source_type, title=source_title or filename or "Документ для GPT-импорта",
                          url=source_url or None, retrieved_at=date.today())
    except ValidationError:
        raise HTTPException(422, "Проверьте тип источника и ссылку на документ.") from None
    definitions = {d.code: d for d in (await db.scalars(select(SpecDefinition))).all()}
    types = (await db.scalars(select(SolutionType))).all()
    processes = (await db.scalars(select(Process))).all()
    catalog = {"specs": [{"code": d.code, "name": d.name, "data_type": d.data_type, "unit": d.unit} for d in definitions.values()],
               "solution_types": [{"id": t.id, "name": t.name} for t in types],
               "processes": [{"id": p.id, "name": p.name} for p in processes]}
    raw = await extract_products(text, catalog, str(user.id))
    try:
        result = Extraction.model_validate(raw)
    except ValidationError:
        raise HTTPException(502, "GPT вернул некорректные поля. Попробуйте один товар или меньший фрагмент документа. Ничего не сохранено.") from None
    normalized = " ".join(text.split())
    products = []
    notes = result.notes
    for product in result.products:
        if not product.quote.strip() or " ".join(product.quote.split()) not in normalized:
            notes.append(f"{product.name}: пропущено — цитата не найдена в документе.")
            continue
        if product.country.strip().casefold() not in {"", "россия", "рф", "russia", "ru", "российская федерация", "russian federation"}:
            notes.append(f"{product.name}: пропущено — указана страна {product.country}, каталог предназначен для российских решений.")
            continue
        accepted = []
        seen = set()
        for spec in product.specs:
            definition = definitions.get(spec.code)
            if not definition or spec.code in seen or not spec.quote.strip() or " ".join(spec.quote.split()) not in normalized:
                notes.append(f"{product.name}: характеристика {spec.code} пропущена — неизвестный код, повтор или нет цитаты.")
                continue
            if (spec.unit or "").replace(" ", "") != (definition.unit or "").replace(" ", ""):
                notes.append(f"{product.name}: {definition.name} пропущена — единица не совпадает со справочником.")
                continue
            spec.is_confirmed = False
            spec.is_assumption = False
            spec.note = f"Распознано GPT, требует ручной проверки. Цитата: {spec.quote}"[:2000]
            values, errors = normalize_specs([spec], definitions)
            if errors or not values:
                notes.append(f"{product.name}: {definition.name} пропущена — неверный тип или диапазон значения.")
                continue
            seen.add(spec.code)
            accepted.append({**spec.model_dump(mode="json"), "name": definition.name})
        duplicate_query = select(Product.id).where(func.lower(Product.name) == product.name.lower())
        if user.role == "vendor":
            duplicate_query = duplicate_query.where(or_(Product.is_published.is_(True), Product.manufacturer_id == user.manufacturer_id))
        duplicate_ids = list((await db.scalars(duplicate_query)).all())
        products.append({**product.model_dump(exclude={"specs"}), "specs": accepted,
            "country": "Россия" if product.country.strip() else "", "duplicate_ids": duplicate_ids,
            "solution_type_id": product.solution_type_id if product.solution_type_id in {t.id for t in types} else None,
            "process_ids": [i for i in product.process_ids if i in {p.id for p in processes}]})
    return {"products": products, "notes": notes, "source": source.model_dump(mode="json"), "model": settings.openai_model}

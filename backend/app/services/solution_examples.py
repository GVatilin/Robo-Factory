"""Документ организатора «Примеры решений по типам объектов» (.docx): эталонные решения с фото и ТТХ.

В каждом разделе документа (склад, аэропорт, медучреждение) есть таблица: строка фотографий, под ней строка
подписей «AMR (на примере модели Ronavi H1500)», за подписью в той же ячейке — строки ТТХ. Фотографии
и подписи таблицы идут в одном порядке, поэтому i-я фотография относится к i-й подписи.
Модель из подписи ищется в каталоге по названию; решения, которых в каталоге нет, добавляются.

Из документа загружаются фотографии (solution_photos_import) и ТТХ (example_specs_import).
"""

import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date
from io import BytesIO
from xml.etree import ElementTree

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DataSource, Manufacturer, Product, SolutionType
from app.models.enums import ProductClass, ReadinessStatus, SourceType
from app.utils.text import normalize_spaces, prefix_pattern

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
BLIP = "{http://schemas.openxmlformats.org/drawingml/2006/main}blip"
VML_IMAGE = "{urn:schemas-microsoft-com:vml}imagedata"

MODEL = re.compile(r"^(?P<kind>.*?)\s*\(на примере(?: модели)?\s+(?P<model>[^)]+)\)", re.IGNORECASE)
DOCUMENT_SOURCE = "organizer_solution_examples"

# Модель из подписи → название продукта в каталоге организатора, если они различаются.
CATALOG_NAMES = {
    "Pallet shuttle от Stelcon": "Pallet Shuttle",
    "Cognitive Pilot": "Беспилотный тягач (Когнитив Пилот)",
}


@dataclass(frozen=True)
class MissingProduct:
    manufacturer: str
    manufacturer_website: str
    country: str
    solution_type: str
    url: str


# Решения из документа, которых нет в каталоге организатора: карточка создаётся по документу,
# ссылка на производителя — из перечня источников в конце документа.
MISSING_PRODUCTS = {
    "PuduBot 2": MissingProduct(
        manufacturer="Pudu Robotics",
        manufacturer_website="https://www.pudurobotics.com",
        country="Китай",
        solution_type="indoor_delivery_robot",
        url="https://www.pudurobotics.com/en/products/pudubot2",
    ),
}


class ExamplesDocumentError(ValueError):
    """Файл не похож на документ «Примеры решений»."""


@dataclass
class ExampleSolution:
    model: str
    kind: str  # тип решения из подписи: «Робот-доставщик»
    section: str | None
    media: str | None
    data: bytes
    # Строки ТТХ под подписью: «Грузоподъёмность: до 1500 кг.»
    lines: list[str] = field(default_factory=list)


def _text(element: ElementTree.Element) -> str:
    return "".join(t.text or "" for t in element.iter(f"{W}t"))


def _image_ids(element: ElementTree.Element) -> list[str]:
    """Идентификаторы связей изображений в порядке документа (DrawingML и старый VML)."""
    ids = []
    for node in element.iter():
        if node.tag == BLIP and node.get(f"{R}embed"):
            ids.append(node.get(f"{R}embed"))
        elif node.tag == VML_IMAGE and node.get(f"{R}id"):
            ids.append(node.get(f"{R}id"))
    return ids


def _captions(table: ElementTree.Element) -> list[tuple[re.Match[str], list[str]]]:
    """Подписи ячеек таблицы и строки ТТХ, идущие за подписью в той же ячейке."""
    result = []
    for cell in table.iter(f"{W}tc"):
        match = None
        lines: list[str] = []
        for paragraph in cell.iter(f"{W}p"):
            text = normalize_spaces(_text(paragraph)) or ""
            if match is None:
                match = MODEL.match(text)
            elif text and text.rstrip(":").upper() != "ТТХ":
                lines.append(text)
        if match:
            result.append((match, lines))
    return result


def parse_examples_docx(content: bytes) -> tuple[list[ExampleSolution], list[str]]:
    """Эталонные решения из таблиц документа. Чистая функция — не обращается к БД."""
    try:
        archive = zipfile.ZipFile(BytesIO(content))
        document = ElementTree.fromstring(archive.read("word/document.xml"))
        rels = ElementTree.fromstring(archive.read("word/_rels/document.xml.rels"))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as exc:
        raise ExamplesDocumentError("Файл должен быть документом Word (.docx) «Примеры решений по типам объектов».") from exc
    targets = {rel.get("Id"): rel.get("Target") for rel in rels}
    body = document.find(f"{W}body")
    if body is None:
        raise ExamplesDocumentError("В документе нет содержимого.")

    solutions: list[ExampleSolution] = []
    warnings: list[str] = []
    seen: set[str] = set()
    section: str | None = None
    for element in body:
        if element.tag == f"{W}p":
            text = normalize_spaces(_text(element))
            if text and text.upper().startswith("ПРИМЕРЫ РЕШЕНИЙ") and text == text.upper():
                section = text.capitalize()
            continue
        if element.tag != f"{W}tbl":
            continue
        media = [targets[rid] for rid in _image_ids(element) if rid in targets]
        captions = _captions(element)
        if len(media) != len(captions):
            warnings.append(
                f"Раздел «{section}»: {len(media)} фото и {len(captions)} подписей — таблица пропущена, "
                "проверьте документ."
            )
            continue
        for target, (caption, lines) in zip(media, captions, strict=True):
            model = caption["model"].strip()
            if model in seen:
                continue  # одно решение повторяется в разделах разных объектов
            seen.add(model)
            path = posixpath.normpath(posixpath.join("word", target))
            try:
                data = archive.read(path)
            except KeyError:
                warnings.append(f"«{model}»: в документе нет файла {path}.")
                path, data = None, b""
            solutions.append(
                ExampleSolution(model=model, kind=caption["kind"].strip(), section=section, media=path, data=data, lines=lines)
            )
    return solutions, warnings


async def document_source(session: AsyncSession) -> DataSource:
    source = await session.scalar(select(DataSource).where(DataSource.code == DOCUMENT_SOURCE))
    if source is None:
        raise ExamplesDocumentError("В БД нет базовых справочников. Сначала запустите backend.")
    return source


async def find_product(session: AsyncSession, model: str) -> Product | None:
    name = CATALOG_NAMES.get(model, model)
    exact = await session.scalar(select(Product).where(func.lower(Product.name) == name.lower()).limit(1))
    if exact is not None:
        return exact
    # «Ronavi H1500» → «Ronavi H1500 (грузоподъемность до 1 500 кг)».
    return await session.scalar(
        select(Product).where(Product.name.ilike(prefix_pattern(f"{name} "))).order_by(func.length(Product.name)).limit(1)
    )


async def find_or_create_product(
    session: AsyncSession, solution: ExampleSolution, document: DataSource
) -> tuple[Product | None, bool]:
    """Продукт каталога для решения документа; (None, False) — нет в каталоге и не описан в MISSING_PRODUCTS."""
    product = await find_product(session, solution.model)
    if product is not None:
        return product, False
    spec = MISSING_PRODUCTS.get(solution.model)
    if spec is None:
        return None, False

    manufacturer = await session.scalar(select(Manufacturer).where(Manufacturer.name == spec.manufacturer))
    if manufacturer is None:
        manufacturer = Manufacturer(name=spec.manufacturer, country=spec.country, website=spec.manufacturer_website)
        session.add(manufacturer)
    site = await session.scalar(select(DataSource).where(DataSource.url == spec.url).limit(1))
    if site is None:
        site = DataSource(
            title=f"{solution.model} — страница производителя",
            source_type=SourceType.MANUFACTURER,
            url=spec.url,
            publisher=spec.manufacturer,
            retrieved_at=date.today(),
        )
        session.add(site)
    product = Product(
        name=solution.model,
        manufacturer=manufacturer,
        solution_type=await session.scalar(select(SolutionType).where(SolutionType.code == spec.solution_type)),
        product_class=ProductClass.BRS,
        readiness_status=ReadinessStatus.OPERATION,
        country_of_origin=spec.country,
        description=f"{solution.kind}: пример решения из документа организатора, раздел «{solution.section}».",
        sources=[document, site],
    )
    session.add(product)
    await session.flush()
    return product, True

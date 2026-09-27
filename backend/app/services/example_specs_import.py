"""ТТХ эталонных решений из документа «Примеры решений по типам объектов» (разбор документа — solution_examples).

Строка «Грузоподъёмность: до 1500 кг.» разбирается по правилу: метка → характеристика справочника,
значение → число в единицах справочника (тонны → кг, км/ч → м/с, см → мм, минуты → часы).
Для характеристик-чисел из диапазона сохраняется верхняя граница («до 3–4 км/ч» → 4 км/ч, «около 2000–2500 кг»
→ 2500 кг), для характеристик-диапазонов — обе границы. Исходная строка хранится в примечании значения,
поэтому видно, из чего получено число. Нераспознанные строки попадают в отчёт импорта.

Значения, внесённые вручную или из другого источника, импорт не меняет. Повторный импорт того же файла пропускается.
"""

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DatasetVersion, Product, ProductSpecValue, SolutionType, SpecDefinition
from app.models.enums import DatasetKind
from app.services.solution_examples import ExampleSolution, document_source, find_or_create_product, parse_examples_docx
from app.services.taxonomy import resolve_type

# Число без буквы перед ним: «м2» и «N1» не дают чисел. Тысячи через пробел: «3 000».
NUMBER = re.compile(r"(?<![\w.,])[−-]?(?:\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,]\d+)?")
TEMPERATURE = re.compile(r"([+−-]?\d+)\s*(?:…|\.\.\.|–|—)\s*([+−-]?\d+)\s*°\s*[CС]")
DIMENSION_SEPARATOR = re.compile(r"\s*[×xх*]\s*")
DIMENSION_CODES = {"Д": "length_mm", "Г": "length_mm", "Ш": "width_mm", "В": "height_mm"}


@dataclass(frozen=True)
class Parsed:
    code: str
    value: float | None = None
    value_max: float | None = None
    text: str | None = None
    unit: str | None = None


def numbers(text: str) -> list[float]:
    result = []
    for match in NUMBER.finditer(text):
        raw = re.sub(r"[   ]", "", match.group()).replace("−", "-").replace(",", ".")
        result.append(float(raw))
    return result


def _scale(text: str, kind: str) -> float:
    """Множитель к единице справочника по единице, указанной в строке."""
    low = text.lower()
    if kind == "mass":
        return 1000.0 if re.search(r"тонн|\d\s*т\b", low) else 1.0
    if kind == "speed":
        return 1 / 3.6 if "км/ч" in low else 1.0
    if kind == "duration":
        return 1 / 60 if "мин" in low else 1.0
    if kind == "length":
        if "мм" in low:
            return 1.0
        if re.search(r"\d\s*см|\bсм\b", low):
            return 10.0
        if re.search(r"метр|\d\s*м\b", low):
            return 1000.0
    return 1.0


def _round(value: float) -> float:
    return round(value, 4 if abs(value) < 10 else 2)


def number_rule(code: str, kind: str = "plain", *, as_range: bool = False) -> Callable[[str, str], list[Parsed]]:
    def parse(_: str, value: str) -> list[Parsed]:
        found = numbers(value)
        if not found:
            return []
        scale = _scale(value, kind)
        low, high = _round(min(found) * scale), _round(max(found) * scale)
        if as_range and low != high:
            return [Parsed(code, value=low, value_max=high)]
        return [Parsed(code, value=high)]

    return parse


def text_rule(code: str) -> Callable[[str, str], list[Parsed]]:
    return lambda _, value: [Parsed(code, text=value.rstrip(". "))]


def throughput(_: str, value: str) -> list[Parsed]:
    found = numbers(re.sub(r"м2|м²", "", value))
    if not found:
        return []
    unit = "паллет/ч" if "паллет" in value.lower() else "м²/ч" if re.search(r"м2|м²", value) else None
    low, high = min(found), max(found)
    return [Parsed("throughput", value=low, value_max=high if high != low else None, unit=unit)]


def dimensions(label: str, value: str) -> list[Parsed]:
    order_hint = re.search(r"\(([^)]*)\)", label)
    order = [c for c in (order_hint.group(1) if order_hint else "") if c in DIMENSION_CODES] or ["Д", "Ш", "В"]
    # «примерно 2050 × 1975 × 1000 мм»: последнее число первой части и первое число остальных.
    parts = [numbers(part) for part in DIMENSION_SEPARATOR.split(value)]
    sizes = [part[-1] if index == 0 else part[0] for index, part in enumerate(parts) if part]
    if len(sizes) != 3 or len(order) != 3:
        return []
    scale = _scale(value, "length")
    return [Parsed(DIMENSION_CODES[letter], value=_round(size * scale)) for letter, size in zip(order, sizes, strict=True)]


def conditions(_: str, value: str) -> list[Parsed]:
    result = [Parsed("operating_conditions", text=value.rstrip(". "))]
    match = TEMPERATURE.search(value)
    if match:
        low, high = (float(g.replace("−", "-")) for g in match.groups())
        result.append(Parsed("operating_temp_c", value=low, value_max=high))
    return result


def charge_and_runtime(_: str, value: str) -> list[Parsed]:
    """«Время зарядки/работы: 4 часа/12 часов»."""
    charge, _, runtime = value.partition("/")
    return number_rule("charge_time_h", "duration")("", charge) + number_rule("runtime_h", "duration", as_range=True)("", runtime)


# Порядок важен: срабатывает первое совпадение по метке строки.
RULES: list[tuple[re.Pattern[str], Callable[[str, str], list[Parsed]]]] = [
    (re.compile(p, re.IGNORECASE), handler)
    for p, handler in [
        (r"время зарядки\s*/\s*работы", charge_and_runtime),
        (r"грузоподъ[её]мност", number_rule("payload_kg", "mass")),
        (r"^(масса|вес)\b", number_rule("weight_kg", "mass")),
        (r"габарит", dimensions),
        (r"скорост", number_rule("max_speed_mps", "speed")),
        (r"навигац", text_rule("navigation_type")),
        (r"время зарядки", number_rule("charge_time_h", "duration")),
        (r"время (автономной )?работы|автономност", number_rule("runtime_h", "duration", as_range=True)),
        (r"производительност|эффективность уборки", throughput),
        (r"точность позиционирования", number_rule("positioning_accuracy_mm", "length")),
        (r"условия эксплуатации", conditions),
        (r"ширина (проезда|прохода)", number_rule("min_aisle_width_mm", "length")),
        (r"высота подъ[её]ма", number_rule("lift_height_mm", "length")),
        (r"ширина (захвата|уборки)", number_rule("cleaning_width_mm", "length", as_range=True)),
        (r"бак для моющего|объ[её]м бака", number_rule("tank_volume_l")),
        (r"запас хода", number_rule("range_km", as_range=True)),
        (r"(объ[её]м|ёмкость|емкость) (аккумулятор|акб|батаре)", number_rule("battery_capacity_kwh")),
    ]
]


def parse_spec_lines(lines: list[str]) -> tuple[list[tuple[Parsed, str]], list[str]]:
    """Значения ТТХ и исходные строки; второй список — строки, для которых нет правила."""
    parsed: list[tuple[Parsed, str]] = []
    unknown: list[str] = []
    seen: set[str] = set()
    for line in lines:
        label, colon, value = line.partition(":")
        if not colon or not value.strip():
            unknown.append(line)
            continue
        handler = next((h for pattern, h in RULES if pattern.search(label.strip())), None)
        values = handler(label.strip(), value.strip()) if handler else []
        if not values:
            unknown.append(line)
        for item in values:
            if item.code not in seen:  # первое значение характеристики в строках решения
                seen.add(item.code)
                parsed.append((item, line))
    return parsed, unknown


@dataclass
class SpecsImportStats:
    status: str = "imported"
    dataset_version_id: int | None = None
    solutions: int = 0
    products_created: int = 0
    specs_created: int = 0
    specs_updated: int = 0
    specs_kept: int = 0
    types_refined: int = 0
    warnings: list[str] = field(default_factory=list)


def _decimal(value: float | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


def refine_type(product: Product, solution: ExampleSolution, types: dict[str, SolutionType]) -> SolutionType | None:
    """Тип решения из подписи документа («FMR (мобильный вилочный робот)» → FMR) для товара,
    у которого в каталоге указана только категория. Возвращает новый тип или None."""
    current = product.solution_type
    if current is not None and current.parent_id is not None:
        return None
    resolved = resolve_type(solution.kind.split("(")[0])
    candidate = types.get(resolved[0]) if resolved else None
    if candidate is None or candidate.parent_id is None or candidate is current:
        return None
    return candidate


async def import_example_specs(session: AsyncSession, content: bytes, file_name: str) -> SpecsImportStats:
    """Записывает ТТХ из документа в карточки. Коммит — на стороне вызывающего кода."""
    stats = SpecsImportStats()
    checksum = hashlib.sha256(content).hexdigest()
    existing = await session.scalar(
        select(DatasetVersion).where(
            DatasetVersion.kind == DatasetKind.REFERENCE_SPECS, DatasetVersion.checksum_sha256 == checksum
        )
    )
    if existing:
        stats.status = "skipped"
        stats.dataset_version_id = existing.id
        return stats

    document = await document_source(session)
    solutions, warnings = parse_examples_docx(content)
    stats.solutions = len(solutions)
    stats.warnings.extend(warnings)
    definitions = {d.code: d for d in (await session.scalars(select(SpecDefinition))).all()}
    types = {t.code: t for t in (await session.scalars(select(SolutionType))).all()}

    for solution in solutions:
        product, created = await find_or_create_product(session, solution, document)
        if product is None:
            stats.warnings.append(f"«{solution.model}»: товара нет в каталоге — ТТХ пропущены.")
            continue
        stats.products_created += created
        await session.refresh(product, ["spec_values", "sources", "solution_type"])
        refined = refine_type(product, solution, types)
        if refined is not None:
            previous = product.solution_type.name if product.solution_type else "не указан"
            stats.warnings.append(f"«{product.name}»: тип уточнён по документу — {previous} → {refined.name}")
            product.solution_type = refined
            stats.types_refined += 1
        current = {v.spec_definition_id: v for v in product.spec_values}
        parsed, unknown = parse_spec_lines(solution.lines)
        for line in unknown:
            stats.warnings.append(f"«{solution.model}»: строка не распознана — «{line}»")
        for item, line in parsed:
            definition = definitions.get(item.code)
            if definition is None:
                continue
            value = current.get(definition.id)
            if value is not None and value.source_id not in (None, document.id):
                stats.specs_kept += 1  # значение из карточки или другого источника важнее документа
                continue
            fields = {
                "value_numeric": _decimal(item.value),
                "value_numeric_max": _decimal(item.value_max),
                "value_text": item.text,
                "unit": item.unit if item.unit and item.unit != definition.unit else None,
                "source_id": document.id,
                "retrieved_at": document.retrieved_at,
                "is_confirmed": True,
                "is_assumption": False,
                "note": f"Документ организатора: «{line}»",
            }
            if value is None:
                session.add(ProductSpecValue(product_id=product.id, spec_definition_id=definition.id, **fields))
                stats.specs_created += 1
            else:
                for key, val in fields.items():
                    setattr(value, key, val)
                stats.specs_updated += 1
        if document not in product.sources:
            product.sources.append(document)

    await session.execute(
        update(DatasetVersion).where(DatasetVersion.kind == DatasetKind.REFERENCE_SPECS).values(is_current=False)
    )
    version = DatasetVersion(
        kind=DatasetKind.REFERENCE_SPECS,
        label=file_name.rsplit(".", 1)[0],
        file_name=file_name,
        checksum_sha256=checksum,
        source_id=document.id,
        row_count=stats.solutions,
        stats={k: v for k, v in stats.__dict__.items() if k not in ("warnings", "status", "dataset_version_id")},
        is_current=True,
    )
    session.add(version)
    await session.flush()
    stats.dataset_version_id = version.id
    return stats

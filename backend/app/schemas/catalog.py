from typing import Literal

from pydantic import BaseModel

from app.models.enums import SpecGroup, ValueDataType
from app.schemas.products import ProductSummary


class TreeNode(BaseModel):
    """Узел иерархии каталога: отрасль → тип объекта → процесс → тип решения (п. 3.3.1 ТЗ)."""

    key: str
    kind: Literal["industry", "facility", "process", "solution_type", "other"]
    name: str
    count: int
    # Параметры запроса GET /products, которые показывают товары узла.
    params: dict[str, int | bool]
    children: list["TreeNode"] = []


class FacetValue(BaseModel):
    value: str
    label: str
    count: int
    group: str | None = None


class CatalogFacets(BaseModel):
    """Число товаров для каждого значения при остальных выбранных фильтрах."""

    solution_types: list[FacetValue]
    product_classes: list[FacetValue]
    readiness_statuses: list[FacetValue]
    countries: list[FacetValue]
    acquisition_models: list[FacetValue]
    with_image: int
    with_cases: int


class CatalogItem(ProductSummary):
    # Характеристики из фильтра, по которым у товара нет данных: решение требует проверки (п. 3.4.3 ТЗ).
    unknown: list[str] = []


class CatalogPage(BaseModel):
    items: list[CatalogItem]
    total: int
    limit: int
    offset: int
    facets: CatalogFacets | None = None


class SpecFilterInfo(BaseModel):
    code: str
    name: str
    group: SpecGroup
    unit: str | None
    data_type: ValueDataType
    # Условие фильтра по умолчанию: >= «не меньше», <= «не больше», ~ «содержит», = «да / нет», range — обе границы.
    operator: Literal[">=", "<=", "~", "=", "range"]
    count: int
    min: float | None
    max: float | None
    suggestions: list[str] = []


class CatalogFilterInfo(BaseModel):
    """Фильтруемые характеристики с диапазонами значений в каталоге — для построения панели фильтров."""

    specs: list[SpecFilterInfo]
    price_min: float | None
    price_max: float | None
    total: int


class CompareCell(BaseModel):
    value: float | None = None
    value_max: float | None = None
    text: str | None = None
    items: list[str] | None = None
    flag: bool | None = None
    unit: str | None = None
    confirmed: bool | None = None
    note: str | None = None


class CompareRow(BaseModel):
    key: str
    label: str
    kind: Literal["number", "money", "percent", "text", "list", "bool", "date"]
    unit: str | None = None
    better: Literal["higher", "lower"] | None = None
    mandatory: bool = False
    hint: str | None = None
    cells: list[CompareCell]
    # Индексы лучших значений строки и признак того, что значения различаются.
    best: list[int] = []
    differs: bool = False


class CompareGroup(BaseModel):
    key: str
    title: str
    description: str | None = None
    rows: list[CompareRow]


class Comparison(BaseModel):
    products: list[ProductSummary]
    groups: list[CompareGroup]
    missing: list[int] = []

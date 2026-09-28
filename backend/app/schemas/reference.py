from pydantic import BaseModel

from app.models.enums import SpecGroup, ValueDataType
from app.schemas.common import Option, Ref, Schema


class SolutionTypeNode(Schema):
    id: int
    code: str
    name: str
    description: str | None
    children: list["SolutionTypeNode"] = []


class SpecDefinitionOut(Schema):
    id: int
    code: str
    name: str
    group: SpecGroup
    unit: str | None
    data_type: ValueDataType
    is_mandatory: bool
    is_filterable: bool
    description: str | None


class ProcessRef(BaseModel):
    id: int
    code: str
    name: str
    solution_type_ids: list[int]


class FacilityTypeOut(BaseModel):
    id: int
    code: str
    name: str
    description: str | None
    industry: Ref
    processes: list[ProcessRef]


class ChecklistItemOut(BaseModel):
    key: str
    label: str
    group: str
    excluded_product_classes: list[str] = []
    excluded_solution_types: list[str] = []


class CatalogOptions(BaseModel):
    """Значения перечислений каталога с русскими названиями — для форм и фильтров."""

    product_classes: list[Option]
    readiness_statuses: list[Option]
    acquisition_models: list[Option]
    source_types: list[Option]
    spec_groups: list[Option]

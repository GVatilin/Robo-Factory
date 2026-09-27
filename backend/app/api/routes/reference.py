from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession
from app.core import labels
from app.models import FacilityType, Industry, Process, SolutionType, SpecDefinition
from app.schemas.common import Option, Ref
from app.schemas.reference import (
    CatalogOptions,
    ChecklistItemOut,
    FacilityTypeOut,
    ProcessRef,
    SolutionTypeNode,
    SpecDefinitionOut,
)
from app.services.catalog_view import mandatory_specs
from app.services.completeness import checklist

router = APIRouter(prefix="/reference", tags=["Справочники"])


def _options(mapping: dict) -> list[Option]:
    return [Option(value=str(value), label=label) for value, label in mapping.items()]


@router.get("/solution-types", response_model=list[SolutionTypeNode], summary="Дерево типов решений")
async def solution_types(db: DbSession) -> list[SolutionTypeNode]:
    """Категория → тип решения (п. 3.3.1 ТЗ)."""
    nodes = (await db.scalars(select(SolutionType).order_by(SolutionType.sort_order, SolutionType.name))).all()
    children: dict[int, list[SolutionTypeNode]] = {}
    for node in nodes:
        if node.parent_id is not None:
            children.setdefault(node.parent_id, []).append(
                SolutionTypeNode(id=node.id, code=node.code, name=node.name, description=node.description)
            )
    return [
        SolutionTypeNode(
            id=n.id, code=n.code, name=n.name, description=n.description, children=children.get(n.id, [])
        )
        for n in nodes
        if n.parent_id is None
    ]


@router.get("/spec-definitions", response_model=list[SpecDefinitionOut], summary="Справочник характеристик")
async def spec_definitions(db: DbSession) -> list[SpecDefinition]:
    return list((await db.scalars(select(SpecDefinition).order_by(SpecDefinition.sort_order))).all())


@router.get("/facility-types", response_model=list[FacilityTypeOut], summary="Типы объектов и процессы")
async def facility_types(db: DbSession) -> list[FacilityTypeOut]:
    """Процессы с типами решений, которые к ним применимы: форма товара подсказывает подходящие процессы."""
    facilities = (
        await db.scalars(
            select(FacilityType)
            .where(FacilityType.is_active.is_(True))
            .options(
                selectinload(FacilityType.industry),
                selectinload(FacilityType.processes).selectinload(Process.solution_types),
            )
            .order_by(FacilityType.sort_order)
        )
    ).all()
    return [
        FacilityTypeOut(
            id=f.id,
            code=f.code,
            name=f.name,
            description=f.description,
            industry=Ref.model_validate(f.industry),
            processes=[
                ProcessRef(id=p.id, code=p.code, name=p.name, solution_type_ids=[t.id for t in p.solution_types])
                for p in f.processes
            ],
        )
        for f in facilities
    ]


@router.get("/industries", response_model=list[Ref], summary="Отрасли")
async def industries(db: DbSession) -> list[Industry]:
    return list((await db.scalars(select(Industry).order_by(Industry.sort_order, Industry.name))).all())


@router.get("/product-checklist", response_model=list[ChecklistItemOut], summary="Чек-лист полноты карточки")
async def product_checklist(db: DbSession) -> list[ChecklistItemOut]:
    """Обязательные характеристики п. 3.3.7 ТЗ, по которым считается полнота карточки товара."""
    return [ChecklistItemOut(key=i.key, label=i.label, group=i.group) for i in checklist(await mandatory_specs(db))]


@router.get("/catalog-options", response_model=CatalogOptions, summary="Значения перечислений каталога")
async def catalog_options() -> CatalogOptions:
    return CatalogOptions(
        product_classes=_options(labels.PRODUCT_CLASS),
        readiness_statuses=_options(labels.READINESS_STATUS),
        acquisition_models=_options(labels.ACQUISITION_MODEL),
        source_types=_options(labels.SOURCE_TYPE),
        spec_groups=_options(labels.SPEC_GROUP),
    )

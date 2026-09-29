from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession, AdminUser
from app.api.errors import ApiValidationError
from app.core import labels
from app.models import FacilityType, Industry, Process, SolutionType, SpecDefinition, ParameterDefinition, DataSource
from app.schemas.object_reference import ObjectTypeInput, ObjectParameterInput, ParameterSourceInput
from app.services.projects import validate_parameters
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


@router.post("/facility-types", status_code=201, summary="Добавить тип объекта (администратор)")
async def create_facility(data: ObjectTypeInput, db: DbSession, user: AdminUser):
    if not await db.get(Industry, data.industry_id):
        raise HTTPException(422, "Отрасль не найдена.")
    facility = FacilityType(**data.model_dump())
    db.add(facility)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Тип объекта с таким кодом уже существует.") from None
    return {"id": facility.id, "code": facility.code, "name": facility.name}


@router.get("/parameter-sources", summary="Источники параметров")
async def parameter_sources(db: DbSession):
    sources = (await db.scalars(select(DataSource).order_by(DataSource.title))).all()
    return [{"id": s.id, "title": s.title, "url": s.url, "source_type": s.source_type} for s in sources]


@router.post("/parameter-sources", status_code=201)
async def add_parameter_source(data: ParameterSourceInput, db: DbSession, user: AdminUser):
    from uuid import uuid4
    from datetime import date
    source = DataSource(code="parameter-source:" + uuid4().hex,
        title=data.title, source_type=data.source_type,
        url=str(data.url) if data.url else None, notes=data.notes, retrieved_at=date.today())
    db.add(source)
    await db.commit()
    return {"id": source.id, "title": source.title}


@router.put("/facility-types/{facility_id}/parameters/{code}")
async def edit_parameter(facility_id: int, code: str, data: ObjectParameterInput, db: DbSession, user: AdminUser):
    from app.models import Project
    definition = await db.scalar(select(ParameterDefinition).where(
        ParameterDefinition.facility_type_id == facility_id, ParameterDefinition.code == code))
    if definition is None:
        raise HTTPException(404, "Параметр не найден.")
    if data.code != code or data.data_type != definition.data_type or data.unit != definition.unit:
        raise HTTPException(422, "Код, тип и единицы существующего параметра неизменяемы. Добавьте новый параметр.")
    if not await db.get(DataSource, data.source_id):
        raise HTTPException(422, "Источник не найден.")
    candidate = ParameterDefinition(facility_type_id=facility_id, **data.model_dump())
    validate_parameters({code: candidate.default_value}, [candidate])
    projects = (await db.scalars(select(Project).where(Project.facility_type_id == facility_id))).all()
    for project in projects:
        if code in project.parameters:
            try:
                validate_parameters({code: project.parameters[code]}, [candidate])
            except ApiValidationError:
                raise HTTPException(409, "Новый диапазон или список исключает значения сохранённых проектов. Расширьте ограничения.") from None
    for key, value in data.model_dump().items():
        setattr(definition, key, value)
    await db.commit()
    return {"id": definition.id, "code": definition.code}


@router.post("/facility-types/{facility_id}/parameters", status_code=201, summary="Добавить параметр объекта (администратор)")
async def add_parameter(facility_id: int, data: ObjectParameterInput, db: DbSession, user: AdminUser):
    if not await db.get(FacilityType, facility_id):
        raise HTTPException(404, "Тип объекта не найден.")
    if not await db.get(DataSource, data.source_id):
        raise HTTPException(422, "Выберите существующий источник параметра.")
    from sqlalchemy import func
    count = await db.scalar(select(func.count(ParameterDefinition.id)).where(ParameterDefinition.facility_type_id == facility_id))
    if count >= 300:
        raise HTTPException(422, "Для одного типа объекта доступно до 300 параметров.")
    definition = ParameterDefinition(facility_type_id=facility_id, **data.model_dump())
    validate_parameters({definition.code: definition.default_value}, [definition])
    db.add(definition)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Параметр с таким кодом уже существует у этого типа объекта.") from None
    return {"id": definition.id, "code": definition.code, "facility_type_id": facility_id}


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
    return [ChecklistItemOut(key=i.key, label=i.label, group=i.group,
                            excluded_product_classes=list(i.excluded_product_classes),
                            excluded_solution_types=list(i.excluded_solution_types))
            for i in checklist(await mandatory_specs(db))]


@router.get("/catalog-options", response_model=CatalogOptions, summary="Значения перечислений каталога")
async def catalog_options() -> CatalogOptions:
    return CatalogOptions(
        product_classes=_options(labels.PRODUCT_CLASS),
        readiness_statuses=_options(labels.READINESS_STATUS),
        acquisition_models=_options(labels.ACQUISITION_MODEL),
        source_types=_options(labels.SOURCE_TYPE),
        spec_groups=_options(labels.SPEC_GROUP),
    )

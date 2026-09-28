import uuid
from pathlib import Path
from datetime import UTC, datetime
import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile, File, Form
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.models import FacilityType, ParameterDefinition, Project, ProjectFile, Scenario, ScenarioItem
from app.schemas.projects import ParameterOut, ParameterValues, ProjectDetail, ProjectInput, ProjectSummary, ProjectUpdate
from app.services.demo_projects import default_scenarios
from app.services.projects import missing_required, validate_parameters, parse_parameter_file, parameter_template, parameter_workbook
from app.services.project_overview import project_summaries, scenario_overview
from app.models.enums import ProjectFileKind
from app.core.config import settings

router = APIRouter(prefix="/projects", tags=["Проекты объектов"])


async def definitions(db, facility_id):
    return list((await db.scalars(select(ParameterDefinition).where(ParameterDefinition.facility_type_id == facility_id)
                                 .options(selectinload(ParameterDefinition.source)).order_by(ParameterDefinition.sort_order))).all())


async def visible_project(db, project_id, user, *, write=False):
    condition = Project.owner_id == user.id if user else Project.is_demo.is_(True)
    if not write:
        condition = or_(condition, Project.is_demo.is_(True))
    stmt = select(Project).where(Project.id == project_id, condition).options(selectinload(Project.scenarios).selectinload(Scenario.items).selectinload(ScenarioItem.product))
    if write:
        stmt = stmt.where(Project.is_demo.is_(False)).with_for_update()
    project = await db.scalar(stmt)
    if project is None:
        raise HTTPException(404, "Проект не найден или недоступен.")
    return project


async def detail(db, project):
    defs = await definitions(db, project.facility_type_id)
    # Загружаем и пустые коллекции после создания, и продукты после копирования.
    if project.scenarios:
        (await db.scalars(select(Scenario).where(Scenario.project_id == project.id)
                         .options(selectinload(Scenario.items).selectinload(ScenarioItem.product)))).all()
    scenarios, _ = await scenario_overview(db, project)
    summary = (await project_summaries(db, [project]))[0]
    return ProjectDetail(**summary.model_dump(), parameters=project.parameters,
                         parameter_origins=project.parameter_origins,
                         missing_required=missing_required(project.parameters, defs),
                         scenarios=scenarios)


@router.get("/parameters/{facility_id}", response_model=list[ParameterOut])
async def parameters(facility_id: int, db: DbSession):
    if not await db.get(FacilityType, facility_id):
        raise HTTPException(404, "Тип объекта не найден.")
    return [ParameterOut(**{k: getattr(d, k) for k in ParameterOut.model_fields if k != "source"},
                         source=d.source.title if d.source else None) for d in await definitions(db, facility_id)]


@router.get("", response_model=list[ProjectSummary])
async def list_projects(db: DbSession, user: OptionalUser, demo: bool = False,
                        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    if not demo and not user:
        raise HTTPException(401, "Войдите, чтобы открыть свои проекты.")
    condition = Project.is_demo.is_(True) if demo else Project.owner_id == user.id
    projects = list((await db.scalars(select(Project).where(condition).order_by(Project.updated_at.desc(), Project.id)
                                 .limit(limit).offset(offset))).all())
    return await project_summaries(db, projects)


def template_response(values, defs, format):
    content = parameter_workbook(values, defs) if format == "xlsx" else parameter_template(values, defs)
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if format == "xlsx" else "text/csv; charset=utf-8"
    return Response(content, media_type=mime, headers={"Content-Disposition": f'attachment; filename="project-parameters.{format}"'})


@router.get("/parameters/{facility_id}/template")
async def facility_template(facility_id: int, db: DbSession, format: Literal["csv", "xlsx"] = "xlsx"):
    if not await db.get(FacilityType, facility_id):
        raise HTTPException(404, "Тип объекта не найден.")
    return template_response({}, await definitions(db, facility_id), format)


@router.post("/parameters/{facility_id}/validate")
async def check_parameters(facility_id: int, data: ParameterValues, db: DbSession, user: CurrentUser):
    if not await db.get(FacilityType, facility_id):
        raise HTTPException(404, "Тип объекта не найден.")
    defs = await definitions(db, facility_id)
    if not defs:
        raise HTTPException(422, "Справочник параметров ещё не заполнен.")
    values = validate_parameters(data.parameters, defs, require_complete=True)
    return {"parameters": values, "ready": True}


@router.post("/parameters/{facility_id}/preview")
async def preview_parameters(facility_id: int, db: DbSession, user: CurrentUser,
                             file: UploadFile = File(...), parameters: str = Form("{}")):
    if not await db.get(FacilityType, facility_id):
        raise HTTPException(404, "Тип объекта не найден.")
    if len(parameters) > 700_000:
        raise HTTPException(422, "Слишком большой набор параметров.")
    try:
        base = ParameterValues.model_validate({"parameters": json.loads(parameters)}).parameters
    except ValueError:
        raise HTTPException(422, "Некорректные текущие параметры.") from None
    content = await file.read(2_000_001)
    await file.close()
    if not content or len(content) > 2_000_000:
        raise HTTPException(422, "Выберите непустой CSV/XLSX до 2 МБ.")
    defs = await definitions(db, facility_id)
    imported = parse_parameter_file(content, Path(file.filename or "").suffix.lower(), defs)
    merged = validate_parameters({**base, **imported}, defs)
    missing = missing_required(merged, defs)
    return {"parameters": merged, "changed_codes": list(imported), "ready": not missing,
            "missing_required": [{"code": d.code, "name": d.name} for d in defs if d.code in missing],
            "rows": [{"code": d.code, "name": d.name, "unit": d.unit, "value": merged.get(d.code)} for d in defs if d.code in imported]}


@router.get("/{project_id}/scenario-comparison")
async def compare_project_scenarios(project_id: uuid.UUID, db: DbSession, user: OptionalUser):
    project = await visible_project(db, project_id, user)
    _, groups = await scenario_overview(db, project)
    return {"groups": groups}


@router.post("", response_model=ProjectDetail, status_code=201)
async def create_project(data: ProjectInput, db: DbSession, user: CurrentUser):
    facility = await db.get(FacilityType, data.facility_type_id)
    if not facility or not facility.is_active:
        raise HTTPException(422, "Выберите доступный тип объекта.")
    defs = await definitions(db, facility.id)
    values = validate_parameters(data.parameters, defs)
    project = Project(owner_id=user.id, facility_type_id=facility.id, name=data.name, description=data.description,
                      parameters=values, parameter_origins={k: "manual" for k in values}, scenarios=default_scenarios())
    db.add(project)
    await db.commit()
    return await detail(db, project)


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(project_id: uuid.UUID, db: DbSession, user: OptionalUser):
    return await detail(db, await visible_project(db, project_id, user))


@router.get("/{project_id}/parameters/template")
async def download_template(project_id: uuid.UUID, db: DbSession, user: OptionalUser, format: Literal["csv", "xlsx"] = "csv"):
    project = await visible_project(db, project_id, user)
    return template_response(project.parameters, await definitions(db, project.facility_type_id), format)


@router.post("/{project_id}/parameters/import", response_model=ProjectDetail)
async def import_parameters(project_id: uuid.UUID, db: DbSession, user: CurrentUser,
                            file: UploadFile = File(...), updated_at: datetime = Form(...)):
    content = await file.read(2_000_001)
    await file.close()
    if not content or len(content) > 2_000_000:
        raise HTTPException(422, "Выберите непустой файл размером до 2 МБ.")
    project = await visible_project(db, project_id, user, write=True)
    if project.updated_at != updated_at:
        raise HTTPException(409, "Проект изменился. Откройте его заново перед загрузкой.")
    defs = await definitions(db, project.facility_type_id)
    suffix = Path(file.filename or "").suffix.lower()
    imported = parse_parameter_file(content, suffix, defs)
    values = validate_parameters({**project.parameters, **imported}, defs)
    path = settings.upload_dir / "projects" / str(project.id) / f"{uuid.uuid4()}{suffix}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    try:
        project.parameters = values
        project.parameter_origins = {k: "file" if k in imported else project.parameter_origins.get(k, "manual") for k in values}
        project.updated_at = datetime.now(UTC)
        db.add(ProjectFile(project_id=project.id, kind=ProjectFileKind.PARAMETERS_IMPORT,
                           original_name=Path(file.filename).name[:300], stored_path=str(path),
                           content_type="text/csv" if suffix == ".csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           size_bytes=len(content), uploaded_by_id=user.id))
        await db.commit()
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return await detail(db, project)


@router.put("/{project_id}", response_model=ProjectDetail)
async def update_project(project_id: uuid.UUID, data: ProjectUpdate, db: DbSession, user: CurrentUser):
    project = await visible_project(db, project_id, user, write=True)
    if project.updated_at != data.updated_at:
        raise HTTPException(409, "Проект изменён в другой вкладке. Откройте его заново перед сохранением.")
    values = validate_parameters(data.parameters, await definitions(db, project.facility_type_id))
    project.parameter_origins = {k: project.parameter_origins.get(k, "manual") if project.parameters.get(k) == v else "manual" for k, v in values.items()}
    project.parameters = values
    project.name, project.description = data.name, data.description
    project.updated_at = datetime.now(UTC)
    await db.commit()
    return await detail(db, project)


@router.post("/{project_id}/copy", response_model=ProjectDetail, status_code=201)
async def copy_project(project_id: uuid.UUID, db: DbSession, user: CurrentUser):
    source = await visible_project(db, project_id, user)
    scenarios = [Scenario(name=s.name, kind=s.kind, description=s.description, sort_order=s.sort_order,
                          assumptions=s.assumptions, items=[ScenarioItem(**{k: getattr(item, k) for k in (
                              "product_id", "offer_id", "process_id", "quantity_calculated", "quantity_manual",
                              "is_manual_selection", "warning", "notes")}) for item in s.items]) for s in source.scenarios]
    project = Project(owner_id=user.id, facility_type_id=source.facility_type_id, name=(source.name[:290] + " — копия"),
                      description=source.description, parameters=source.parameters.copy(), parameter_origins=source.parameter_origins.copy(),
                      copied_from_id=source.id, scenarios=scenarios)
    db.add(project)
    await db.commit()
    return await detail(db, project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: uuid.UUID, db: DbSession, user: CurrentUser):
    project = await visible_project(db, project_id, user, write=True)
    files = (await db.scalars(select(ProjectFile).where(ProjectFile.project_id == project.id))).all()
    root = settings.upload_dir.resolve()
    paths = []
    for file in files:
        path = Path(file.stored_path)
        path = (path if path.is_absolute() else root / path).resolve()
        if not path.is_relative_to(root) or path == root:
            raise HTTPException(409, "Путь файла проекта требует проверки администратором.")
        paths.append(path)
    await db.delete(project)
    await db.commit()
    for path in paths:
        path.unlink(missing_ok=True)
    return Response(status_code=204)

import uuid
from datetime import UTC, datetime
from time import perf_counter

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select

from app.api.deps import DbSession, OptionalUser
from app.api.routes.projects import visible_project
from app.api.routes.project_selection import select_for_project
from app.models import CalculationRun
from app.models.enums import CalculationStatus, CalculationType
from app.schemas.equipment import EquipmentInput
from app.schemas.simulation import SimulationRequest
from app.services.simulation import VERSION, simulate

router = APIRouter(prefix="/projects", tags=["Имитация работы роботов"])


async def simulation_snapshot(db, project, data):
    if data.economics_run_id:
        run = await db.scalar(select(CalculationRun).where(
            CalculationRun.id == data.economics_run_id, CalculationRun.project_id == project.id,
            CalculationRun.calc_type == CalculationType.ECONOMICS, CalculationRun.scenario_id.is_(None),
            CalculationRun.status == CalculationStatus.SUCCEEDED))
        if run is None:
            raise HTTPException(404, "Сохранённый расчёт не найден в этом проекте.")
        original = run.inputs_snapshot
        try:
            economics = original["economics"]["scenarios"][data.scenario_index]
            binding = original["bindings"][data.scenario_index]
            selection = original["selection"]
            candidate = next(c for c in selection["candidates"] if c["product_id"] == binding["product_id"])
        except (KeyError, IndexError, StopIteration):
            raise HTTPException(422, "У расчёта нет полного снимка подбора. Сохраните новый расчёт.")
        quantity, name = economics["quantity"], economics["name"]
        equipment = economics.get("equipment") or (candidate.get("equipment") or {}).get("inputs")
        parameters = original["parameters"]
    else:
        selection = await select_for_project(db, project, data.selection)
        candidate = next((c for c in selection["candidates"] if c["product_id"] == data.product_id), None)
        if not candidate or candidate["status"] == "excluded" or candidate["quantity"] is None:
            raise HTTPException(422, "Выберите совместимое решение с рассчитанным парком.")
        quantity, name = candidate["quantity"], candidate["name"]
        equipment = candidate["equipment"]["inputs"]
        parameters = project.parameters
    context = selection["context"]
    if not equipment:
        equipment = EquipmentInput(peak_rate=context["daily_demand"] / context["hours_per_day"] * context["peak_factor"]).model_dump()
    return {"name": name, "quantity": quantity, "candidate": candidate, "context": context,
            "selection_options": selection["options"], "parameters": parameters, "equipment": equipment,
            "source_run_id": str(data.economics_run_id) if data.economics_run_id else None,
            "scenario_index": data.scenario_index, "project_name": project.name}


@router.post("/{project_id}/simulations", summary="Рассчитать имитацию выбранного сценария; при save=true сохранить")
async def calculate_simulation(project_id: uuid.UUID, data: SimulationRequest, db: DbSession, user: OptionalUser):
    if data.save and user is None:
        raise HTTPException(401, "Войдите, чтобы сохранить имитацию.")
    project = await visible_project(db, project_id, user, write=data.save)
    if project.updated_at != data.project_updated_at:
        raise HTTPException(409, "Проект изменён. Обновите страницу перед расчётом имитации.")
    snapshot = await simulation_snapshot(db, project, data)
    started = perf_counter()
    try:
        result = await run_in_threadpool(simulate, snapshot, data.options)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    now = datetime.now(UTC)
    run_id = None
    if data.save:
        run = CalculationRun(project_id=project.id, calc_type=CalculationType.SIMULATION,
            status=CalculationStatus.SUCCEEDED, model_version=VERSION,
            inputs_snapshot={**snapshot, "options": data.options.model_dump()},
            results=result, created_by_id=user.id, finished_at=now,
            duration_ms=round((perf_counter() - started) * 1000))
        db.add(run)
        await db.commit()
        run_id = str(run.id)
    return {"id": run_id, "created_at": now.isoformat(), "stale": snapshot["parameters"] != project.parameters,
            "inputs": snapshot, "results": result}


@router.get("/{project_id}/simulations", summary="Последние 20 сохранённых имитаций")
async def simulations(project_id: uuid.UUID, db: DbSession, user: OptionalUser):
    project = await visible_project(db, project_id, user)
    # Do not load potentially large robot timelines for the history menu.
    runs = (await db.execute(select(CalculationRun.id, CalculationRun.created_at,
        CalculationRun.results["name"].as_string().label("name"),
        CalculationRun.inputs_snapshot["parameters"].label("parameters"))
        .where(CalculationRun.project_id == project.id,
        CalculationRun.calc_type == CalculationType.SIMULATION, CalculationRun.status == CalculationStatus.SUCCEEDED)
        .order_by(CalculationRun.created_at.desc()).limit(20))).all()
    return [{"id": str(r.id), "created_at": r.created_at, "name": r.name,
             "stale": r.parameters != project.parameters} for r in runs]


@router.get("/{project_id}/simulations/{run_id}", summary="Сохранённые входы, KPI и траектории для воспроизведения и экспорта")
async def get_simulation(project_id: uuid.UUID, run_id: uuid.UUID, db: DbSession, user: OptionalUser):
    project = await visible_project(db, project_id, user)
    run = await db.scalar(select(CalculationRun).where(CalculationRun.id == run_id,
        CalculationRun.project_id == project.id, CalculationRun.calc_type == CalculationType.SIMULATION,
        CalculationRun.status == CalculationStatus.SUCCEEDED))
    if run is None:
        raise HTTPException(404, "Имитация не найдена.")
    return {"id": str(run.id), "created_at": run.created_at, "inputs": run.inputs_snapshot,
            "results": run.results, "stale": run.inputs_snapshot["parameters"] != project.parameters}

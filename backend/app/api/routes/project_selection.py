import uuid
import math
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.api.routes.projects import visible_project
from app.models import CalculationRun, Scenario, ScenarioItem, CalculationOverride
from app.models.enums import CalculationStatus, CalculationType, ScenarioKind
from app.schemas.selection import SelectionInput, SaveProjectEconomics
from app.services.catalog_query import load_entries, load_hierarchy
from app.services.catalog_view import mandatory_specs
from app.services.economics import calculate
from app.services.economics_reports import sensitivity, workbook_report
from app.schemas.economics import EconomicsInput
from app.services.selection import VERSION, FORMULA, demand_context, rank_candidate

router = APIRouter(prefix="/projects", tags=["Project selection"])


async def select_for_project(db, project, options):
    hierarchy = await load_hierarchy(db)
    facility = next((f for f in hierarchy.facilities if f.id == project.facility_type_id), None)
    process = next((p for p in facility.processes if p.id == options.process_id), None) if facility else None
    if process is None:
        raise HTTPException(422, "Процесс не относится к типу объекта.")
    entries = await load_entries(db, None, hierarchy, await mandatory_specs(db))
    context = demand_context(facility.code, process.code, project.parameters, options)
    candidates = [rank_candidate(e, facility.code, process.code, project.parameters, options, context)
                  for e in entries if process.id in e.processes]
    candidates.sort(key=lambda c: (c["status"] == "excluded", -c["score"], c["name"]))
    return {"model_version": VERSION, "formula": FORMULA, "context": context,
            "process": {"id": process.id, "name": process.name}, "options": options.model_dump(mode="json"),
            "project_updated_at": project.updated_at.isoformat(), "parameters": project.parameters, "candidates": candidates}


@router.post("/{project_id}/selection")
async def selection(project_id: uuid.UUID, data: SelectionInput, db: DbSession, user: OptionalUser):
    return await select_for_project(db, await visible_project(db, project_id, user), data)


@router.get("/{project_id}/calculations")
async def history(project_id: uuid.UUID, db: DbSession, user: OptionalUser):
    project = await visible_project(db, project_id, user)
    runs = (await db.scalars(select(CalculationRun).where(
        CalculationRun.project_id == project_id, CalculationRun.scenario_id.is_(None),
        CalculationRun.calc_type == CalculationType.ECONOMICS
    ).order_by(CalculationRun.created_at.desc()).limit(50))).all()
    return [{"id": str(r.id), "created_at": r.created_at, "inputs": r.inputs_snapshot,
             "results": r.results, "stale": r.inputs_snapshot.get("parameters") != project.parameters} for r in runs]


@router.get("/{project_id}/calculations/{run_id}/export.xlsx")
async def export_saved(project_id: uuid.UUID, run_id: uuid.UUID, db: DbSession, user: OptionalUser):
    project = await visible_project(db, project_id, user)
    run = await db.scalar(select(CalculationRun).where(CalculationRun.id == run_id,
        CalculationRun.project_id == project_id, CalculationRun.scenario_id.is_(None),
        CalculationRun.calc_type == CalculationType.ECONOMICS, CalculationRun.status == CalculationStatus.SUCCEEDED))
    if not run or not run.results:
        raise HTTPException(404, "Расчёт не найден.")
    inputs = EconomicsInput.model_validate(run.inputs_snapshot["economics"])
    analysis = sensitivity(inputs, 20) if run.model_version == calculate(inputs).model_version else None
    content = workbook_report(run.results, analysis,
        {"project": project.name, "run_id": str(run.id), "created_at": run.created_at.isoformat(), **run.inputs_snapshot}, project.name)
    return Response(content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="project-{run.id}.xlsx"'})


@router.post("/{project_id}/economics", status_code=201)
async def save_economics(project_id: uuid.UUID, data: SaveProjectEconomics, db: DbSession, user: CurrentUser):
    project = await visible_project(db, project_id, user, write=True)
    if project.updated_at != data.project_updated_at:
        raise HTTPException(409, "Проект изменён. Обновите страницу и выполните подбор заново.")
    if len(data.bindings) != len(data.inputs.scenarios):
        raise HTTPException(422, "Каждому сценарию требуется решение.")
    selection = await select_for_project(db, project, data.selection)
    if not selection["context"]["hours_per_day"] or not math.isclose(data.inputs.hours_per_day, selection["context"]["hours_per_day"]):
        raise HTTPException(422, "Режим работы в экономике должен совпадать с расчётом парка. Измените его в подборе.")
    candidates = {c["product_id"]: c for c in selection["candidates"]}
    seen = set()
    for binding, scenario in zip(data.bindings, data.inputs.scenarios):
        c = candidates.get(binding.product_id)
        if not c or c["status"] == "excluded" or c["quantity"] is None:
            raise HTTPException(422, "Решение исключено или недостаточно данных для расчёта парка.")
        if c["status"] == "needs_review" and not data.accept_assumptions:
            raise HTTPException(422, "Подтвердите допущения и необходимость проверки ограничений.")
        if c["quantity"] != scenario.quantity and len(binding.quantity_reason) < 3:
            raise HTTPException(422, "Обоснуйте изменение рассчитанного количества роботов.")
        key = (binding.product_id, scenario.mode)
        if key in seen:
            raise HTTPException(422, "Повторяющиеся сценарии одного решения.")
        seen.add(key)
    result = calculate(data.inputs).model_dump(mode="json")
    selection["candidates"] = [c for c in selection["candidates"] if c["product_id"] in {b.product_id for b in data.bindings}]
    snapshot = {"parameters": project.parameters, "project_updated_at": project.updated_at.isoformat(),
                "economics": data.inputs.model_dump(mode="json"), "selection": selection,
                "bindings": [b.model_dump() for b in data.bindings], "accept_assumptions": data.accept_assumptions}
    now = datetime.now(UTC)
    def run(scenario_id, results):
        return CalculationRun(project_id=project.id, scenario_id=scenario_id, calc_type=CalculationType.ECONOMICS,
            status=CalculationStatus.SUCCEEDED, model_version=result["model_version"], inputs_snapshot=snapshot,
            normatives_snapshot={"selection_model": VERSION, "formula": FORMULA}, results=results,
            created_by_id=user.id, finished_at=now)
    master = run(None, result)
    db.add(master)
    baseline = next((s for s in project.scenarios if s.kind == ScenarioKind.BASELINE), None)
    if baseline is None:
        baseline = Scenario(project_id=project.id, name="Без роботизации", kind=ScenarioKind.BASELINE, items=[])
        project.scenarios.append(baseline)
    baseline.assumptions = {"inputs": data.inputs.model_dump(mode="json", exclude={"scenarios"})}
    await db.flush()
    db.add(run(baseline.id, {"baseline_annual_opex": result["baseline_annual_opex"], "baseline_tco": result["baseline_tco"]}))
    for index, (binding, inputs) in enumerate(zip(data.bindings, data.inputs.scenarios)):
        c = candidates[binding.product_id]
        existing = next((s for s in project.scenarios if s.kind.value == inputs.mode
            and s.assumptions.get("product_id") == binding.product_id
            and s.assumptions.get("process_id") == data.selection.process_id), None)
        if existing is None:
            existing = next((s for s in project.scenarios if s.kind.value == inputs.mode and not s.items and not s.assumptions), None)
        if existing is None:
            existing = Scenario(project_id=project.id, kind=ScenarioKind(inputs.mode), items=[], sort_order=len(project.scenarios))
            project.scenarios.append(existing)
        existing.name = inputs.name[:200]
        existing.assumptions = {"product_id": binding.product_id, "process_id": data.selection.process_id,
                               "inputs": inputs.model_dump(mode="json"), "selection": selection["options"]}
        manual = inputs.quantity != c["quantity"]
        existing.items = [ScenarioItem(product_id=binding.product_id, process_id=data.selection.process_id,
            quantity_calculated=c["quantity"], quantity_manual=inputs.quantity if manual else None,
            warning="\n".join(c["missing"]), notes=binding.quantity_reason)]
        await db.flush()
        if manual:
            db.add(CalculationOverride(scenario_id=existing.id, key="quantity", calculated_value=c["quantity"],
                manual_value=inputs.quantity, reason=binding.quantity_reason, user_id=user.id))
        db.add(run(existing.id, {**result, "results": [result["results"][index]]}))
    project.updated_at = now
    await db.commit()
    return {"id": str(master.id), "project_updated_at": now.isoformat(), "results": result}

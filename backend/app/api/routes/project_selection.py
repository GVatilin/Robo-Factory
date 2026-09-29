import uuid
import math
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, Request
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.api.routes.projects import visible_project, definitions
from app.services.projects import validate_parameters
from app.models import CalculationRun, Scenario, ScenarioItem, CalculationOverride
from app.models.enums import CalculationStatus, CalculationType, ScenarioKind
from app.schemas.selection import SelectionInput, SaveProjectEconomics, SelectionDefaultsInput
from app.services.catalog_query import load_entries, load_hierarchy
from app.services.catalog_view import mandatory_specs
from app.services.economics import calculate
from app.services.economics_reports import sensitivity, workbook_report
from app.schemas.economics import EconomicsInput
from app.schemas.equipment import EquipmentInput
from app.services.selection import FORMULA, RANKING_WEIGHTS, STATUS_ORDER, VERSION, demand_context, rank_candidate

router = APIRouter(prefix="/projects", tags=["Project selection"])


async def select_for_project(db, project, options):
    defs = await definitions(db, project.facility_type_id)
    if not defs:
        raise HTTPException(422, "Сначала заполните справочник параметров объекта.")
    validate_parameters(project.parameters, defs, require_complete=True)
    hierarchy = await load_hierarchy(db)
    facility = next((f for f in hierarchy.facilities if f.id == project.facility_type_id), None)
    process = next((p for p in facility.processes if p.id == options.process_id), None) if facility else None
    if process is None:
        raise HTTPException(422, "Процесс не относится к типу объекта.")
    entries = await load_entries(db, None, hierarchy, await mandatory_specs(db))
    context = demand_context(facility.code, process.code, project.parameters, options)
    candidates = [rank_candidate(e, facility.code, process.code, project.parameters, options, context)
                  for e in entries if process.id in e.processes]
    candidates.sort(key=lambda c: (STATUS_ORDER[c["status"]], -c["score"], c["name"].casefold(), c["product_id"]))
    from app.services.selection_defaults import capacity_example
    for candidate in candidates:
        candidate["capacity_example"] = capacity_example(candidate["unit"]).model_dump()
    return {"model_version": VERSION, "formula": FORMULA, "context": context,
            "ranking_weights": RANKING_WEIGHTS,
            "process": {"id": process.id, "name": process.name, "code": process.code}, "options": options.model_dump(mode="json"),
            "project_updated_at": project.updated_at.isoformat(), "parameters": project.parameters, "candidates": candidates}


@router.post("/{project_id}/selection")
async def selection(project_id: uuid.UUID, data: SelectionInput, db: DbSession, user: OptionalUser):
    return await select_for_project(db, await visible_project(db, project_id, user), data)


@router.get("/ai/status")
async def ai_status(user: CurrentUser):
    from app.services.ai_recommendation import configured, TIMEOUT_SECONDS
    return {"configured": configured(), "timeout_seconds": TIMEOUT_SECONDS}


@router.post("/{project_id}/selection/defaults")
async def selection_defaults(project_id: uuid.UUID, data: SelectionDefaultsInput, db: DbSession, user: OptionalUser):
    from app.services.selection_defaults import fill_workload, capacity_example
    project = await visible_project(db, project_id, user)
    initial = await select_for_project(db, project, data.selection)
    options = fill_workload(data.selection, initial["context"])
    requested = set(data.product_ids)
    eligible = [c for c in initial["candidates"] if c["status"] != "excluded" and (not requested or c["product_id"] in requested)][:6]
    retained_ids = {c["product_id"] for c in eligible}
    # Limit editable overrides while retaining the existing values of chosen robots.
    options.throughput_overrides = {k: v for k, v in options.throughput_overrides.items() if k in retained_ids}
    for candidate in eligible:
        if not candidate["throughput"]:
            options.throughput_overrides[candidate["product_id"]] = capacity_example(candidate["unit"])
    return await select_for_project(db, project, options)


@router.post("/{project_id}/recommendation")
async def ai_recommendation(project_id: uuid.UUID, data: SaveProjectEconomics, db: DbSession, user: CurrentUser):
    import hashlib
    import json
    from app.services.ai_recommendation import recommend
    from app.services import audit
    from app.models import Product
    from app.services.products import PRODUCT_DETAIL_OPTIONS
    project = await visible_project(db, project_id, user)
    if project.updated_at != data.project_updated_at:
        raise HTTPException(409, "Проект изменён. Повторите подбор перед запросом GPT.")
    if len(data.inputs.scenarios) < 2 or len(data.bindings) != len(data.inputs.scenarios):
        raise HTTPException(422, "Для рекомендации нужны минимум два рассчитанных варианта и их решения.")
    selected = await select_for_project(db, project, data.selection)
    candidates = {c["product_id"]: c for c in selected["candidates"]}
    if not selected["context"]["hours_per_day"] or not math.isclose(data.inputs.hours_per_day, selected["context"]["hours_per_day"]):
        raise HTTPException(422, "Режим экономики отличается от подбора. Пересчитайте варианты.")
    if len({(b.product_id, s.mode) for b, s in zip(data.bindings, data.inputs.scenarios)}) != len(data.bindings):
        raise HTTPException(422, "Выберите разные варианты для рекомендации.")
    for binding, scenario in zip(data.bindings, data.inputs.scenarios):
        candidate = candidates.get(binding.product_id)
        if not candidate:
            raise HTTPException(422, f"Решение {binding.product_id} отсутствует в подборе выбранного процесса. Повторите подбор.")
        if candidate["status"] == "excluded":
            raise HTTPException(422, f"{candidate['name']}: решение исключено. Причины: {'; '.join(candidate['excluded'])}. Выберите другой вариант.")
        if candidate["quantity"] is None:
            details = "; ".join(selected["context"]["missing"] + [m for m in candidate["missing"] if "производительност" in m.lower()])
            raise HTTPException(422, f"{candidate['name']}: количество роботов ещё не рассчитано. {details} Откройте «Решения» → «Заполнить допущения и рассчитать парк», затем пересчитайте экономику.")
        if scenario.quantity != candidate["quantity"] and len(binding.quantity_reason) < 3:
            raise HTTPException(422, "Обоснуйте изменение количества роботов перед запросом GPT.")
        scenario.fleet_unrounded = (candidate.get("calculation") or {}).get("unrounded_quantity") if scenario.quantity == candidate["quantity"] else scenario.quantity
        scenario.equipment = EquipmentInput.model_validate(candidate["equipment"]["inputs"])
    # All technical ranking results are retained; detailed sources are needed for the compared products.
    compared_ids = {binding.product_id for binding in data.bindings}
    products = (await db.scalars(select(Product).where(Product.id.in_(compared_ids)).options(*PRODUCT_DETAIL_OPTIONS))).all()
    product_data = [{"id": p.id, "name": p.name, "purpose": p.purpose, "limitations": p.limitations,
        "offers": [{"model": o.acquisition_model, "currency": o.currency, "vat_included": o.price_includes_vat,
                    "equipment_price": o.equipment_price, "software": o.software_price, "integration": o.implementation_price,
                    "annual_service": o.annual_service_cost, "monthly_fee": o.monthly_fee, "terms": o.terms,
                    "included_services": o.included_services, "confirmed": o.is_confirmed, "date": o.valid_from,
                    "source": o.source.url if o.source else None} for o in p.offers],
        "sources": [{"url": s.url, "title": s.title, "type": s.source_type, "date": s.retrieved_at} for s in p.sources],
        "specs": [{"name": s.definition.name, "unit": s.unit or s.definition.unit,
                   "value": s.value_numeric, "maximum": s.value_numeric_max, "text": s.value_text,
                   "boolean": s.value_bool, "date": s.retrieved_at, "assumption": s.is_assumption, "note": s.note,
                   "confirmed": s.is_confirmed, "source": s.source.url if s.source else None} for s in p.spec_values]} for p in products]
    result = calculate(data.inputs).model_dump(mode="json")
    ai_selection = {**selected, "candidates": [c for c in selected["candidates"] if c["product_id"] in compared_ids]}
    analysis = sensitivity(data.inputs, 20)
    # Do not repeat full cashflows, equipment plans and risk paragraphs in every sensitivity cell.
    metrics = ("name", "capex", "annual_opex", "annual_effect", "net_effect", "tco", "simple_payback_years", "roi_percent")
    for row in analysis["rows"]:
        row["results"] = [{key: r[key] for key in metrics if key in r} for r in row["results"]]
    payload = {"project": {"type_id": project.facility_type_id, "parameters": project.parameters},
        "selection": ai_selection, "products": product_data, "economics": result,
        "catalog_overview": [{key: c[key] for key in ("product_id", "name", "status", "score", "quantity", "excluded")} for c in selected["candidates"]],
        "bindings": [b.model_dump() for b in data.bindings], "sensitivity": analysis}
    advice = await recommend(payload, str(user.id))
    audit.record(db, user, "project_recommendation", project.id, "create", {
        "advice": advice, "project_updated_at": project.updated_at.isoformat(),
        "input_hash": hashlib.sha256(json.dumps(payload, default=str, sort_keys=True).encode()).hexdigest(),
        "economics": data.inputs.model_dump(mode="json"), "bindings": [b.model_dump() for b in data.bindings]})
    await db.commit()
    return advice


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
@router.get("/{project_id}/calculations/{run_id}/export.pdf")
async def export_saved(project_id: uuid.UUID, run_id: uuid.UUID, request: Request, db: DbSession, user: OptionalUser):
    project = await visible_project(db, project_id, user)
    run = await db.scalar(select(CalculationRun).where(CalculationRun.id == run_id,
        CalculationRun.project_id == project_id, CalculationRun.scenario_id.is_(None),
        CalculationRun.calc_type == CalculationType.ECONOMICS, CalculationRun.status == CalculationStatus.SUCCEEDED))
    if not run or not run.results:
        raise HTTPException(404, "Расчёт не найден.")
    inputs = EconomicsInput.model_validate(run.inputs_snapshot["economics"])
    analysis = sensitivity(inputs, 20) if run.model_version == calculate(inputs).model_version else None
    if request.url.path.endswith(".pdf"):
        from app.services.economics_pdf import pdf_report
        content = await run_in_threadpool(pdf_report, run.results, analysis, run.inputs_snapshot, project.name)
        return Response(content, media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="project-{run.id}.pdf"'})
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
    if len(data.inputs.scenarios) < 2:
        raise HTTPException(422, "Добавьте два варианта роботизации для сравнения с базовым процессом.")
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
        expected_equipment = EquipmentInput.model_validate(c["equipment"]["inputs"])
        if scenario.equipment is not None and scenario.equipment != expected_equipment:
            raise HTTPException(422, "Параметры вспомогательного оборудования изменились. Повторите подбор и расчёт экономики.")
        scenario.equipment = expected_equipment
        scenario.fleet_unrounded = (c.get("calculation") or {}).get("unrounded_quantity") if scenario.quantity == c["quantity"] else scenario.quantity
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
            normatives_snapshot={"selection_model": VERSION, "formula": FORMULA,
                                 "ranking_weights": RANKING_WEIGHTS}, results=results,
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
        scalar_values = {**{f"common.{key}": value for key, value in data.inputs.model_dump(exclude={"scenarios"}).items() if isinstance(value, (int, float))},
                         **{f"product.{binding.product_id}.{key}": value for key, value in inputs.model_dump().items() if isinstance(value, (int, float)) or value is None}}
        for key, before in data.inputs.automatic_values.items():
            if key in scalar_values and scalar_values[key] != before:
                # Service included in RaaS is an explicit contract convention, not a user override.
                if inputs.mode == "raas" and key.endswith("annual_service_per_robot"):
                    continue
                if len(data.inputs.adjustment_reason.strip()) < 3:
                    raise HTTPException(422, "Обоснуйте изменения автоматически заполненных экономических данных.")
                db.add(CalculationOverride(scenario_id=existing.id, key=key, calculated_value=before,
                    manual_value=scalar_values[key], reason=data.inputs.adjustment_reason, user_id=user.id))
        if manual:
            db.add(CalculationOverride(scenario_id=existing.id, key="quantity", calculated_value=c["quantity"],
                manual_value=inputs.quantity, reason=binding.quantity_reason, user_id=user.id))
        db.add(run(existing.id, {**result, "results": [result["results"][index]]}))
    project.updated_at = now
    await db.commit()
    return {"id": str(master.id), "project_updated_at": now.isoformat(), "results": result}

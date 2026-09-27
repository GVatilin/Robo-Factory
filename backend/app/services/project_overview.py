"""Сводка проектов и сохранённых сценариев без пересчёта исторических результатов."""
import json
from collections import defaultdict

from sqlalchemy import func, select

from app.models import CalculationRun, ParameterDefinition, Scenario
from app.models.enums import CalculationStatus, CalculationType, ScenarioKind
from app.schemas.projects import ProjectSummary
from app.services.projects import missing_required


async def project_summaries(db, projects):
    if not projects:
        return []
    ids = [p.id for p in projects]
    definitions = (await db.scalars(select(ParameterDefinition).where(
        ParameterDefinition.facility_type_id.in_({p.facility_type_id for p in projects}),
        ParameterDefinition.is_required.is_(True)))).all()
    by_facility = defaultdict(list)
    for definition in definitions:
        by_facility[definition.facility_type_id].append(definition)
    common = [CalculationRun.project_id.in_(ids), CalculationRun.calc_type == CalculationType.ECONOMICS,
              CalculationRun.status == CalculationStatus.SUCCEEDED]
    runs = dict((await db.execute(select(CalculationRun.project_id, func.count()).where(
        *common, CalculationRun.scenario_id.is_(None)).group_by(CalculationRun.project_id))).all())
    counts = dict((await db.execute(select(CalculationRun.project_id, func.count(func.distinct(CalculationRun.scenario_id)))
        .join(Scenario, Scenario.id == CalculationRun.scenario_id).where(*common, Scenario.kind != ScenarioKind.BASELINE)
        .group_by(CalculationRun.project_id))).all())
    result = []
    for project in projects:
        required = by_facility[project.facility_type_id]
        data = ProjectSummary.model_validate(project).model_dump()
        data.update(required_total=len(required), required_filled=len(required)-len(missing_required(project.parameters, required)),
                    calculated_scenarios=counts.get(project.id, 0), calculation_count=runs.get(project.id, 0))
        result.append(ProjectSummary(**data))
    return result


async def scenario_overview(db, project):
    # DISTINCT ON берёт последний успешный запуск каждого сценария, сохраняя его снимок.
    rows = (await db.execute(select(CalculationRun.scenario_id, CalculationRun.id,
        CalculationRun.created_at, CalculationRun.inputs_snapshot, CalculationRun.results)
        .where(CalculationRun.project_id == project.id, CalculationRun.scenario_id.is_not(None),
               CalculationRun.calc_type == CalculationType.ECONOMICS, CalculationRun.status == CalculationStatus.SUCCEEDED)
        .distinct(CalculationRun.scenario_id)
        .order_by(CalculationRun.scenario_id, CalculationRun.created_at.desc(), CalculationRun.id.desc()))).all()
    latest = {row.scenario_id: row for row in rows}
    scenarios, groups = [], {}
    for scenario in project.scenarios:
        row = latest.get(scenario.id)
        result = row.results.get("results", [None])[0] if row and row.results and row.results.get("results") else None
        item = {"id": str(scenario.id), "name": scenario.name, "kind": scenario.kind,
                "quantity": sum(i.quantity_manual if i.quantity_manual is not None else i.quantity_calculated or 0 for i in scenario.items),
                "product_names": [i.product.name for i in scenario.items], "has_calculation": row is not None,
                "latest_result": result, "stale": bool(row and row.inputs_snapshot.get("parameters") != project.parameters)}
        scenarios.append(item)
        if not row or not result:
            continue
        snapshot = row.inputs_snapshot
        economics = snapshot.get("economics", {})
        common = {k: v for k, v in economics.items() if k != "scenarios"}
        process = snapshot.get("selection", {}).get("process", {})
        key = json.dumps({"common": common, "parameters": snapshot.get("parameters"), "process_id": process.get("id")}, sort_keys=True, ensure_ascii=False)
        if key not in groups:
            groups[key] = {"process_name": process.get("name", "Процесс"), "common": common,
                "baseline_annual_opex": row.results["baseline_annual_opex"], "baseline_tco": row.results["baseline_tco"],
                "stale": item["stale"], "scenarios": []}
        groups[key]["scenarios"].append({**item, "calculated_at": row.created_at.isoformat()})
    return scenarios, list(groups.values())

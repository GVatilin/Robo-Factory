"""Демо-проекты на базовых значениях датасета организатора — для гостевого сценария (п. 2.1.1 ТЗ)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import FacilityType, Project, Scenario
from app.models.enums import ScenarioKind, ValueOrigin

DEFAULT_SCENARIOS: list[tuple[str, ScenarioKind, str]] = [
    ("Текущий процесс", ScenarioKind.BASELINE, "Базовый сценарий без роботизации — точка отсчёта для сравнения."),
    ("Покупка оборудования", ScenarioKind.PURCHASE, "Роботизация за счёт собственных средств (CAPEX)."),
    ("Роботы как услуга (RaaS)", ScenarioKind.RAAS, "Аренда роботов с ежемесячным платежом (OPEX)."),
]


def default_scenarios() -> list[Scenario]:
    return [
        Scenario(name=name, kind=kind, description=description, sort_order=index)
        for index, (name, kind, description) in enumerate(DEFAULT_SCENARIOS)
    ]


async def ensure_demo_projects(session: AsyncSession) -> int:
    """Создаёт по демо-проекту на каждый тип объекта с загруженными параметрами. Возвращает число созданных."""
    facilities = (
        await session.scalars(select(FacilityType).options(selectinload(FacilityType.parameter_definitions)))
    ).all()
    created = 0
    for facility in facilities:
        if not facility.parameter_definitions:
            continue
        exists = await session.scalar(
            select(Project.id).where(Project.is_demo.is_(True), Project.facility_type_id == facility.id)
        )
        if exists:
            continue
        parameters = {d.code: d.default_value for d in facility.parameter_definitions if d.default_value is not None}
        session.add(
            Project(
                facility_type_id=facility.id,
                name=f"Демо: {facility.name.lower()}",
                description="Демонстрационный проект на базовых значениях датасета организатора.",
                is_demo=True,
                parameters=parameters,
                parameter_origins={code: ValueOrigin.DEFAULT.value for code in parameters},
                scenarios=default_scenarios(),
            )
        )
        created += 1
    await session.flush()
    return created

"""Additive definitions for the minimum object inputs in specification §3.2.1."""
from datetime import UTC, datetime

from sqlalchemy import select
from app.models import DataSource, FacilityType, ParameterDefinition, Project
from app.models.enums import SourceType

# Defaults are explicit team assumptions; users can replace them with actual site data.
ADDITIONS = {
    "warehouse": [
        ("work_zones", "Рабочие зоны склада", "string", None, True, "Укажите зоны приёмки, хранения, комплектации и отгрузки."),
        ("available_area_m2", "Свободная площадь для размещения оборудования", "number", "м²", True, "Доступная площадь под зарядки, буферы и оборудование."),
        ("layout_constraints", "Ограничения планировки", "string", None, True, "Колонны, пороги, уклоны, узкие места и запретные зоны; если нет — укажите это."),
    ],
    "airport": [
        ("operation_type", "Тип роботизируемой операции", "enum", None, True, "Выберите основной процесс проекта."),
        ("operation_zone", "Зона выполнения операции", "string", None, True, "Например: багажный зал терминала или перрон."),
        ("baggage_dimensions_mm", "Габариты перемещаемого объекта (Д×Ш×В)", "string", "мм", True, "Три размера в миллиметрах, например 800×500×350."),
        ("operation_environment", "Закрытые и открытые зоны", "enum", None, True, "Где проходит маршрут оборудования."),
    ],
    "medical": [
        ("access_restrictions", "Ограничения доступа и безопасности", "string", None, True, "Укажите режимные/стерильные зоны, правила прохода и совместного движения с людьми."),
    ],
}
ENUMS = {"operation_type": ["Перевозка багажа", "Перевозка грузов", "Уборка", "Доставка питания", "Другая операция"],
         "operation_environment": ["Внутри здания", "На открытом воздухе", "Внутри и снаружи"]}
DEMO_EXAMPLES = {
    "warehouse": {"work_zones": "Приёмка, хранение, комплектация, отгрузка", "available_area_m2": 100,
                  "layout_constraints": "В демонстрационном примере: ровный пол, без порогов; проходы указаны в параметрах."},
    "airport": {"operation_type": "Перевозка багажа", "operation_zone": "Багажный зал терминала",
                "baggage_dimensions_mm": "800×500×350", "operation_environment": "Внутри здания"},
    "medical": {"access_restrictions": "В демонстрационном примере: доступ по СКУД, раздельные маршруты чистых и загрязнённых грузов."},
}


async def ensure_object_requirements(session):
    source = await session.scalar(select(DataSource).where(DataSource.code == "object_requirements_3_2_1"))
    if source is None:
        source = DataSource(code="object_requirements_3_2_1", title="ТЗ, раздел 3.2.1 — параметры объекта",
                            source_type=SourceType.ORGANIZER, publisher="ФЦ БАС")
        session.add(source)
        await session.flush()
    default_source = await session.scalar(select(DataSource).where(DataSource.code == "object_input_demo_defaults"))
    if default_source is None:
        default_source = DataSource(code="object_input_demo_defaults",
            title="Демонстрационные значения зон и ограничений — допущение команды",
            source_type=SourceType.TEAM_ASSUMPTION, publisher="Команда Robo-Factory",
            notes="Состав полей — п. 3.2.1 ТЗ. Значения для первого расчёта предложены командой; уточняются по данным объекта.")
        session.add(default_source)
        await session.flush()
    default_note = "Демонстрационное допущение команды для первого расчёта. Состав поля — п. 3.2.1 ТЗ. Уточните значение по данным своего объекта."
    facilities = list((await session.scalars(select(FacilityType))).all())
    existing = {(d.facility_type_id, d.code): d for d in (await session.scalars(select(ParameterDefinition))).all()}
    for facility in facilities:
        for index, (code, name, data_type, unit, required, hint) in enumerate(ADDITIONS.get(facility.code, [])):
            default_value = DEMO_EXAMPLES[facility.code][code]
            definition = existing.get((facility.id, code))
            if definition is None:
                session.add(ParameterDefinition(facility_type_id=facility.id, code=code, name=name,
                    section="Зоны и ограничения объекта", data_type=data_type, unit=unit,
                    is_required=required, default_value=default_value, min_value=0 if data_type == "number" else None,
                    max_value=1e9 if data_type == "number" else None, allowed_values=ENUMS.get(code),
                    hint=hint, source_id=default_source.id, source_note=default_note, sort_order=900+index))
            elif definition.default_value is None and definition.source_id == source.id:
                # Upgrade the definitions shipped previously without defaults, preserving custom definitions.
                definition.default_value = default_value
                definition.source_id = default_source.id
                definition.source_note = default_note
        demos = (await session.scalars(select(Project).where(Project.facility_type_id == facility.id, Project.is_demo.is_(True)))).all()
        for project in demos:
            additions = {k: v for k, v in DEMO_EXAMPLES.get(facility.code, {}).items() if k not in project.parameters}
            if additions:
                project.parameters = {**project.parameters, **additions}
                project.parameter_origins = {**project.parameter_origins, **{k: "team_assumption" for k in additions}}
                project.updated_at = datetime.now(UTC)
    await session.flush()

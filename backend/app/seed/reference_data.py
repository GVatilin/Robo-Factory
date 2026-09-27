"""Начальные справочные данные.

Источник каждого значения указан явно: файлы организатора, сайты производителей
или документированное допущение команды (п. 3.5.1 ТЗ: недокументированные коэффициенты запрещены).
"""

from datetime import date

from app.models.enums import SourceType, SpecGroup, ValueDataType

ORGANIZER_FILES_DATE = date(2026, 9, 14)
TEAM_DATE = date(2026, 9, 25)

# code: (название, тип, url, издатель, дата, примечание)
SOURCES: dict[str, tuple[str, SourceType, str | None, str | None, date | None, str | None]] = {
    "organizer_tz": (
        "ТЗ «Платформа подбора роботизированных решений с расчётом экономического эффекта и визуализацией»",
        SourceType.ORGANIZER, None, "ФЦ БАС", ORGANIZER_FILES_DATE, None,
    ),
    "organizer_addendum": (
        "Дополнительные пояснения и допущения к ТЗ", SourceType.ORGANIZER, None, "ФЦ БАС", ORGANIZER_FILES_DATE, None,
    ),
    "organizer_facility_datasets": (
        "Демо-датасеты объектов (Датасеты_хакатон.xlsx): склад, аэропорт, медучреждение",
        SourceType.ORGANIZER, None, "ФЦ БАС", ORGANIZER_FILES_DATE,
        "Базовые значения — демо-расчёт; диапазоны min/max — валидация ввода.",
    ),
    "organizer_solution_examples": (
        "Примеры решений по типам объектов (Примеры_решений_типы_объектов.docx)",
        SourceType.ORGANIZER, None, "ФЦ БАС", ORGANIZER_FILES_DATE,
        "ТТХ типовых решений для склада, аэропорта и медучреждения.",
    ),
    "team_assumption": (
        "Допущение команды", SourceType.TEAM_ASSUMPTION, None, "Команда Robo-Factory", TEAM_DATE,
        "Значение уточняется на этапе экономической модели и подлежит проверке на обследовании объекта.",
    ),
    "tax_code_vat": (
        "Налоговый кодекс РФ, ст. 164 — ставка НДС (редакция с 01.01.2026)",
        SourceType.REGULATION, None, None, TEAM_DATE, "Актуальность ставки проверяется администратором.",
    ),
}

# code, название — отрасли из каталога организатора создаются при импорте; здесь — нужные типам объектов.
INDUSTRIES: list[tuple[str, str, str | None]] = [
    ("transport_logistics", "Транспорт и логистика", "Склады, распределительные центры, аэропорты, логистические хабы."),
    ("healthcare", "Здравоохранение", "Больницы, поликлиники, диагностические центры."),
    ("trade_services", "Торговля и услуги", None),
    ("industry", "Промышленность", None),
]

# code, отрасль, название, описание, иконка, шаблон схемы
FACILITY_TYPES: list[tuple[str, str, str, str, str, str]] = [
    ("warehouse", "transport_logistics", "Склад",
     "Распределительный или фулфилмент-центр: приёмка, хранение, отбор, сортировка и отгрузка.",
     "warehouse", "warehouse_grid"),
    ("airport", "transport_logistics", "Аэропорт",
     "Пассажирский терминал и перрон: багаж, наземное обслуживание, уборка, внутритерминальная логистика.",
     "plane", "airport_terminal"),
    ("medical", "healthcare", "Медицинское учреждение",
     "Многопрофильная больница: доставка питания, белья, медикаментов, проб и вывоз отходов.",
     "hospital", "hospital_floors"),
]

# facility, code, название, типы решений, параметры-драйверы объёма
PROCESSES: list[tuple[str, str, str, list[str], list[str]]] = [
    ("warehouse", "inbound", "Приёмка и размещение",
     ["amr", "fmr", "stacker_robot", "autonomous_forklift", "shuttle"], ["inbound_pallets_per_day", "pallet_weight_kg"]),
    ("warehouse", "internal_transport", "Внутрискладская транспортировка",
     ["amr", "fmr", "tug_robot", "autonomous_forklift"],
     ["inbound_pallets_per_day", "outbound_pallets_per_day", "conveyor_length_m"]),
    ("warehouse", "storage", "Хранение и штабелирование",
     ["smart_storage", "shuttle", "stacker_robot"], ["pallet_positions", "ceiling_height_m", "storage_type"]),
    ("warehouse", "picking", "Отбор и комплектация заказов",
     ["amr", "picking_robot", "smart_storage"],
     ["picking_lines_per_day", "pickers_count", "picker_productivity_lines_h", "picking_route_length_m"]),
    ("warehouse", "sorting", "Сортировка отправлений", ["amr"], ["picking_units_per_day", "unit_weight_kg"]),
    ("warehouse", "outbound", "Отгрузка", ["amr", "fmr", "autonomous_forklift"], ["outbound_pallets_per_day"]),
    ("warehouse", "inventory", "Инвентаризация", ["inventory_robot"], ["pallet_positions", "sku_count"]),
    ("warehouse", "cleaning", "Уборка помещений", ["cleaning_robot"], ["active_area_m2"]),
    ("airport", "baggage", "Транспортировка и сортировка багажа",
     ["amr", "tug_robot"], ["baggage_units_per_day", "baggage_unit_weight_kg", "avg_route_length_m"]),
    ("airport", "ramp_transport", "Буксировка и перевозки на перроне",
     ["tug_robot", "autonomous_truck"], ["daily_flights", "peak_hour_flights", "ground_ops_per_flight"]),
    ("airport", "catering", "Доставка бортового питания", ["autonomous_truck", "amr"], ["catering_meals_per_day"]),
    ("airport", "terminal_logistics", "Внутритерминальная логистика",
     ["amr", "indoor_delivery_robot"], ["internal_cart_trips_per_day", "avg_route_length_m"]),
    ("airport", "cleaning", "Уборка терминала", ["cleaning_robot"], ["robotic_cleaning_area_m2", "cleaning_machines_count"]),
    ("airport", "waste", "Вывоз мусора", ["amr", "tug_robot"], ["waste_containers_per_day"]),
    ("airport", "security", "Патрулирование терминала", ["security_robot"], ["terminal_area_m2"]),
    ("medical", "food", "Доставка питания в отделения",
     ["amr", "indoor_delivery_robot"], ["meal_portions_per_day", "food_cart_weight_kg", "kitchen_to_ward_distance_m"]),
    ("medical", "linen", "Транспортировка белья", ["amr"], ["dirty_linen_kg_per_day", "clean_linen_kg_per_day"]),
    ("medical", "medicines", "Доставка медикаментов и расходников",
     ["amr", "indoor_delivery_robot"], ["medicine_requests_per_day", "consumables_trips_per_day"]),
    ("medical", "lab_samples", "Доставка биоматериалов в лабораторию",
     ["amr", "indoor_delivery_robot"], ["lab_samples_per_day", "sample_delivery_norm_min"]),
    ("medical", "waste", "Вывоз медицинских отходов", ["amr"], ["waste_class_a_kg_per_day", "waste_class_b_kg_per_day"]),
    ("medical", "cleaning", "Уборка и дезинфекция помещений", ["cleaning_robot"], ["total_area_m2"]),
]

# code, название, группа, единица, тип, обязательная (п. 3.3.7 ТЗ), фильтруемая
SPEC_DEFINITIONS: list[tuple[str, str, SpecGroup, str | None, ValueDataType, bool, bool]] = [
    ("payload_kg", "Грузоподъёмность", SpecGroup.TECHNICAL, "кг", ValueDataType.NUMBER, True, True),
    ("length_mm", "Габариты: длина", SpecGroup.TECHNICAL, "мм", ValueDataType.NUMBER, True, True),
    ("width_mm", "Габариты: ширина", SpecGroup.TECHNICAL, "мм", ValueDataType.NUMBER, True, True),
    ("height_mm", "Габариты: высота", SpecGroup.TECHNICAL, "мм", ValueDataType.NUMBER, True, True),
    ("weight_kg", "Масса", SpecGroup.TECHNICAL, "кг", ValueDataType.NUMBER, True, True),
    ("max_speed_mps", "Максимальная скорость", SpecGroup.TECHNICAL, "м/с", ValueDataType.NUMBER, True, True),
    ("throughput", "Производительность", SpecGroup.TECHNICAL, None, ValueDataType.RANGE, True, False),
    ("runtime_h", "Автономность (время работы)", SpecGroup.TECHNICAL, "ч", ValueDataType.RANGE, True, True),
    ("charge_time_h", "Время зарядки", SpecGroup.TECHNICAL, "ч", ValueDataType.NUMBER, False, False),
    ("positioning_accuracy_mm", "Точность позиционирования", SpecGroup.TECHNICAL, "мм", ValueDataType.NUMBER, True, True),
    ("navigation_type", "Тип навигации", SpecGroup.TECHNICAL, None, ValueDataType.STRING, True, True),
    ("operating_temp_c", "Диапазон рабочих температур", SpecGroup.TECHNICAL, "°C", ValueDataType.RANGE, True, True),
    ("operating_conditions", "Допустимые условия эксплуатации", SpecGroup.TECHNICAL, None, ValueDataType.STRING, False, False),
    ("lift_height_mm", "Высота подъёма", SpecGroup.TECHNICAL, "мм", ValueDataType.NUMBER, False, True),
    ("cleaning_width_mm", "Ширина уборки", SpecGroup.TECHNICAL, "мм", ValueDataType.RANGE, False, False),
    ("tank_volume_l", "Объём бака", SpecGroup.TECHNICAL, "л", ValueDataType.NUMBER, False, False),
    ("battery_capacity_kwh", "Ёмкость АКБ", SpecGroup.TECHNICAL, "кВт·ч", ValueDataType.NUMBER, False, False),
    ("range_km", "Запас хода", SpecGroup.TECHNICAL, "км", ValueDataType.RANGE, False, False),
    ("noise_dba", "Уровень шума", SpecGroup.TECHNICAL, "дБА", ValueDataType.NUMBER, False, True),
    ("min_aisle_width_mm", "Минимальная ширина прохода", SpecGroup.INFRASTRUCTURE, "мм", ValueDataType.NUMBER, True, True),
    ("floor_requirements", "Требования к покрытию пола", SpecGroup.INFRASTRUCTURE, None, ValueDataType.STRING, True, False),
    ("charging_infrastructure", "Зарядная инфраструктура", SpecGroup.INFRASTRUCTURE, None, ValueDataType.STRING, True, False),
    ("connectivity", "Требования к связи", SpecGroup.INFRASTRUCTURE, None, ValueDataType.STRING, True, False),
    ("integration", "Интеграция (WMS / ERP / МИС / API)", SpecGroup.INFRASTRUCTURE, None, ValueDataType.STRING, True, False),
    ("service_requirements", "Сервисное обслуживание", SpecGroup.INFRASTRUCTURE, None, ValueDataType.STRING, True, False),
    ("elevator_integration", "Интеграция с лифтами", SpecGroup.INFRASTRUCTURE, None, ValueDataType.BOOLEAN, False, True),
]

# code, название, категория, значение, единица, источник, допущение, описание
NORMATIVES: list[tuple[str, str, str, float, str | None, str, bool, str]] = [
    ("payroll_tax_coef", "Коэффициент начислений на ФОТ", "personnel", 1.302, None, "organizer_facility_datasets", False,
     "Страховые взносы 30,2%: ОПС 22% + ОМС 5,1% + ОСС 2,9% + НСиПЗ 0,2%."),
    ("robot_utilization", "Коэффициент загрузки робота", "robots", 0.80, "доля", "organizer_facility_datasets", False,
     "Типовой KPI AMR 70–85% с учётом зарядки, простоев и ожидания. Принято среднее значение 80%."),
    ("fleet_peak_reserve", "Резерв парка роботов к пиковой нагрузке", "robots", 0.15, "доля", "organizer_facility_datasets", False,
     "Робот рассчитывается на пиковую нагрузку с резервом 15–20%. Принята нижняя граница."),
    ("capex_contingency", "Резерв CAPEX на непредвиденные расходы", "capex", 0.10, "доля", "organizer_facility_datasets", False,
     "CAPEX включает резерв 10% (легенда датасетов организатора)."),
    ("battery_replacement_years", "Периодичность замены АКБ", "opex", 4, "лет", "organizer_facility_datasets", False,
     "Замена АКБ примерно раз в 3–5 лет. Учитывается в TCO как замена основных компонентов."),
    ("vat_rate", "Ставка НДС", "tax", 0.22, "доля", "tax_code_vat", False,
     "Цены каталога указаны с НДС (п. 6 дополнений к ТЗ)."),
    ("delivery_commissioning_share", "Доставка и пусконаладка", "capex", 0.08, "доля от оборудования", "team_assumption", True,
     "Цены каталога не включают доставку и пусконаладку (п. 6 дополнений к ТЗ)."),
    ("integration_share", "Интеграция с WMS / ERP / МИС", "capex", 0.12, "доля от оборудования", "team_assumption", True,
     "Базовая интеграция в ИТ-ландшафт; глубокая интеграция оценивается отдельно."),
    ("infrastructure_share", "Инфраструктура: зарядные станции, разметка, связь", "capex", 0.05, "доля от оборудования",
     "team_assumption", True, "Подготовка объекта к эксплуатации роботов."),
    ("training_share", "Обучение персонала", "capex", 0.02, "доля от оборудования", "team_assumption", True,
     "Обучение операторов и ИТ-персонала."),
    ("annual_service_share", "Годовое сервисное обслуживание", "opex", 0.08, "доля от оборудования в год", "team_assumption", True,
     "Сервисный контракт производителя/интегратора."),
    ("annual_software_share", "Годовые лицензии ПО (управление парком)", "opex", 0.05, "доля от оборудования в год",
     "team_assumption", True, "Лицензии fleet management / WES."),
    ("electricity_price", "Тариф на электроэнергию", "opex", 9.0, "руб./кВт·ч", "team_assumption", True,
     "Средний одноставочный тариф для юридических лиц; уточняется по договору объекта."),
    ("depreciation_years", "Срок полезного использования (линейная амортизация)", "capex", 7, "лет", "team_assumption", True,
     "Линейный метод амортизации (п. 2.2 дополнений к ТЗ). Может переопределяться сроком службы продукта."),
    ("raas_monthly_rate", "Ежемесячный платёж RaaS", "raas", 0.035, "доля от оборудования в месяц", "team_assumption", True,
     "Фиксированная ставка аренды, включающая сервис (п. 2.4 дополнений к ТЗ)."),
    ("raas_contract_months", "Срок контракта RaaS", "raas", 36, "мес.", "team_assumption", True,
     "Базовый срок контракта; условия продления и выкупа задаются в сценарии."),
    ("payback_good_years", "Граница «быстрой» окупаемости", "interpretation", 3, "лет", "organizer_tz", False,
     "Интервалы интерпретации: до 3 лет, 3–5 лет, более 5 лет (п. 3.5.7 ТЗ)."),
    ("payback_acceptable_years", "Граница «приемлемой» окупаемости", "interpretation", 5, "лет", "organizer_tz", False,
     "Интервалы интерпретации: до 3 лет, 3–5 лет, более 5 лет (п. 3.5.7 ТЗ)."),
]

# Вымышленный производитель для демо-учётки вендора: на нём проверяется роль без доступа к реальным компаниям.
DEMO_MANUFACTURER = {
    "name": "Демо Роботикс (демо-вендор)",
    "country": "Россия",
    "region": "Москва",
    "description": "Демонстрационный производитель для проверки роли вендора. Реальной компанией не является.",
}

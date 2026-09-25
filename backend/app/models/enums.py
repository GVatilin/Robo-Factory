from enum import StrEnum


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"
    VENDOR = "vendor"  # дополнительная роль (п. 3.1.1 ТЗ), зарезервирована


class ProductClass(StrEnum):
    """Класс изделия в каталоге организатора (колонка «тип»)."""

    BRS = "brs"  # беспилотная роботизированная система
    BAS = "bas"  # беспилотная авиационная система
    SOFTWARE = "software"


class ReadinessStatus(StrEnum):
    """Статус доступности (колонка «статус»)."""

    OPERATION = "operation"  # серийно / в эксплуатации
    PILOTING = "piloting"  # пилотные внедрения
    RND = "rnd"  # НИОКР


class AcquisitionModel(StrEnum):
    PURCHASE = "purchase"
    LEASE = "lease"
    RAAS = "raas"  # роботы как услуга / аренда


class SourceType(StrEnum):
    ORGANIZER = "organizer"  # файлы организатора хакатона
    MANUFACTURER = "manufacturer"  # официальный сайт производителя
    INTEGRATOR = "integrator"
    PUBLIC_SPEC = "public_spec"  # технический паспорт, публичная спецификация
    MARKETPLACE = "marketplace"
    REVIEW = "review"  # обзоры, СМИ
    CASE_STUDY = "case_study"
    REGULATION = "regulation"  # нормативные документы
    TEAM_ASSUMPTION = "team_assumption"  # документированное допущение команды
    USER_INPUT = "user_input"


class ValueDataType(StrEnum):
    NUMBER = "number"
    INTEGER = "integer"
    STRING = "string"
    BOOLEAN = "boolean"
    ENUM = "enum"
    DIMENSIONS = "dimensions"  # строка вида 1200×800×1600
    RANGE = "range"  # числовой диапазон min…max


class SpecGroup(StrEnum):
    """Группы характеристик по таблице п. 3.3.7 ТЗ."""

    TECHNICAL = "technical"
    INFRASTRUCTURE = "infrastructure"
    ECONOMICS = "economics"
    APPLICABILITY = "applicability"


class DatasetKind(StrEnum):
    CATALOG = "catalog"
    FACILITY_PARAMETERS = "facility_parameters"
    NORMATIVES = "normatives"
    REFERENCE_SPECS = "reference_specs"


class ProjectStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class ValueOrigin(StrEnum):
    DEFAULT = "default"  # значение по умолчанию из справочника
    MANUAL = "manual"  # введено пользователем
    FILE = "file"  # загружено из Excel/CSV


class ScenarioKind(StrEnum):
    BASELINE = "baseline"  # текущий процесс без роботизации
    PURCHASE = "purchase"  # покупка оборудования
    RAAS = "raas"  # роботы как услуга
    LEASE = "lease"
    CUSTOM = "custom"


class ProjectFileKind(StrEnum):
    PARAMETERS_IMPORT = "parameters_import"
    ATTACHMENT = "attachment"
    EXPORT = "export"


class CalculationType(StrEnum):
    SELECTION = "selection"  # подбор решений
    ECONOMICS = "economics"  # расчёт экономики
    SIMULATION = "simulation"  # имитация


class CalculationStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

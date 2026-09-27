"""Русские названия значений перечислений для интерфейса и отчётов."""

from app.models.enums import AcquisitionModel, ProductClass, ReadinessStatus, SourceType, SpecGroup

PRODUCT_CLASS = {
    ProductClass.BRS: "БРС — роботизированная система",
    ProductClass.BAS: "БАС — беспилотная авиационная система",
    ProductClass.SOFTWARE: "Программное обеспечение",
}

READINESS_STATUS = {
    ReadinessStatus.OPERATION: "Серийно, в эксплуатации",
    ReadinessStatus.PILOTING: "Пилотные внедрения",
    ReadinessStatus.RND: "НИОКР",
}

ACQUISITION_MODEL = {
    AcquisitionModel.PURCHASE: "Покупка",
    AcquisitionModel.LEASE: "Лизинг",
    AcquisitionModel.RAAS: "Роботы как услуга (RaaS)",
}

SOURCE_TYPE = {
    SourceType.ORGANIZER: "Файлы организатора",
    SourceType.MANUFACTURER: "Сайт или данные производителя",
    SourceType.INTEGRATOR: "Интегратор",
    SourceType.PUBLIC_SPEC: "Технический паспорт, спецификация",
    SourceType.MARKETPLACE: "Маркетплейс, прайс-лист",
    SourceType.REVIEW: "Обзор, СМИ",
    SourceType.CASE_STUDY: "Материалы реализованного кейса",
    SourceType.REGULATION: "Нормативный документ",
    SourceType.TEAM_ASSUMPTION: "Допущение команды",
    SourceType.USER_INPUT: "Ручной ввод",
}

SPEC_GROUP = {
    SpecGroup.TECHNICAL: "Технические характеристики",
    SpecGroup.INFRASTRUCTURE: "Инфраструктура",
    SpecGroup.ECONOMICS: "Экономика",
    SpecGroup.APPLICABILITY: "Применимость",
}

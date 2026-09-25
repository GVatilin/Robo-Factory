"""Таксономия типов решений: канонические названия и коды.

В каталоге организатора встречаются разные написания одного типа («Робот уборщик» / «Робот-уборщик»,
«Робот-штабелёр» / «Робот-штабелер»). Здесь они сводятся к одному узлу дерева.
Описания типов — по справочнику п. 8 дополнений к ТЗ.
"""

from app.models.enums import ProductClass
from app.utils.text import normalize_spaces, slugify

# (код, название, описание)
CATEGORIES: list[tuple[str, str, str | None]] = [
    ("mobile_robots", "Мобильные роботы",
     "Самоходные платформы для логистических и сервисных операций без непосредственного управления оператором."),
    ("autonomous_ground_vehicles", "Автономные наземные транспортные средства",
     "Беспилотные машины (погрузчики, тягачи, грузовики), автоматически перемещающие грузы."),
    ("stationary_systems", "Стационарные роботизированные системы",
     "Умные системы хранения и сборки заказов на базе многоуровневых стеллажей, шаттлов и манипуляторов."),
    ("manipulators", "Роботы-манипуляторы", None),
    ("mobile_manipulators", "Мобильные манипуляторы", None),
    ("humanoid_robots", "Антропоморфные роботы", None),
    ("marine_robots", "Морские роботы", None),
    ("uas", "БАС", "Беспилотные авиационные системы."),
    ("software", "Программное обеспечение", "ПО для роботизированных систем."),
    ("other", "Другое", None),
]

# (код, название, код категории, описание)
TYPES: list[tuple[str, str, str, str | None]] = [
    ("amr", "AMR", "mobile_robots",
     "Автономный мобильный робот: навигация по датчикам без магнитных лент и рельсов. "
     "Транспортировка паллет, тележек и стеллажей, сортировка посылок."),
    ("fmr", "FMR", "autonomous_ground_vehicles",
     "Автономный вилочный погрузчик или штабелёр: напольное перемещение паллет, работа с ярусами стеллажей."),
    ("stacker_robot", "Робот-штабелер", "mobile_robots",
     "Мобильный робот с вилочным подъёмником для укладки и снятия паллет на разных уровнях."),
    ("tug_robot", "Робот-тягач", "autonomous_ground_vehicles",
     "Автономный транспортный робот, буксирующий тележки, вагонетки и ролл-кейджи."),
    ("autonomous_forklift", "Беспилотный погрузчик", "autonomous_ground_vehicles",
     "Роботизированный погрузчик для работы в одном пространстве с людьми."),
    ("autonomous_truck", "Беспилотный грузовик", "autonomous_ground_vehicles",
     "Беспилотный электрогрузовик для перевозок на закрытых площадках."),
    ("cleaning_robot", "Робот-уборщик", "mobile_robots",
     "Клининговый робот для влажной и сухой уборки помещений по расписанию."),
    ("indoor_delivery_robot", "Робот-доставщик", "mobile_robots",
     "Сервисный робот для доставки внутри здания (питание, медикаменты, пробы)."),
    ("security_robot", "Охранный робот", "mobile_robots", None),
    ("inventory_robot", "Робот-инвентаризатор", "mobile_robots", None),
    ("picking_robot", "Мобильный робот-комплектовщик", "mobile_robots", None),
    ("smart_storage", "Умная система хранения", "stationary_systems",
     "Система кубического хранения класса AutoStore: плотное хранение и роботизированная сборка заказов."),
    ("shuttle", "Шаттл", "stationary_systems",
     "Шаттл-система глубокого хранения паллет в канальных стеллажах."),
]

CATEGORY_ALIASES = {
    "ПО БРС": "software",
    "ПО": "software",
}

TYPE_ALIASES = {
    "робот уборщик": "cleaning_robot",
    "робот-уборщик": "cleaning_robot",
    "робот-штабелёр": "stacker_robot",
    "робот-штабелер": "stacker_robot",
    "беспилотный тягач": "tug_robot",
    "робот-тягач": "tug_robot",
    "робот инвентаризатор": "inventory_robot",
    "робот-инвентаризатор": "inventory_robot",
}

CLASS_DEFAULT_CATEGORY = {
    ProductClass.BAS: "uas",
    ProductClass.SOFTWARE: "software",
    ProductClass.BRS: "other",
}

_CATEGORY_BY_NAME = {name.lower(): code for code, name, _ in CATEGORIES}
_TYPE_BY_NAME = {name.lower(): code for code, name, _, _ in TYPES}


def resolve_category(raw: str | None, product_class: ProductClass) -> tuple[str, str]:
    """Возвращает (код, название) категории для значения колонки «Тип»."""
    name = normalize_spaces(raw)
    if not name:
        code = CLASS_DEFAULT_CATEGORY[product_class]
        return code, next(n for c, n, _ in CATEGORIES if c == code)
    code = CATEGORY_ALIASES.get(name) or _CATEGORY_BY_NAME.get(name.lower())
    if code:
        return code, next(n for c, n, _ in CATEGORIES if c == code)
    return slugify(name), name


def resolve_type(raw: str | None) -> tuple[str, str] | None:
    """Возвращает (код, название) типа решения для значения колонки «Подтип»."""
    name = normalize_spaces(raw)
    if not name:
        return None
    key = name.lower()
    code = TYPE_ALIASES.get(key) or _TYPE_BY_NAME.get(key)
    if code:
        return code, next(n for c, n, _, _ in TYPES if c == code)
    return slugify(name), name[:1].upper() + name[1:]

"""Scene identity and explicit route defaults, saved with the simulation inputs."""
import math

PROFILES = {
    "warehouse": {"label": "Склад", "source_zone": "Приёмка и хранение", "target_zone": "Комплектация и отгрузка", "cargo": "pallet", "route": 50, "speed": 1.0},
    "airport": {"label": "Аэропорт", "source_zone": "Приём багажа", "target_zone": "Сортировка и выдача", "cargo": "baggage", "route": 150, "speed": 1.0},
    "medical": {"label": "Медицинское учреждение", "source_zone": "Служба доставки", "target_zone": "Отделения", "cargo": "medical", "route": 60, "speed": .7},
    "generic": {"label": "Объект", "source_zone": "Выдача заданий", "target_zone": "Выполнение операций", "cargo": "box", "route": 50, "speed": 1.0},
}


def scene_profile(snapshot):
    facility = snapshot.get("facility") or {}
    code = facility.get("code", "generic")
    profile = {"facility_code": code if code in PROFILES else "generic", **PROFILES.get(code, PROFILES["generic"])}
    process = snapshot.get("process") or {}
    profile.update(process_code=process.get("code", ""), process_name=process.get("name", "Выбранный процесс"),
                   robot=snapshot.get("candidate", {}).get("robot_visual") or {})
    if code == "medical":
        labels = {"food": ("Пищеблок", "Доставка питания", "food"), "linen": ("Прачечная", "Бельевые отделений", "linen"),
                  "medicines": ("Аптека", "Посты медсестёр", "medical"), "lab_samples": ("Отделения", "Лаборатория", "medical"),
                  "waste": ("Точки сбора", "Зона обращения с отходами", "waste")}
        if process.get("code") in labels:
            profile["source_zone"], profile["target_zone"], profile["cargo"] = labels[process["code"]]
    if process.get("code") == "cleaning":
        profile.update(source_zone="Сервисная зона", target_zone="Участки уборки", cargo="none")
    elif code == "airport" and process.get("code") != "baggage":
        profile.update(source_zone="Логистический пост", target_zone=process.get("name", "Зона операции"), cargo="box")
    return profile


def default_options(snapshot):
    profile = scene_profile(snapshot)
    params = snapshot.get("parameters") or {}
    process = profile["process_code"]
    keys = (["kitchen_to_ward_distance_m"] if profile["facility_code"] == "medical" and process == "food" else [])
    keys += (["picking_route_length_m"] if process == "picking" else []) + ["avg_route_length_m"]
    route, origin = profile["route"], "допущение команды для типа объекта"
    for key in keys:
        value = params.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 100000:
            route, origin = float(value), f"параметр объекта {key}"
            break
    speed, speed_origin = profile["speed"], "типовая средняя скорость, допущение команды"
    spec = snapshot.get("candidate", {}).get("specs_snapshot", {}).get("max_speed_mps", {})
    maximum = spec.get("value")
    if spec.get("unit") == "м/с" and isinstance(maximum, (int, float)) and math.isfinite(maximum) and maximum > 0 and maximum < speed:
        speed, speed_origin = maximum, "ограничена максимальной скоростью из карточки; среднюю скорость уточнить на объекте"
    return {"route_m": route, "speed_mps": speed,
            "reason": f"{profile['label']}, {profile['process_name']}: маршрут {route:g} м в одну сторону ({origin}); скорость {speed:g} м/с ({speed_origin})."}

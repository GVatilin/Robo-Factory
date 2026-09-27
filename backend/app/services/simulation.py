"""Deterministic event simulation: finite fleet, FIFO demand, shared stations/chargers.

One cycle handles a batch in the same units as the selection throughput. No RNG,
network, or catalogue reads: saved inputs reproduce exactly the same timeline.
"""
from collections import deque
import heapq
import math
from app.schemas.equipment import EquipmentInput
from app.schemas.simulation import SimulationOptions
from app.services.equipment import equipment_plan

VERSION = "simulation-1.0"
MAX_JOBS = 12000
MAX_ROBOTS = 200


def simulate(snapshot: dict, options: SimulationOptions) -> dict:
    context, candidate = snapshot["context"], snapshot["candidate"]
    n = snapshot["quantity"]
    if not 1 <= n <= MAX_ROBOTS:
        raise ValueError("Имитация поддерживает от 1 до 200 роботов. Уменьшите парк для демонстрации.")
    if context.get("missing") or not candidate.get("throughput") or candidate.get("status") == "excluded":
        raise ValueError("Недостаточно данных или решение исключено. Уточните подбор.")
    equipment = EquipmentInput.model_validate(snapshot["equipment"])
    plan = equipment_plan(n, equipment)
    horizon = context["hours_per_day"] * 3600
    rate = context["daily_demand"] / context["hours_per_day"] * context["peak_factor"]
    batch = equipment.operations_per_cycle
    # Stress test: the selected peak demand persists for the whole shift.
    target = rate * horizon / 3600
    jobs = math.ceil(target / batch)
    if jobs > MAX_JOBS:
        raise ValueError("Более 12 000 циклов за смену. Увеличьте число единиц за цикл в подборе и пересчитайте сценарий.")
    travel = options.route_m / options.speed_mps
    processing = equipment.handling_seconds
    preparation = max(0., 3600 * batch / candidate["throughput"] - 2 * travel - processing)
    active_cycle = preparation + 2 * travel + processing
    if active_cycle > equipment.runtime_hours * 3600:
        raise ValueError("Одного заряда недостаточно для цикла. Уменьшите маршрут/партию либо уточните автономность.")
    utilization = snapshot["selection_options"]["utilization"]
    availability = snapshot["selection_options"]["availability"]
    downtime = active_cycle * (1 / (utilization * availability) - 1)
    station_slots = [0.] * min(plan["items"][1]["quantity"], n)
    charger_slots = [0.] * min(plan["items"][0]["quantity"], n)
    events = []
    serial = 0
    def push(t, kind, robot=-1, amount=0.):
        nonlocal serial
        serial += 1
        heapq.heappush(events, (t, serial, kind, robot, amount))
    for index in range(jobs):
        amount = min(batch, target - index * batch)
        push(index * batch / rate * 3600, "arrival", amount=amount)
    pending = deque()
    idle = deque(range(n))
    idle_since = [0.] * n
    batteries = [equipment.runtime_hours * 3600] * n
    segments = [[] for _ in range(n)]
    stats = {key: 0. for key in ("preparation", "outbound", "operation", "return", "station_queue", "charger_queue", "charging", "downtime", "idle")}
    arrived = completed = in_progress = 0.
    max_queue = 0.
    log = [(0., 0., 0., 0.)]
    def segment(robot, state, start, end):
        phase_end = end
        start, end = min(start, horizon), min(end, horizon)
        if end > start:
            segments[robot].append({"state": state, "start": start, "end": end, "phase_end": phase_end})
            stats[state] += end - start
    def dispatch(now):
        nonlocal in_progress
        while pending and idle:
            robot = idle.popleft()
            segment(robot, "idle", idle_since[robot], now)
            if batteries[robot] + 1e-8 < active_cycle:
                slot = heapq.heappop(charger_slots)
                start = max(now, slot)
                end = start + equipment.charge_hours * 3600
                heapq.heappush(charger_slots, end)
                segment(robot, "charger_queue", now, start)
                segment(robot, "charging", start, end)
                push(end, "charged", robot)
                continue
            amount = pending.popleft()
            in_progress += amount
            arrival = now + preparation + travel
            slot = heapq.heappop(station_slots)
            start = max(arrival, slot)
            finish = start + processing
            heapq.heappush(station_slots, finish)
            returned = finish + travel
            segment(robot, "preparation", now, now + preparation)
            segment(robot, "outbound", now + preparation, arrival)
            segment(robot, "station_queue", arrival, start)
            segment(robot, "operation", start, finish)
            segment(robot, "return", finish, returned)
            segment(robot, "downtime", returned, returned + downtime)
            batteries[robot] -= active_cycle
            push(returned, "complete", robot, amount)
            push(returned + downtime, "ready", robot)
    while events:
        now, _, kind, robot, amount = heapq.heappop(events)
        if now > horizon:
            break
        if kind == "arrival":
            arrived += amount
            pending.append(amount)
        elif kind == "complete":
            completed += amount
            in_progress -= amount
        else:
            if kind == "charged":
                batteries[robot] = equipment.runtime_hours * 3600
            idle.append(robot)
            idle_since[robot] = now
        dispatch(now)
        queue_amount = max(0., arrived - completed - in_progress)
        max_queue = max(max_queue, queue_amount)
        log.append((now, arrived, completed, queue_amount))
    for robot in idle:
        segment(robot, "idle", idle_since[robot], horizon)
    frames = []
    cursor = 0
    for step in range(241):
        t = horizon * step / 240
        while cursor + 1 < len(log) and log[cursor + 1][0] <= t:
            cursor += 1
        _, a, c, q = log[cursor]
        frames.append({"time": t, "arrived": round(a, 3), "completed": round(c, 3), "queue": round(q, 3)})
    capacity = n * candidate["throughput"] * utilization * availability
    ratio = completed / target if target else 0
    warnings = list(candidate.get("missing", []))
    if travel * 2 + equipment.handling_seconds > 3600 * batch / candidate["throughput"]:
        warnings.append("Маршрут и обработка ограничивают паспортную производительность.")
    if stats["station_queue"] > 0:
        warnings.append("Есть очередь на рабочих постах: проверьте их количество и время обработки.")
    if stats["charger_queue"] > 0:
        warnings.append("Есть очередь на зарядку: проверьте число станций и автономность.")
    if ratio < .95:
        warnings.append("За смену выполнено менее 95% заданного пикового объёма. Парк или инфраструктура не обеспечивают этот режим.")
    assumptions = [
        "Условная 2D-схема одного процесса, а не план здания. Маршрут задаётся в одну сторону; обратный путь равен ему.",
        "Пиковый поток действует всю смену; это нагрузочный сценарий, а не прогноз среднего дня.",
        "В начале смены все роботы полностью заряжены. Зарядка после исчерпания ресурса следующего цикла, без подзарядки в простое.",
        "Цикл = max(3600 × единиц за цикл / производительность, путь туда-обратно / скорость + обработка). Последняя неполная партия занимает полный цикл.",
        "Остаток паспортного цикла сверх движения и обработки считается индивидуальной подготовкой робота, не занимающей общий пост. Пост занят только заданное время обработки партии.",
        "Коэффициенты загрузки и доступности добавляют плановый простой после цикла. Автономность расходуется на движение и обработку; зарядка и очереди учитываются отдельно.",
        "Операция считается завершённой после возвращения. Конфликты движения, лифты, переезд к зарядке, случайные отказы и пространственная совместимость не моделируются.",
        "Предварительная оценка требует верификации при обследовании объекта. Достижение 95% — индикатор этой модели, а не гарантия внедрения.",
        options.reason,
    ]
    return {"model_version": VERSION, "duration_seconds": horizon, "unit": context["unit"],
        "name": snapshot["name"], "quantity": n, "equipment": plan,
        "kpi": {"target": round(target, 3), "completed": round(completed, 3),
            "backlog": round(max(0, target - completed), 3), "max_queue": round(max_queue, 3),
            "completion_percent": round(ratio * 100, 2), "throughput": round(completed / (horizon / 3600), 3),
            "selection_capacity": round(capacity, 3), "peak_rate": rate,
            "productive_percent": round(100 * (stats["preparation"] + stats["outbound"] + stats["operation"] + stats["return"]) / (n * horizon), 2),
            "state_hours": {key: round(value / 3600, 4) for key, value in stats.items()}},
        "frames": frames, "robots": [{"id": i + 1, "segments": s} for i, s in enumerate(segments)],
        "warnings": warnings, "assumptions": assumptions, "options": options.model_dump()}

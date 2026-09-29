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

VERSION = "simulation-1.1"
# Bound executed work, rather than rejecting a large incoming queue.
MAX_STARTED_CYCLES = 200000
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
    if not context.get("hours_per_day") or context["hours_per_day"] <= 0 or not context.get("daily_demand") or context["daily_demand"] <= 0:
        raise ValueError("Для имитации нужны положительные объём операций и часы работы. Уточните подбор.")
    horizon = context["hours_per_day"] * 3600
    rate = context["daily_demand"] / context["hours_per_day"] * context["peak_factor"]
    batch = equipment.operations_per_cycle
    # Stress test: the selected peak demand persists for the whole shift.
    target = rate * horizon / 3600
    jobs = math.ceil(target / batch)
    arrival_interval = batch / rate * 3600

    def arrivals_at(t):
        # Arrivals are uniform, beginning at t=0. Avoid accumulating floating-point
        # drift and keep even a billion queued jobs as a single integer count.
        return min(jobs, max(0, math.floor(t / arrival_interval + 1e-9) + 1))

    def arrived_amount(t):
        return min(target, arrivals_at(t) * batch)
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
    push(0., "arrival")
    arrival_scheduled = True
    started_jobs = 0
    idle = deque(range(n))
    idle_since = [0.] * n
    batteries = [equipment.runtime_hours * 3600] * n
    segments = [[] for _ in range(n)]
    stats = {key: 0. for key in ("preparation", "outbound", "operation", "return", "station_queue", "charger_queue", "charging", "downtime", "idle")}
    completed = in_progress = 0.
    max_queue = 0.
    frames = []
    frame_index = 0

    def append_frame(t):
        arrived = arrived_amount(t)
        frames.append({"time": t, "arrived": round(arrived, 3), "completed": round(completed, 3),
                       "queue": round(max(0., arrived - completed - in_progress), 3)})
    def segment(robot, state, start, end):
        phase_end = end
        start, end = min(start, horizon), min(end, horizon)
        if end > start:
            segments[robot].append({"state": state, "start": start, "end": end, "phase_end": phase_end})
            stats[state] += end - start
    def dispatch(now):
        nonlocal in_progress, started_jobs, arrival_scheduled
        available = arrivals_at(now)
        while started_jobs < available and idle:
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
            if started_jobs >= MAX_STARTED_CYCLES:
                raise ValueError("Детальная имитация превысила 200 000 выполняемых циклов. Требуется менее подробная модель для такого режима; параметры объекта и партии автоматически не изменены.")
            amount = min(batch, target - started_jobs * batch)
            started_jobs += 1
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
        # Wake an idle robot for the next arrival. If all robots are busy,
        # their next event will account for all arrivals since the last event.
        if idle and started_jobs < jobs and not arrival_scheduled:
            push(started_jobs * arrival_interval, "arrival")
            arrival_scheduled = True
    while events:
        now, _, kind, robot, amount = heapq.heappop(events)
        if now > horizon:
            break
        # Frames before this event use the previous state of the fleet. Equal-time
        # frames wait until all events at that instant have been processed.
        while frame_index <= 240 and horizon * frame_index / 240 < now:
            append_frame(horizon * frame_index / 240)
            frame_index += 1
        # Capture the queue just before the event without counting a simultaneous
        # arrival that an already idle robot can take immediately.
        prior_arrivals = min(jobs, max(0, math.ceil(now / arrival_interval - 1e-9)))
        max_queue = max(max_queue, max(0., min(target, prior_arrivals * batch) - completed - in_progress))
        if kind == "arrival":
            arrival_scheduled = False
        elif kind == "complete":
            completed += amount
            in_progress -= amount
        else:
            if kind == "charged":
                batteries[robot] = equipment.runtime_hours * 3600
            idle.append(robot)
            idle_since[robot] = now
        dispatch(now)
        max_queue = max(max_queue, max(0., arrived_amount(now) - completed - in_progress))
    max_queue = max(max_queue, max(0., arrived_amount(horizon) - completed - in_progress))
    for robot in idle:
        segment(robot, "idle", idle_since[robot], horizon)
    while frame_index <= 240:
        append_frame(horizon * frame_index / 240)
        frame_index += 1
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
        "Условная схема одного процесса, а не план здания. Маршрут задаётся в одну сторону; обратный путь равен ему.",
        "Пиковый поток действует всю смену; это нагрузочный сценарий, а не прогноз среднего дня.",
        "Поступление равномерных партий и очередь рассчитываются по времени без хранения каждой ожидающей заявки. Объём и размер партии не укрупняются; движения, посты и зарядка моделируются по событиям каждого робота.",
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

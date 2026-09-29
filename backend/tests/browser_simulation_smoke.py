"""Browser smoke with intercepted API and the real simulation engine.

Build frontend and run vite preview on port 4173, then from backend:
  python tests/browser_simulation_smoke.py
Requires playwright and Chromium (or BROWSER_CHANNEL=msedge).
"""
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright, expect
from app.schemas.equipment import EquipmentInput
from app.schemas.simulation import SimulationOptions
from app.services.equipment import equipment_plan
from app.services.simulation import simulate
from app.services.simulation_profiles import default_options, scene_profile
from app.schemas.economics import EconomicsInput
from app.services.economics import calculate

project_id = "00000000-0000-0000-0000-000000000001"
version = "2026-09-27T12:00:00Z"
equipment = EquipmentInput(peak_rate=50, runtime_hours=.5, charge_hours=.2)
candidate = {"product_id": 7, "name": "Тестовый AMR", "status": "needs_review", "quantity": 3,
    "throughput": 30, "unit": "паллет/ч", "reasons": [], "missing": ["Проверить пол"], "excluded": [],
    "score": 60, "score_factors": {"Процесс": 40, "Парк": 20}, "equipment": equipment_plan(3,equipment)}
context = {"hours_per_day": 8, "daily_demand": 400, "peak_factor": 1, "unit": "паллет/ч", "missing": [], "assumptions": []}
selection = {"formula": "N = ceil(поток / производительность)", "model_version": "selection-1.1",
    "context": context, "project_updated_at": version, "parameters": {}, "candidates": [candidate],
    "options": {"process_id": 1, "utilization": .8, "availability": .9, "reserve_percent": 10, "equipment": equipment.model_dump()}}
snapshot = {"name": candidate["name"], "quantity": 3, "context": context, "candidate": candidate,
    "selection_options": selection["options"], "equipment": equipment.model_dump(), "parameters": {}}
economics = calculate(EconomicsInput(baseline_annual_labor=10000, scenarios=[
    {"name": "AMR — покупка", "quantity": 3, "equipment_price": 1000},
    {"name": "AMR — RaaS", "mode": "raas", "quantity": 4, "monthly_fee": 100}])).model_dump(mode="json")
stored = {}
requests = []
errors = []


def handle(route):
    path = urlparse(route.request.url).path.removeprefix("/api/v1")
    method = route.request.method
    body = route.request.post_data_json if method == "POST" else None
    requests.append((path, method, body))
    if path == f"/projects/{project_id}":
        data = {"id": project_id, "name": "Тест склада", "facility_type_id": 1, "parameters": {}, "is_demo": False, "updated_at": version}
    elif path == "/reference/facility-types": data = [{"id": 1, "processes": [{"id": 1, "name": "Перевозка паллет"}]}]
    elif path.endswith("/calculations"): data = [{"id": "economics-run", "created_at": version, "stale": False, "inputs": {}, "results": economics}]
    elif path.endswith("/selection"): data = selection
    elif path.endswith("/simulations/defaults"):
        data = {"options": default_options(snapshot), "scene": scene_profile(snapshot)}
    elif path.endswith("/simulations") and method == "POST":
        selected = economics["inputs"]["scenarios"][body["scenario_index"]] if body.get("economics_run_id") else snapshot
        result = simulate({**snapshot, "name": selected["name"], "quantity": selected["quantity"]}, SimulationOptions.model_validate(body["options"]))
        run_id = "saved-simulation" if body["save"] else None
        data = {"id": run_id, "created_at": version, "stale": False, "inputs": snapshot, "results": result}
        if run_id: stored[run_id] = data
    elif path.endswith("/simulations"):
        data = [{"id": key, "name": value["results"]["name"], "created_at": version, "stale": False} for key,value in stored.items()]
    elif "/simulations/" in path: data = stored[path.split("/")[-1]]
    else:
        errors.append(f"Unexpected API: {method} {path}")
        route.fulfill(status=404,json={"detail":"Unexpected API"})
        return
    route.fulfill(json=data)


with sync_playwright() as p, tempfile.TemporaryDirectory() as directory:
    browser = p.chromium.launch(headless=True, channel=os.environ.get("BROWSER_CHANNEL") or None)
    page = browser.new_page(viewport={"width":1366,"height":768}, reduced_motion="reduce")
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.route("**/api/v1/**",handle)
    page.goto(os.environ.get("FRONTEND_URL","http://127.0.0.1:4173") + f"/projects/{project_id}/selection")
    page.get_by_role("button",name="Подобрать решения и рассчитать парк").click()
    expect(page.get_by_text("Количество роботов: 3",exact=True)).to_be_visible()
    panel = page.locator("section.simulation")
    panel.locator("fieldset select").select_option("economics-run:1")
    panel.get_by_role("button",name="Рассчитать и сохранить в проект",exact=True).click()
    expect(panel.locator(".simulation-result")).to_be_visible()
    panel.get_by_role("button",name="Запустить",exact=True).click()
    slider = panel.get_by_label("Позиция воспроизведения")
    page.wait_for_function("Number(document.querySelector('.simulation-timeline input').value)>0")
    panel.get_by_role("button",name="Остановить",exact=True).click()
    stopped = slider.input_value()
    page.wait_for_timeout(100)
    assert slider.input_value() == stopped
    panel.get_by_role("button",name="Перезапустить",exact=True).click()
    expect(panel.get_by_role("button",name="Остановить",exact=True)).to_be_visible()
    panel.get_by_role("button",name="Остановить",exact=True).click()
    panel.get_by_label("Скорость воспроизведения",exact=True).select_option("600")
    for name, suffix in [("Сохранить схему SVG","svg"),("Сохранить схему PNG","png"),("Скачать результат JSON","json")]:
        with page.expect_download() as download:
            panel.get_by_role("button",name=name,exact=True).click()
        target = Path(directory)/f"result.{suffix}"
        download.value.save_as(target)
        assert target.stat().st_size > 100
        if suffix == "svg": assert "simulation-1.2" in target.read_text(encoding="utf-8")
        if suffix == "png": assert target.read_bytes().startswith(b"\x89PNG")
        if suffix == "json": assert json.loads(target.read_text(encoding="utf-8"))["results"]["quantity"] == 4
    panel.get_by_label("Маршрут в одну сторону, м",exact=True).fill("200")
    expect(panel.locator(".simulation-result")).to_have_count(0)
    panel.get_by_text("Сохранённые имитации (1, последние 20)",exact=True).click()
    panel.get_by_role("button",name="AMR — RaaS ·",exact=False).click()
    expect(panel.locator(".simulation-result")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert any(body and body.get("save") for _,_,body in requests)
    assert any(body and body.get("economics_run_id")=="economics-run" and body.get("scenario_index")==1 for _,_,body in requests)
    assert not errors, errors
    screenshot = os.environ.get("SIMULATION_SCREENSHOT")
    if screenshot:
        panel.locator(".simulation-result").screenshot(path=screenshot)
    browser.close()
    print("PASS: 1366x768, simulation, play/pause/restart/speed, SVG/PNG/JSON, saved replay, invalidation")

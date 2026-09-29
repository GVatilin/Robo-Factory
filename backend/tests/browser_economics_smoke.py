"""Browser checks against a running LOCAL app; no GPT request or production writes.
Run: BROWSER_CHANNEL=msedge python backend/tests/browser_economics_smoke.py
Requires requests, Playwright, and Chromium/Edge. Creates and deletes a local test project.
"""
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlparse
import requests
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("ECONOMICS_TEST_URL", "http://localhost:8080")
assert urlparse(BASE).hostname in ("localhost", "127.0.0.1"), "Run only against local app"
api = requests.Session()

def request(method, path, **kw):
    r = api.request(method, BASE + "/api/v1" + path, timeout=60, **kw)
    assert r.ok, (path, r.status_code, r.text[:600])
    return r.json() if r.content else None

profile = request("GET", "/economics/defaults")
comparison = request("GET", "/catalog/compare?ids=1&ids=2")
errors = []
with sync_playwright() as p, tempfile.TemporaryDirectory() as directory:
    browser = p.chromium.launch(headless=True, channel=os.environ.get("BROWSER_CHANNEL", "msedge"))
    page = browser.new_page(viewport={"width":1366,"height":768}, reduced_motion="reduce")
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto(BASE + "/compare?ids=1,2")
    panel = page.locator(".economics")
    expect(panel.get_by_role("heading",name="Сколько стоит роботизация?")).to_be_visible(timeout=30000)
    panel.get_by_role("button",name="Заполнить по умолчанию",exact=True).click()
    expect(panel.locator("#econ-common-electricity_price")).to_have_value(str(int(profile["common"]["electricity_price"])))
    for key, value in profile["common"].items():
        assert float(panel.locator("#econ-common-"+key).input_value()) == value, key
    for product in comparison["products"]:
        product_id = product["id"]
        for key, value in profile["scenario"].items():
            catalog_key = {"equipment_price":"equipment_price","monthly_fee":"monthly_fee","software":"software_price","integration":"implementation_price","annual_service_per_robot":"annual_service_cost","service_life_years":"service_life"}.get(key)
            if catalog_key:
                row = next(r for g in comparison["groups"] for r in g["rows"] if r["key"] == catalog_key)
                known = row["cells"][comparison["products"].index(product)].get("value")
                if known is not None: value = known
            assert float(panel.locator(f"#econ-{product_id}-{key}").input_value()) == value, (product_id,key)
    assert panel.locator("input[type=number]:invalid").count() == 0
    panel.get_by_role("button",name="Рассчитать экономику",exact=True).click()
    expect(panel.get_by_role("heading",name="Результаты за 5 лет")).to_be_visible(timeout=15000)
    expect(panel.get_by_role("rowheader",name="Полная стоимость единицы",exact=False)).to_be_visible()
    panel.get_by_role("button",name="Рассчитать чувствительность",exact=True).click()
    expect(panel.get_by_role("heading",name="Чувствительность экономики: ±20%")).to_be_visible(timeout=15000)
    for label, ext, header in [("Скачать PDF","pdf",b"%PDF-"),("Скачать Excel","xlsx",b"PK")]:
        with page.expect_download(timeout=30000) as download:
            panel.get_by_role("button",name=label,exact=True).click()
        file = Path(directory)/("report."+ext)
        download.value.save_as(file)
        assert file.read_bytes().startswith(header) and file.stat().st_size > 1000
    for width in (1366, 390):
        page.set_viewport_size({"width":width,"height":844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
    page.set_viewport_size({"width":1366,"height":768})
    panel.get_by_role("button",name="1. Данные и допущения",exact=True).click()
    panel.locator("#econ-common-daily_volume").fill("")
    panel.get_by_role("button",name="Рассчитать экономику",exact=True).click()
    expect(panel.get_by_role("alert")).to_contain_text("обоснование")
    panel.get_by_label("Обоснование ручных изменений").fill("Нет подтверждённого объёма для удельных затрат")
    panel.get_by_role("button",name="Рассчитать экономику",exact=True).click()
    expect(panel.get_by_role("heading",name="Результаты за 5 лет")).to_be_visible()
    expect(panel.get_by_text("Укажите объём",exact=True).first).to_be_visible()
    print("PASS: defaults, catalog priority, validation, empty volume, sensitivity, PDF/Excel, desktop/mobile", flush=True)

    # Real local account, real project, actual saving and history API.
    login = request("POST", "/auth/login", data={"username":"user@example.com","password":"user12345"})
    api.headers["Authorization"] = "Bearer " + login["access_token"]
    demos = request("GET", "/projects?demo=true")
    for facility_id in (1,2,3):
        demo = next(d for d in demos if d["facility_type_id"] == facility_id)
        project = request("POST", "/projects/"+demo["id"]+"/copy")
        try:
            page.add_init_script("localStorage.setItem('robo-factory.token', "+json.dumps(login["access_token"])+")")
            page.goto(BASE+"/projects/"+project["id"]+"/selection")
            selection_result = {}
            def selected_response(response):
                if response.url.endswith('/selection/defaults') and response.ok:
                    selection_result.update(response.json())
            page.on('response', selected_response)
            page.get_by_role("button",name="Заполнить пример и рассчитать парк",exact=True).click()
            page.get_by_role("button",name="К экономике →",exact=True).click(timeout=30000)
            panel = page.locator(".economics")
            panel.get_by_role("button",name="Заполнить по умолчанию",exact=True).click()
            expect(panel.locator("#econ-common-electricity_price")).not_to_have_value("",timeout=10000)
            assert float(panel.locator('#econ-common-daily_volume').input_value()) == selection_result['context']['daily_demand']
            assert float(panel.locator('#econ-common-hours_per_day').input_value()) == selection_result['context']['hours_per_day']
            assert panel.locator('#econ-common-hours_per_day').is_disabled()
            for key, field in [('working_days_per_year','days_per_year'),('horizon_years','horizon_years')]:
                if project['parameters'].get(key):
                    assert float(panel.locator('#econ-common-'+field).input_value()) == project['parameters'][key]
            panel.get_by_role("button",name="Рассчитать экономику",exact=True).click()
            expect(panel.get_by_role("heading",name="Результаты за",exact=False)).to_be_visible(timeout=20000)
            panel.locator("#economics-accept").check()
            panel.get_by_role("button",name="Сохранить экономику в проект",exact=True).click()
            expect(panel.get_by_role("button",name="Сохранено в сценариях проекта",exact=True)).to_be_visible(timeout=20000)
            runs = request("GET", "/projects/"+project["id"]+"/calculations")
            assert runs and runs[0]["results"]["annual_volume"] > 0
            for ext in ["pdf", "xlsx"]:
                r = api.get(BASE+"/api/v1/projects/"+project["id"]+"/calculations/"+runs[0]["id"]+"/export."+ext,timeout=60)
                assert r.ok, (ext,r.status_code,r.text[:150])
                assert r.content.startswith(b"%PDF-" if ext=="pdf" else b"PK")
            panel.get_by_role("button",name="1. Данные и допущения",exact=True).click()
            panel.locator("#econ-common-daily_volume").fill("500")
            panel.get_by_label("Обоснование ручных изменений").fill("Уточнён объём для проверки сохранения")
            panel.get_by_role("button",name="Рассчитать экономику",exact=True).click()
            expect(panel.locator("#economics-accept")).to_be_visible()
            assert not panel.locator("#economics-accept").is_checked()
            page.remove_listener("response",selected_response)
            print(f"PASS: facility {facility_id}, real selection, transferred volume/hours/days/horizon, save, history PDF/Excel, reset consent", flush=True)
        finally:
            request("DELETE", "/projects/"+project["id"])
    assert not errors, errors
    browser.close()

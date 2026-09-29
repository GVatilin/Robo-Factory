"""Local integration: three facilities, scene identities, playback, saving, exports.
Requires requests, Playwright, Edge or BROWSER_CHANNEL, and a running localhost app.
Creates disposable copies of demo projects; no GPT call or production mutation.
"""
import json,os,re,tempfile
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright,expect

BASE='http://localhost:8080';api=requests.Session()
def request(method,path,**kw):
 r=api.request(method,BASE+'/api/v1'+path,timeout=60,**kw)
 assert r.ok,(path,r.status_code,r.text[:500])
 return r.json() if r.content else None
login=request('POST','/auth/login',data={'username':'user@example.com','password':'user12345'})
api.headers['Authorization']='Bearer '+login['access_token']
demos=request('GET','/projects?demo=true')
errors=[]
with sync_playwright() as p,tempfile.TemporaryDirectory() as tmp:
 browser=p.chromium.launch(headless=True,channel=os.environ.get('BROWSER_CHANNEL','msedge'))
 page=browser.new_page(viewport={'width':1366,'height':900},reduced_motion='reduce')
 page.add_init_script("localStorage.setItem('robo-factory.token',"+json.dumps(login['access_token'])+")")
 page.on('pageerror',lambda e:errors.append(str(e)))
 for facility,code in [(1,'warehouse'),(2,'airport'),(3,'medical')]:
  project=request('POST','/projects/'+next(d['id'] for d in demos if d['facility_type_id']==facility)+'/copy')
  responses=[]
  def capture(response):
   if response.ok and response.request.method=='POST' and response.url.endswith('/simulations'):
    responses.append(response.json())
  page.on('response',capture)
  try:
   page.goto(BASE+'/projects/'+project['id']+'/selection')
   page.get_by_role('button',name='Заполнить пример и рассчитать парк',exact=True).click()
   page.get_by_role('button',name=re.compile('4. Симуляция')).click()
   panel=page.locator('.simulation')
   expect(panel.locator('.simulation-object--'+code)).to_be_visible(timeout=30000)
   panel.get_by_role('button',name='Рассчитать и сохранить в проект',exact=True).click()
   expect(panel.locator('.simulation-result')).to_be_visible(timeout=30000)
   result=responses[-1]['results'];run_id=responses[-1]['id']
   assert result['scene']['facility_code']==code and result['scene']['robot']['solution_type']
   assert result['kpi']['completed']+result['kpi']['backlog']==result['kpi']['target']
   expect(panel.locator('canvas')).to_be_visible(timeout=30000)
   panel.get_by_role('button',name='Запустить',exact=True).click()
   page.wait_for_timeout(600)
   panel.get_by_role('button',name='Остановить',exact=True).click()
   assert float(panel.locator('#simulation-position').input_value())>0
   panel.get_by_role('button',name='Сверху',exact=True).click()
   panel.get_by_role('button',name='Перезапустить',exact=True).click()
   for label,ext,header in [('Сохранить схему SVG','svg',b'<svg'),('Сохранить схему PNG','png',b'\x89PNG'),('Скачать результат JSON','json',b'{')]:
    with page.expect_download() as dl:panel.get_by_role('button',name=label,exact=True).click()
    path=Path(tmp)/(code+'.'+ext);dl.value.save_as(path)
    assert header in path.read_bytes()[:200] and path.stat().st_size>100
   record=request('GET','/projects/'+project['id']+'/simulations/'+run_id)
   assert record['results']['scene']==result['scene']
   screenshot=os.environ.get('SIMULATION_SCREENSHOTS')
   if screenshot:
    Path(screenshot).mkdir(parents=True,exist_ok=True)
    panel.locator('.simulation-stage').screenshot(path=str(Path(screenshot)/(code+'.png')))
   page.set_viewport_size({'width':390,'height':844})
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   page.set_viewport_size({'width':1366,'height':900})
   print('PASS',code,'robots',result['quantity'],'route',result['options']['route_m'],'type',result['scene']['robot']['solution_type']['code'],'playback/save/SVG/PNG/JSON/mobile',flush=True)
  finally:
   page.remove_listener('response',capture)
   request('DELETE','/projects/'+project['id'])
 assert not errors,errors
 browser.close()

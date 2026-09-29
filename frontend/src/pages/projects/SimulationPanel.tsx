import {lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject} from "react";
import {
  Activity, AlertTriangle, Bot, Box, Clock3, Download, Gauge,
  Pause, Play, RotateCcw, Route, Save,
} from "lucide-react";

import {api} from "../../api/client";
import {useApi} from "../../api/hooks";
import {EquipmentTable, type EquipmentPlan} from "./Equipment";
import {createSimulationWarehouseLayout, type SimulationSceneOrder} from "./SimulationLayout";
import type {SimulationSegment, SimulationView} from "./SimulationScene3D";
import "./Simulation.css";

const SimulationScene3D=lazy(()=>import("./SimulationScene3D"));

type Segment=SimulationSegment;
type Frame={time:number;arrived:number;completed:number;queue:number};
type Simulation={model_version:string;duration_seconds:number;name:string;quantity:number;unit:string;
  options:{route_m:number;speed_mps:number;reason:string};equipment:EquipmentPlan;frames:Frame[];
  robots:{id:number;segments:Segment[]}[];warnings:string[];assumptions:string[];
  kpi:{target:number;completed:number;backlog:number;max_queue:number;completion_percent:number;throughput:number;
    selection_capacity:number;peak_rate:number;productive_percent:number;state_hours:Record<string,number>}};
type SavedSimulation={id:string|null;created_at:string;stale:boolean;inputs:unknown;results:Simulation};
type Selection={options:unknown;candidates:{product_id:number;name:string;status:string;quantity:number|null}[]};
type EconomicsRun={id:string;created_at:string;results:{results:{name:string}[]}};
type History={id:string;created_at:string;name:string;stale:boolean};

const STATES:Record<string,{name:string;short:string;color:string}>={
  preparation:{name:"Подготовка операции",short:"Подготовка",color:"#42a779"},
  outbound:{name:"Движение к операции",short:"В пути",color:"#2f79de"},
  operation:{name:"Выполнение операции",short:"Операция",color:"#1d9a68"},
  return:{name:"Возвращение",short:"Возврат",color:"#57a7d9"},
  station_queue:{name:"Очередь на пост",short:"Очередь на пост",color:"#e59a39"},
  charger_queue:{name:"Очередь на зарядку",short:"Очередь на зарядку",color:"#dc665b"},
  charging:{name:"Зарядка",short:"Зарядка",color:"#8b6bd2"},
  downtime:{name:"Плановый простой",short:"Простой",color:"#8998aa"},
  idle:{name:"Ожидание задания",short:"Ожидание",color:"#9aa9ba"},
};
const VISIBLE_ROBOTS=18;
const number=(value:number)=>value.toLocaleString("ru-RU",{maximumFractionDigits:2});
const clock=(value:number)=>`${Math.floor(value/3600)}:${String(Math.floor(value/60)%60).padStart(2,"0")}:${String(Math.floor(value)%60).padStart(2,"0")}`;

export default function SimulationPanel({projectId,version,isDemo,selection,saved,onSetup}:{onSetup?:()=>void;projectId:string;version:string;isDemo:boolean;selection:Selection|null;saved:EconomicsRun[]}) {
  const history=useApi<History[]>(`/projects/${projectId}/simulations`);
  const [source,setSource]=useState("");
  const [route,setRoute]=useState("50");
  const [speed,setSpeed]=useState("1");
  const [reason,setReason]=useState("Типовой маршрут 50 м в одну сторону, скорость 1 м/с; уточнить на объекте.");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [run,setRun]=useState<SavedSimulation|null>(null);
  const generation=useRef(0);
  const choices=[...(selection?.candidates.filter(candidate=>candidate.quantity!==null&&candidate.status!=="excluded").map(candidate=>({
    key:`current:${candidate.product_id}`,name:`Текущий подбор: ${candidate.name}`,body:{selection:selection.options,product_id:candidate.product_id}}))??[]),
    ...saved.flatMap(savedRun=>savedRun.results.results.map((scenario,index)=>({key:`${savedRun.id}:${index}`,name:`${scenario.name} · ${new Date(savedRun.created_at).toLocaleString("ru-RU")}`,
      body:{economics_run_id:savedRun.id,scenario_index:index}})))];
  const chosen=choices.find(choice=>choice.key===source)??choices[0];

  useEffect(()=>{generation.current++;setRun(null);setBusy(false);},[version,selection]);
  useEffect(()=>()=>{generation.current++;},[]);

  function edit(action:()=>void){action();setRun(null);setError("");}
  async function calculate(save:boolean){
    if(!chosen)return;
    const ticket=++generation.current;
    setBusy(true);setError("");setRun(null);
    try{
      const data=await api<SavedSimulation>(`/projects/${projectId}/simulations`,{method:"POST",body:{...chosen.body,
        project_updated_at:version,options:{route_m:Number(route),speed_mps:Number(speed),reason},save}});
      if(ticket===generation.current){setRun(data);if(save)history.reload();}
    }catch(failure){if(ticket===generation.current)setError((failure as Error).message);}
    finally{if(ticket===generation.current)setBusy(false);}
  }
  async function open(id:string){
    const ticket=++generation.current;setBusy(true);setError("");setRun(null);
    try{const data=await api<SavedSimulation>(`/projects/${projectId}/simulations/${id}`);if(ticket===generation.current)setRun(data);}
    catch(failure){if(ticket===generation.current)setError((failure as Error).message);}
    finally{if(ticket===generation.current)setBusy(false);}
  }
  const valid=chosen&&route!==""&&Number(route)>=0&&Number(route)<=100000&&Number(speed)>0&&Number(speed)<=30&&reason.trim().length>=3;

  return <section className="card project-card simulation" aria-labelledby="simulation-heading">
    <div className="simulation__intro">
      <span className="simulation__intro-icon"><Activity size={22} aria-hidden="true"/></span>
      <div><p className="simulation__eyebrow">Цифровой прогон смены</p><h2 id="simulation-heading">Имитация работы на объекте</h2>
        <p>Проверьте парк на пиковом потоке: 3D-сцена воспроизводит расчётные маршруты, операции, очереди и зарядку в течение всей смены.</p></div>
    </div>
    <button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>edit(()=>{setRoute('50');setSpeed('1');setReason('Допущение команды: маршрут 50 м в одну сторону, скорость 1 м/с. Уточнить на объекте.');setSource(choices[0]?.key??'');})}>Заполнить симуляцию по умолчанию</button>
    <fieldset disabled={busy} className="economics__fieldset simulation-config">
      <label className="simulation-config__scenario"><span>Сценарий</span><select value={chosen?.key??""} onChange={event=>edit(()=>setSource(event.target.value))}>
        {!choices.length&&<option value="">Сначала выполните подбор с рассчитанным парком</option>}
        {choices.map(choice=><option key={choice.key} value={choice.key}>{choice.name}</option>)}</select></label>
      {!choices.length&&<p className="simulation-source-help"><AlertTriangle size={18} aria-hidden="true"/><span><strong>Экономику заполнять не нужно.</strong> Укажите объём в сутки и часы работы в блоке «Процесс и нагрузка», затем повторите подбор. <button type="button" className="btn btn--ghost" onClick={onSetup}>Перейти к настройке и заполнить пример</button></span></p>}
      <div className="simulation-config__grid">
        <label><span><Route size={15} aria-hidden="true"/>Маршрут в одну сторону, м</span><input type="number" min="0" max="100000" step="any" value={route} onChange={event=>edit(()=>setRoute(event.target.value))}/></label>
        <label><span><Gauge size={15} aria-hidden="true"/>Средняя скорость, м/с</span><input type="number" min="0.01" max="30" step="any" value={speed} onChange={event=>edit(()=>setSpeed(event.target.value))}/></label>
        <label className="simulation-config__reason"><span>Источник или допущение по маршруту и скорости</span><input maxLength={1000} value={reason} onChange={event=>edit(()=>setReason(event.target.value))}/></label>
      </div>
      <div className="simulation-config__footer"><p><span/>Расчёт использует количество роботов, поток и оборудование выбранного сценария.</p><div className="projects-actions">
        <button type="button" className="btn btn--primary" disabled={!valid} onClick={()=>calculate(false)}><Play size={16} aria-hidden="true"/>Рассчитать имитацию</button>
        {!isDemo&&<button type="button" className="btn btn--ghost" disabled={!valid} onClick={()=>calculate(true)}><Save size={16} aria-hidden="true"/>Рассчитать и сохранить в проект</button>}
      </div></div>
    </fieldset>
    {busy&&<div className="simulation-loading" role="status"><span/><div><strong>Строим модель смены</strong><p>Рассчитываем события парка, очереди и загрузку оборудования…</p></div></div>}
    {error&&<p role="alert" className="economics__error">{error}</p>}
    {isDemo&&<p className="simulation-demo-note">Демо можно проиграть и экспортировать. Для сохранения истории создайте свою копию проекта.</p>}
    {run&&<SimulationPlayer key={`${run.id??"preview"}-${run.created_at}`} run={run}/>}
    <details className="simulation-history"><summary><span>Сохранённые имитации ({history.data?.length??0}, последние 20)</span><small>Воспроизводимые снимки расчётов</small></summary>
      {history.error?<p role="alert">{history.error.message} <button type="button" onClick={history.reload}>Повторить</button></p>:history.loading?<p>Загрузка истории…</p>:!history.data?.length?<p>Сохранённых имитаций пока нет.</p>:
        <ul>{history.data.map(item=><li key={item.id}><button type="button" disabled={busy} className="btn btn--ghost" onClick={()=>open(item.id)}>{item.name} · {new Date(item.created_at).toLocaleString("ru-RU")}{item.stale?" · параметры объекта изменены":""}</button></li>)}</ul>}
    </details>
  </section>;
}

function download(blob:Blob,name:string){
  const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function SimulationPlayer({run}:{run:SavedSimulation}) {
  const result=run.results;
  const [time,setTime]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [playbackSpeed,setPlaybackSpeed]=useState(120);
  const [view,setView]=useState<SimulationView>("isometric");
  const [activeRobot,setActiveRobot]=useState<number|null>(null);
  const [exportError,setExportError]=useState("");
  const reportSvg=useRef<SVGSVGElement>(null);
  const sceneCanvas=useRef<HTMLCanvasElement>(null);
  const sceneOrder=useMemo<SimulationSceneOrder>(()=>({
    key:result.name,
    target:result.kpi.target,
    fleet:result.quantity,
    routeM:result.options.route_m,
    stationCount:result.equipment.items.find(item=>item.code==="station")?.quantity??1,
    chargerCount:result.equipment.items.find(item=>item.code==="charger")?.quantity??1,
  }),[result]);
  const warehouseLayout=useMemo(()=>createSimulationWarehouseLayout(sceneOrder),[sceneOrder]);

  useEffect(()=>{
    if(!playing)return;
    let handle=0,previous=performance.now();
    const tick=(now:number)=>{const delta=(now-previous)/1000;previous=now;setTime(value=>Math.min(result.duration_seconds,value+delta*playbackSpeed));handle=requestAnimationFrame(tick);};
    handle=requestAnimationFrame(tick);return()=>cancelAnimationFrame(handle);
  },[playing,playbackSpeed,result.duration_seconds]);
  useEffect(()=>{if(time>=result.duration_seconds)setPlaying(false);},[time,result.duration_seconds]);

  const frameIndex=Math.min(result.frames.length-1,Math.floor(time/Math.max(1,result.duration_seconds)*(result.frames.length-1)));
  const frame=result.frames[frameIndex]??{time:0,arrived:0,completed:0,queue:0};
  const stateCounts=useMemo(()=>{
    const counts:Record<string,number>={};
    for(const robot of result.robots){const state=currentSegment(robot.segments,Math.min(time,Math.max(0,result.duration_seconds-.0001)))?.state??"idle";counts[state]=(counts[state]??0)+1;}
    return counts;
  },[result.robots,result.duration_seconds,time]);
  const selectedRobot=result.robots.find(robot=>robot.id===activeRobot);
  const selectedState=selectedRobot?currentSegment(selectedRobot.segments,Math.min(time,Math.max(0,result.duration_seconds-.0001)))?.state:null;
  const healthy=result.kpi.completion_percent>=95;
  const timelineStyle={"--timeline-progress":`${Math.min(100,time/Math.max(1,result.duration_seconds)*100)}%`} as CSSProperties;
  const completionStyle={"--completion-angle":`${Math.min(100,result.kpi.completion_percent)*3.6}deg`} as CSSProperties;

  function restart(){setTime(0);setPlaying(true);}
  function togglePlayback(){if(time>=result.duration_seconds)setTime(0);setPlaying(value=>!value);}
  async function reportPng(){
    if(!reportSvg.current)throw new Error("Не удалось подготовить изображение. Сохраните SVG.");
    const text=new XMLSerializer().serializeToString(reportSvg.current);
    const url=URL.createObjectURL(new Blob([text],{type:"image/svg+xml;charset=utf-8"}));
    try{
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement("canvas");canvas.width=1800;canvas.height=1280;
      const context=canvas.getContext("2d");if(!context)throw new Error("Не удалось создать изображение. Сохраните SVG.");
      context.drawImage(image,0,0,1800,1280);
      const output=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png"));
      if(!output)throw new Error("Не удалось сохранить PNG. Сохраните SVG.");
      download(output,"robot-simulation.png");
    }finally{URL.revokeObjectURL(url);}
  }
  async function exportImage(png:boolean){
    setExportError("");
    try{
      if(!png){
        if(!reportSvg.current)return;
        download(new Blob([new XMLSerializer().serializeToString(reportSvg.current)],{type:"image/svg+xml;charset=utf-8"}),"robot-simulation.svg");return;
      }
      const output=sceneCanvas.current?await new Promise<Blob|null>(resolve=>sceneCanvas.current!.toBlob(resolve,"image/png")):null;
      if(output)download(output,"robot-simulation.png");else await reportPng();
    }catch(failure){setExportError((failure as Error).message);}
  }

  const metrics=[
    {label:"Выполнено за смену",value:`${number(result.kpi.completed)} / ${number(result.kpi.target)}`,icon:<Activity size={18}/>,tone:"blue"},
    {label:"Доля выполненного потока",value:`${number(result.kpi.completion_percent)}%`,icon:<Gauge size={18}/>,tone:healthy?"green":"amber"},
    {label:"Фактическая выработка",value:`${number(result.kpi.throughput)} ${result.unit}`,icon:<Box size={18}/>,tone:"blue"},
    {label:"Оценка подбора",value:`${number(result.kpi.selection_capacity)} ${result.unit}`,icon:<Bot size={18}/>,tone:"violet"},
    {label:"Незавершённый объём",value:number(result.kpi.backlog),icon:<AlertTriangle size={18}/>,tone:result.kpi.backlog>0?"amber":"green"},
    {label:"Занятость роботов",value:`${number(result.kpi.productive_percent)}%`,icon:<Clock3 size={18}/>,tone:"green"},
  ];

  return <div className="simulation-result">
    <header className="simulation-result__header"><div><div className="simulation-result__meta"><span className={`simulation-status simulation-status--${healthy?"healthy":"attention"}`}><i/>{healthy?"План выполняется":"Требуется внимание"}</span><span>{run.id?"Сохранённая имитация":"Предпросмотр"}</span><span>{result.model_version}</span></div>
      <h3>{result.name}</h3><p>Расчёт от {new Date(run.created_at).toLocaleString("ru-RU")} · модель использует {result.quantity} роботов</p></div>
      <div className="simulation-completion" style={completionStyle}><div><strong>{number(result.kpi.completion_percent)}%</strong><span>потока</span></div></div>
    </header>
    {run.stale&&<p className="simulation-warning"><AlertTriangle size={18} aria-hidden="true"/>Параметры объекта изменились. Здесь воспроизводится сохранённый снимок.</p>}
    <div className="simulation-kpis">{metrics.map(metric=><div className={`simulation-kpi simulation-kpi--${metric.tone}`} key={metric.label}><span className="simulation-kpi__icon" aria-hidden="true">{metric.icon}</span><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div>
    <div className={`simulation-verdict simulation-verdict--${healthy?"healthy":"attention"}`}><span><AlertTriangle size={18} aria-hidden="true"/></span><div><strong>{healthy?"Пиковый объём обеспечен":"Пиковый объём не обеспечен"}</strong><p>{healthy?"Модель выполнила не менее 95% заданного потока. Проверьте загрузку постов и зарядок перед обследованием.":"Выполнено менее 95% потока. Проверьте очереди, длину маршрута и состав оборудования."} Это предварительная оценка, требующая проверки на объекте.</p></div></div>

    <section className="simulation-live" aria-label="Воспроизведение имитации">
      <div className="simulation-controls">
        <div className="simulation-controls__primary">
          <button type="button" className="btn btn--primary" onClick={togglePlayback}><span className="simulation-control-icon">{playing?<Pause size={17}/>:<Play size={17}/>}</span>{playing?"Остановить":"Запустить"}</button>
          <button type="button" className="btn btn--ghost" onClick={restart}><RotateCcw size={17} aria-hidden="true"/>Перезапустить</button>
        </div>
        <div className="simulation-controls__secondary"><label>Скорость<select aria-label="Скорость воспроизведения" value={playbackSpeed} onChange={event=>setPlaybackSpeed(Number(event.target.value))}>{[1,30,120,600,1800].map(value=><option key={value} value={value}>×{value}</option>)}</select></label>
          <div className="simulation-view-switch" aria-label="Ракурс сцены"><button type="button" className={view==="isometric"?"is-active":""} aria-pressed={view==="isometric"} onClick={()=>setView("isometric")}>3D</button><button type="button" className={view==="top"?"is-active":""} aria-pressed={view==="top"} onClick={()=>setView("top")}>Сверху</button></div>
        </div>
      </div>
      <div className="simulation-timeline" style={timelineStyle}><span><label htmlFor="simulation-position">Позиция воспроизведения</label><output>{clock(time)} <small>/ {clock(result.duration_seconds)}</small></output></span><input id="simulation-position" type="range" min="0" max={result.duration_seconds} step="1" value={time} onChange={event=>{setPlaying(false);setTime(Number(event.target.value));}}/></div>

      <div className="simulation-live__layout">
        <div className={`simulation-stage simulation-stage--${view}`}>
          <div className="simulation-stage__hud"><span className={playing?"is-live":""}><i/>{playing?"Модель запущена":"Модель на паузе"}</span><strong>{clock(time)}</strong></div>
          <div className="simulation-scene"><Suspense fallback={<div className="simulation-scene__loading"><span/>Загружаем 3D-сцену…</div>}><SimulationScene3D robots={result.robots} order={sceneOrder} time={time} duration={result.duration_seconds} playing={playing} view={view} activeRobot={activeRobot} onRobotSelect={id=>setActiveRobot(id||null)} canvasRef={sceneCanvas}/></Suspense></div>
          <div className="simulation-stage__zones" aria-hidden="true"><span>Заказ: {number(result.kpi.target)}</span><span>Склад: {warehouseLayout.width} × {warehouseLayout.depth} м</span><span>Рабочих зон: {sceneOrder.stationCount}</span><span>Зарядок: {sceneOrder.chargerCount}</span></div>
          <div className="simulation-stage__legend">{[["Движение","outbound"],["Работа","operation"],["Очередь","station_queue"],["Зарядка","charging"]].map(([label,state])=><span key={state}><i style={{background:STATES[state].color}}/>{label}</span>)}</div>
        </div>
        <aside className="simulation-live__aside">
          <div className="simulation-live-card simulation-live-card--accent"><p>Выполнено сейчас</p><strong>{number(frame.completed)}</strong><span>из {number(frame.arrived)} поступивших</span><progress max={Math.max(1,frame.arrived)} value={frame.completed}/></div>
          <div className="simulation-live-card"><div className="simulation-live-card__head"><p>Очередь заданий</p><span className={frame.queue>0?"is-warning":""}>{number(frame.queue)}</span></div><small>Максимум за смену: {number(result.kpi.max_queue)}</small></div>
          <div className="simulation-live-card"><p>Состояние парка</p><ul className="simulation-state-list">{Object.entries(stateCounts).sort((a,b)=>b[1]-a[1]).map(([state,count])=><li key={state}><i style={{background:STATES[state]?.color??"#8998aa"}}/><span>{STATES[state]?.short??state}</span><strong>{count}</strong></li>)}</ul></div>
          <div className={`simulation-live-card simulation-robot-card ${selectedRobot?"is-selected":""}`}><p>{selectedRobot?`Робот №${selectedRobot.id}`:"Инспектор робота"}</p>{selectedRobot?<><strong><i style={{background:STATES[selectedState??"idle"]?.color}}/>{STATES[selectedState??"idle"]?.name??selectedState}</strong><span>Нажмите на другого робота, чтобы проверить его состояние.</span></>:<span>Выберите робота прямо на 3D-сцене.</span>}</div>
        </aside>
      </div>
    </section>

    <p className="simulation-caption">В 3D показаны первые {Math.min(VISIBLE_ROBOTS,result.quantity)} из {result.quantity} роботов; KPI учитывают весь парк. Геометрия условная, расчётная длина маршрута — {number(result.options.route_m)} м.</p>
    <div className="simulation-export"><div><Download size={18} aria-hidden="true"/><span><strong>Материалы для отчёта</strong><small>Сцена, расчётный снимок и исходные показатели</small></span></div><div className="projects-actions"><button type="button" className="btn btn--ghost" onClick={()=>exportImage(false)}>Сохранить схему SVG</button><button type="button" className="btn btn--ghost" onClick={()=>exportImage(true)}>Сохранить схему PNG</button>
      <button type="button" className="btn btn--ghost" onClick={()=>download(new Blob([JSON.stringify(run,null,2)],{type:"application/json"}),"robot-simulation.json")}>Скачать результат JSON</button></div></div>
    {exportError&&<p role="alert" className="economics__error">{exportError}</p>}
    <div className="simulation-details-grid"><details><summary><span>Простои и узкие места</span><small>{number(result.kpi.max_queue)} — максимальная очередь</small></summary><dl>{Object.entries(result.kpi.state_hours).map(([state,hours])=><div key={state}><dt>{STATES[state]?.name??state}, робото-ч</dt><dd>{number(hours)}</dd></div>)}</dl><ul>{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>
      <details><summary><span>Допущения и границы модели</span><small>{result.assumptions.length} пунктов</small></summary><ul>{result.assumptions.map((assumption,index)=><li key={index}>{assumption}</li>)}</ul></details></div>
    <EquipmentTable plan={result.equipment}/>
    <SimulationReport refElement={reportSvg} result={result} time={time} frame={frame}/>
  </div>;
}

function currentSegment(segments:Segment[],time:number){
  let low=0,high=segments.length-1;
  while(low<=high){const mid=(low+high)>>1;const segment=segments[mid];if(time<segment.start)high=mid-1;else if(time>=segment.end)low=mid+1;else return segment;}
  return undefined;
}

function SimulationReport({refElement,result,time,frame}:{refElement:RefObject<SVGSVGElement|null>;result:Simulation;time:number;frame:Frame}) {
  return <svg ref={refElement} className="simulation-export-svg" xmlns="http://www.w3.org/2000/svg" width="900" height="640" viewBox="0 0 900 640" aria-hidden="true" style={{fontFamily:"Arial, sans-serif"}}>
    <defs><linearGradient id="report-background" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f8fbff"/><stop offset="1" stopColor="#e6effa"/></linearGradient></defs>
    <rect width="900" height="640" fill="url(#report-background)"/>
    <text x="34" y="42" fontSize="21" fontWeight="bold" fill="#0e2748">{result.name.slice(0,68)}</text>
    <text x="34" y="70" fontSize="14" fill="#3d5a82">Время {clock(time)} · выполнено {number(frame.completed)} · очередь {number(frame.queue)} · роботов {result.quantity}</text>
    <rect x="35" y="112" width="210" height="270" rx="18" fill="#dfeafb" stroke="#a8c2e7"/>
    <rect x="640" y="112" width="225" height="270" rx="18" fill="#dcefe8" stroke="#91b9a9"/>
    <rect x="280" y="412" width="335" height="112" rx="18" fill="#e9e3f6" stroke="#b9a7dc"/>
    <text x="55" y="144" fill="#0e2748" fontSize="17" fontWeight="bold">Зона выдачи заданий</text>
    <text x="655" y="144" fill="#0e2748" fontSize="17" fontWeight="bold">Зона операций</text>
    <text x="655" y="169" fill="#3d5a82" fontSize="14">Постов: {result.equipment.items[1]?.quantity??0}</text>
    <text x="300" y="444" fill="#0e2748" fontSize="17" fontWeight="bold">Зарядных станций: {result.equipment.items[0]?.quantity??0}</text>
    <path d="M 150 225 H 750 M 750 326 H 150" fill="none" stroke="#a8bedb" strokeWidth="9" strokeDasharray="13 9"/>
    <text x="310" y="206" fontSize="14" fill="#3d5a82">→ {number(result.options.route_m)} м · {number(result.options.speed_mps)} м/с</text>
    <text x="385" y="356" fontSize="14" fill="#3d5a82">← возвращение</text>
    {result.robots.slice(0,30).map((robot,index)=>{
      const segment=currentSegment(robot.segments,Math.min(time,result.duration_seconds-.0001));
      const state=segment?.state??"idle";const progress=segment?(time-segment.start)/Math.max(.001,(segment.phase_end??segment.end)-segment.start):0;
      const offset=(index%5-2)*11;let x=90+(index%5)*27,y=265+Math.floor(index/5)*17;
      if(state==="outbound"){x=150+600*progress;y=225+offset;}
      if(state==="return"){x=750-600*progress;y=326+offset;}
      if(state==="operation"||state==="station_queue"){x=state==="operation"?725+(index%4)*28:650;y=190+Math.floor(index/4)*18;}
      if(state==="charging"||state==="charger_queue"){x=state==="charging"?330+(index%8)*30:290;y=470+Math.floor(index/8)*15;}
      return <g key={robot.id}><circle cx={x} cy={y} r="10" fill={STATES[state]?.color??"#8998aa"} stroke="white" strokeWidth="1.5"/><text x={x} y={y+3} textAnchor="middle" fontSize="9" fill="white">{robot.id}</text></g>;
    })}
    <text x="34" y="556" fontSize="13" fill="#3d5a82">Синий — движение · зелёный — операция · оранжевый — очередь · фиолетовый — зарядка</text>
    <text x="34" y="582" fontSize="13" fill="#0e2748">Итог смены: {number(result.kpi.completion_percent)}% потока · выработка {number(result.kpi.throughput)} {result.unit}</text>
    <text x="34" y="607" fontSize="12" fill="#3d5a82">Условная схема. Показано до 30 роботов; показатели рассчитаны для всего парка. {result.model_version}</text>
    <text x="34" y="628" fontSize="12" fill="#3d5a82">Предварительная оценка: требуется верификация при обследовании объекта.</text>
  </svg>;
}

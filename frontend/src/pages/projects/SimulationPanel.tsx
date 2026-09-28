import {useEffect, useRef, useState, type RefObject} from 'react';
import {api} from '../../api/client';
import {useApi} from '../../api/hooks';
import {EquipmentTable, type EquipmentPlan} from './Equipment';
import './Simulation.css';

type Segment = {state:string;start:number;end:number;phase_end?:number};
type Frame = {time:number;arrived:number;completed:number;queue:number};
type Simulation = {model_version:string;duration_seconds:number;name:string;quantity:number;unit:string;
  options:{route_m:number;speed_mps:number;reason:string};equipment:EquipmentPlan;frames:Frame[];
  robots:{id:number;segments:Segment[]}[];warnings:string[];assumptions:string[];
  kpi:{target:number;completed:number;backlog:number;max_queue:number;completion_percent:number;throughput:number;
    selection_capacity:number;peak_rate:number;productive_percent:number;state_hours:Record<string,number>}};
type SavedSimulation = {id:string|null;created_at:string;stale:boolean;inputs:unknown;results:Simulation};
type Selection = {options:unknown;candidates:{product_id:number;name:string;status:string;quantity:number|null}[]};
type EconomicsRun = {id:string;created_at:string;results:{results:{name:string}[]}};
type History = {id:string;created_at:string;name:string;stale:boolean};
const STATES:Record<string,{name:string;color:string}> = {
  preparation:{name:'Подготовка операции',color:'#287847'},
  outbound:{name:'Движение к операции',color:'#167a9a'},operation:{name:'Выполнение операции',color:'#287847'},
  return:{name:'Возвращение',color:'#167a9a'},station_queue:{name:'Очередь на пост',color:'#bf6400'},
  charger_queue:{name:'Очередь на зарядку',color:'#b94237'},charging:{name:'Зарядка',color:'#7757ad'},
  downtime:{name:'Плановый простой',color:'#637382'},idle:{name:'Ожидание задания',color:'#637382'},
};
const number=(n:number)=>n.toLocaleString('ru-RU',{maximumFractionDigits:2});
const clock=(t:number)=>`${Math.floor(t/3600)}:${String(Math.floor(t/60)%60).padStart(2,'0')}:${String(Math.floor(t)%60).padStart(2,'0')}`;

export default function SimulationPanel({projectId,version,isDemo,selection,saved}:{projectId:string;version:string;isDemo:boolean;selection:Selection|null;saved:EconomicsRun[]}) {
  const history=useApi<History[]>(`/projects/${projectId}/simulations`);
  const [source,setSource]=useState('');
  const [route,setRoute]=useState('50');
  const [speed,setSpeed]=useState('1');
  const [reason,setReason]=useState('Типовой маршрут 50 м в одну сторону, скорость 1 м/с; уточнить на объекте.');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [run,setRun]=useState<SavedSimulation|null>(null);
  const generation=useRef(0);
  const choices=[...(selection?.candidates.filter(c=>c.quantity!==null&&c.status!=='excluded').map(c=>({
    key:`current:${c.product_id}`,name:`Текущий подбор: ${c.name}`,body:{selection:selection.options,product_id:c.product_id}}))??[]),
    ...saved.flatMap(r=>r.results.results.map((s,i)=>({key:`${r.id}:${i}`,name:`${s.name} · ${new Date(r.created_at).toLocaleString('ru-RU')}`,
      body:{economics_run_id:r.id,scenario_index:i}})))];
  const chosen=choices.find(c=>c.key===source)??choices[0];
  useEffect(()=>{generation.current++;setRun(null);setBusy(false);},[version,selection]);
  useEffect(()=>()=>{generation.current++;},[]);
  function edit(action:()=>void) {action();setRun(null);setError('');}
  async function calculate(save:boolean) {
    if(!chosen)return;
    const ticket=++generation.current;
    setBusy(true);setError('');setRun(null);
    try {
      const data=await api<SavedSimulation>(`/projects/${projectId}/simulations`,{method:'POST',body:{...chosen.body,
        project_updated_at:version,options:{route_m:Number(route),speed_mps:Number(speed),reason},save}});
      if(ticket===generation.current){setRun(data);if(save)history.reload();}
    }catch(e){if(ticket===generation.current)setError((e as Error).message);}
    finally{if(ticket===generation.current)setBusy(false);}
  }
  async function open(id:string) {
    const ticket=++generation.current;setBusy(true);setError('');setRun(null);
    try{const data=await api<SavedSimulation>(`/projects/${projectId}/simulations/${id}`);if(ticket===generation.current)setRun(data);}
    catch(e){if(ticket===generation.current)setError((e as Error).message);}
    finally{if(ticket===generation.current)setBusy(false);}
  }
  const valid=chosen&&route!==''&&Number(route)>=0&&Number(route)<=100000&&Number(speed)>0&&Number(speed)<=30&&reason.trim().length>=3;
  return <section className="card project-card simulation" aria-labelledby="simulation-heading">
    <h2 id="simulation-heading">Имитация работы на объекте</h2>
    <p>Проверьте выбранный парк на пиковом потоке в течение всей смены. Количество роботов, поток, производительность и оборудование берутся из подбора или сохранённого сценария покупки/RaaS. Маршрут — условная схема одного процесса.</p>
    <fieldset disabled={busy} className="economics__fieldset">
      <label>Сценарий<select value={chosen?.key??''} onChange={e=>edit(()=>setSource(e.target.value))}>
        {!choices.length&&<option value="">Сначала выполните подбор или сохраните экономику</option>}
        {choices.map(c=><option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
      <div className="selection-fields">
        <label>Маршрут в одну сторону, м<input type="number" min="0" max="100000" step="any" value={route} onChange={e=>edit(()=>setRoute(e.target.value))}/></label>
        <label>Средняя скорость, м/с<input type="number" min="0.01" max="30" step="any" value={speed} onChange={e=>edit(()=>setSpeed(e.target.value))}/></label>
        <label>Источник или допущение по маршруту и скорости<input maxLength={1000} value={reason} onChange={e=>edit(()=>setReason(e.target.value))}/></label>
      </div>
      <div className="projects-actions"><button type="button" className="btn btn--primary" disabled={!valid} onClick={()=>calculate(false)}>Рассчитать имитацию</button>
        {!isDemo&&<button type="button" className="btn btn--ghost" disabled={!valid} onClick={()=>calculate(true)}>Рассчитать и сохранить в проект</button>}</div>
    </fieldset>
    {busy&&<p role="status">Рассчитываем или загружаем модель…</p>}
    {error&&<p role="alert" className="economics__error">{error}</p>}
    {isDemo&&<p>Демо можно проиграть и экспортировать. Для сохранения истории создайте свою копию проекта.</p>}
    {run&&<SimulationPlayer key={`${run.id??'preview'}-${run.created_at}`} run={run}/>}
    <details><summary>Сохранённые имитации ({history.data?.length??0}, последние 20)</summary>
      {history.error?<p role="alert">{history.error.message} <button type="button" onClick={history.reload}>Повторить</button></p>:history.loading?<p>Загрузка истории…</p>:!history.data?.length?<p>Сохранённых имитаций пока нет.</p>:
        <ul>{history.data.map(h=><li key={h.id}><button type="button" disabled={busy} className="btn btn--ghost" onClick={()=>open(h.id)}>{h.name} · {new Date(h.created_at).toLocaleString('ru-RU')}{h.stale?' · параметры объекта изменены':''}</button></li>)}</ul>}
    </details>
  </section>;
}

function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

function SimulationPlayer({run}:{run:SavedSimulation}) {
  const result=run.results;
  const [time,setTime]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [speed,setSpeed]=useState(120);
  const [exportError,setExportError]=useState('');
  const svg=useRef<SVGSVGElement>(null);
  useEffect(()=>{
    if(!playing)return;
    let handle=0,previous=performance.now();
    const tick=(now:number)=>{const dt=(now-previous)/1000;previous=now;setTime(t=>Math.min(result.duration_seconds,t+dt*speed));handle=requestAnimationFrame(tick);};
    handle=requestAnimationFrame(tick);return()=>cancelAnimationFrame(handle);
  },[playing,speed,result.duration_seconds]);
  useEffect(()=>{if(time>=result.duration_seconds)setPlaying(false);},[time,result.duration_seconds]);
  const frame=result.frames[Math.min(240,Math.floor(time/result.duration_seconds*240))];
  async function exportImage(png:boolean) {
    setExportError('');
    if(!svg.current)return;
    const text=new XMLSerializer().serializeToString(svg.current);
    const blob=new Blob([text],{type:'image/svg+xml;charset=utf-8'});
    if(!png){download(blob,'robot-simulation.svg');return;}
    const url=URL.createObjectURL(blob);
    try {
      const img=new Image();img.src=url;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1280;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось создать изображение. Сохраните SVG.');
      ctx.drawImage(img,0,0,1800,1280);
      const output=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!output)throw new Error('Не удалось сохранить PNG. Сохраните SVG.');download(output,'robot-simulation.png');
    }catch(e){setExportError((e as Error).message);}finally{URL.revokeObjectURL(url);}
  }
  return <div className="simulation-result">
    <h3>{result.name}</h3><p>{run.id?'Сохранённая имитация':'Предпросмотр'} · {new Date(run.created_at).toLocaleString('ru-RU')} · {result.model_version}</p>
    {run.stale&&<p className="simulation-warning">Параметры объекта изменились. Здесь воспроизводится сохранённый снимок.</p>}
    <div className="simulation-kpis">{[
      ['Выполнено за смену',`${number(result.kpi.completed)} / ${number(result.kpi.target)}`],
      ['Доля выполненного потока',`${number(result.kpi.completion_percent)}%`],
      ['Фактическая выработка',`${number(result.kpi.throughput)} ${result.unit}`],
      ['Оценка подбора',`${number(result.kpi.selection_capacity)} ${result.unit}`],
      ['Незавершённый объём',number(result.kpi.backlog)],['Занятость роботов',`${number(result.kpi.productive_percent)}%`],
    ].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <p className="simulation-warning">{result.kpi.completion_percent>=95?'В этой модели выполнено не менее 95% пикового объёма.':'Пиковый объём не обеспечен: выполнено менее 95%.'} Проверьте очереди, маршрут и оборудование. Это предварительная оценка, требующая обследования объекта.</p>
    <div className="projects-actions">
      <button type="button" className="btn btn--primary" disabled={time>=result.duration_seconds} onClick={()=>setPlaying(p=>!p)}>{playing?'Остановить':'Запустить'}</button>
      <button type="button" className="btn btn--ghost" onClick={()=>{setTime(0);setPlaying(true);}}>Перезапустить</button>
      <label>Скорость<select aria-label="Скорость воспроизведения" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[1,30,120,600,1800].map(s=><option key={s} value={s}>×{s}</option>)}</select></label>
      <span>Время модели: {clock(time)} / {clock(result.duration_seconds)}</span>
    </div>
    <label className="simulation-timeline">Позиция воспроизведения<input type="range" min="0" max={result.duration_seconds} step="1" value={time} onChange={e=>{setPlaying(false);setTime(Number(e.target.value));}}/></label>
    <SimulationScene refElement={svg} result={result} time={time} frame={frame}/>
    <p>На схеме показаны первые {Math.min(30,result.quantity)} из {result.quantity} роботов; KPI учитывают весь парк. Схема без масштаба, длина маршрута задаётся отдельно.</p>
    <div className="projects-actions"><button type="button" className="btn btn--ghost" onClick={()=>exportImage(false)}>Сохранить схему SVG</button><button type="button" className="btn btn--ghost" onClick={()=>exportImage(true)}>Сохранить схему PNG</button>
      <button type="button" className="btn btn--ghost" onClick={()=>download(new Blob([JSON.stringify(run,null,2)],{type:'application/json'}),'robot-simulation.json')}>Скачать результат JSON</button></div>
    {exportError&&<p role="alert">{exportError}</p>}
    <details><summary>Простои и узкие места</summary><dl>{Object.entries(result.kpi.state_hours).map(([s,h])=><div key={s}><dt>{STATES[s]?.name??s}, робото-ч</dt><dd>{number(h)}</dd></div>)}</dl><p>Максимальная очередь заданий: {number(result.kpi.max_queue)} единиц потока.</p><ul>{result.warnings.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
    <EquipmentTable plan={result.equipment}/>
    <details><summary>Допущения и границы модели</summary><ul>{result.assumptions.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
  </div>;
}

function currentSegment(segments:Segment[],time:number) {
  let low=0,high=segments.length-1;
  while(low<=high){const mid=(low+high)>>1;const s=segments[mid];if(time<s.start)high=mid-1;else if(time>=s.end)low=mid+1;else return s;}
  return undefined;
}
function SimulationScene({refElement,result,time,frame}:{refElement:RefObject<SVGSVGElement|null>;result:Simulation;time:number;frame:Frame}) {
  return <svg ref={refElement} xmlns="http://www.w3.org/2000/svg" width="900" height="640" viewBox="0 0 900 640" role="img" aria-label="Схема движения роботов, выполнения операций и зарядки" style={{maxWidth:'100%',height:'auto',fontFamily:'Arial, sans-serif'}}>
    <rect width="900" height="640" fill="#f3f7fa"/>
    <text x="28" y="34" fontSize="19" fontWeight="bold" fill="#193d54">{result.name.slice(0,68)}</text>
    <text x="28" y="59" fontSize="14" fill="#193d54">Время {clock(time)} · выполнено {number(frame.completed)} · очередь {number(frame.queue)} · роботов {result.quantity}</text>
    <rect x="35" y="110" width="210" height="270" rx="14" fill="#dfebf0" stroke="#91a9b7"/>
    <rect x="640" y="110" width="225" height="270" rx="14" fill="#def0e4" stroke="#75a586"/>
    <rect x="280" y="405" width="335" height="120" rx="14" fill="#eee6f8" stroke="#a58abe"/>
    <text x="55" y="139" fill="#193d54" fontSize="17">Зона выдачи заданий</text>
    <text x="655" y="139" fill="#193d54" fontSize="17">Зона операций</text>
    <text x="655" y="163" fill="#193d54" fontSize="14">Постов: {result.equipment.items[1].quantity}</text>
    <text x="300" y="433" fill="#193d54" fontSize="17">Зарядных станций: {result.equipment.items[0].quantity}</text>
    <path d="M 150 225 H 750 M 750 325 H 150" fill="none" stroke="#9ab1bf" strokeWidth="8" strokeDasharray="12 8"/>
    <text x="310" y="207" fontSize="14" fill="#193d54">→ {number(result.options.route_m)} м · {number(result.options.speed_mps)} м/с</text>
    <text x="385" y="354" fontSize="14" fill="#193d54">← возвращение</text>
    {result.robots.slice(0,30).map((r,i)=>{
      const segment=currentSegment(r.segments,Math.min(time,result.duration_seconds-.0001));
      const state=segment?.state??'idle';const progress=segment?(time-segment.start)/((segment.phase_end??segment.end)-segment.start):0;
      const offset=(i%5-2)*11;let x=90+(i%5)*27,y=265+Math.floor(i/5)*17;
      if(state==='outbound'){x=150+600*progress;y=225+offset;}
      if(state==='return'){x=750-600*progress;y=325+offset;}
      if(state==='operation'||state==='station_queue'){x=state==='operation'?725+(i%4)*28:650;y=190+Math.floor(i/4)*18;}
      if(state==='charging'||state==='charger_queue'){x=state==='charging'?330+(i%8)*30:290;y=465+Math.floor(i/8)*15;}
      return <g key={r.id}><title>Робот {r.id}: {STATES[state]?.name}</title><circle cx={x} cy={y} r="10" fill={STATES[state]?.color??'#637382'} stroke="white" strokeWidth="1.5"/><text x={x} y={y+3} textAnchor="middle" fontSize="9" fill="white">{r.id}</text></g>;
    })}
    <text x="28" y="552" fontSize="13" fill="#193d54">Зелёный — работа · синий — движение · оранжевый — очередь на пост · фиолетовый — зарядка</text>
    <text x="28" y="574" fontSize="13" fill="#193d54">Итог смены: {number(result.kpi.completion_percent)}% потока · выработка {number(result.kpi.throughput)} {result.unit}</text>
    <text x="28" y="597" fontSize="12" fill="#193d54">Условная схема. Показано до 30 роботов; показатели рассчитаны для всего парка. {result.model_version}</text>
    <text x="28" y="620" fontSize="12" fill="#193d54">Предварительная оценка: требуется верификация при обследовании объекта.</text>
  </svg>;
}

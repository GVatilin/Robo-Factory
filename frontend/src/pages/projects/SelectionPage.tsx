import { useState, type FormEvent } from "react";
import { Bot, Calculator, SlidersHorizontal, Play, History } from "lucide-react";
import { Link, useParams } from "react-router";
import { api } from "../../api/client";
import { useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthContext";
import type { Comparison } from "../../api/types";
import EconomicsPanel, { EconomicsResults, type EconomicsResponse } from "../solutions/EconomicsPanel";
import { ErrorState, Spinner } from "../../ui/Controls";
import type { Project } from "./ProjectsPage";
import "./Projects.css";
import "./Selection.css";
import {DEFAULT_EQUIPMENT, EquipmentFields, EquipmentTable, type EquipmentInput, type EquipmentPlan} from './Equipment';
import SimulationPanel from './SimulationPanel';

type Options = {process_id:number; utilization:number; availability:number; reserve_percent:number; equipment:EquipmentInput;
  daily_demand?:number; hours_per_day?:number; peak_factor?:number; demand_reason:string;
  throughput_overrides:Record<string,{value:number;reason:string}>};
type Candidate = {product_id:number;name:string;status:string;quantity:number|null;throughput:number|null;unit:string;equipment:EquipmentPlan|null;
  capacity_example?:{value:number;reason:string};decision?:string;reasons:string[];missing:string[];excluded:string[];risks?:string[];score:number;score_factors:Record<string,number>;
  calculation?:{peak_hourly_demand:number;required_rate_with_reserve:number;effective_throughput:number;unrounded_quantity:number}|null};
type Selection = {process:{id:number;name:string;code:string};formula:string;model_version:string;project_updated_at:string;options:Options;parameters:Project['parameters'];
  context:{daily_demand:number|null;hours_per_day:number|null;peak_factor:number;unit:string;missing:string[];assumptions:string[]}; candidates:Candidate[]};
type Saved = {id:string;created_at:string;stale:boolean;inputs:unknown;results:EconomicsResponse};
type Facility = {id:number;processes:{id:number;name:string}[]};

function economicVolumeUnit(rateUnit:string) {
  return ({'паллет/ч':'паллета','рейсов/ч':'рейс','строк/ч':'строка','отправлений/ч':'отправление','операций/ч':'операция','позиций/ч':'позиция','порций/ч':'порция','контейнеров/ч':'контейнер','заявок/ч':'заявка','образцов/ч':'образец','м²/ч':'м²','кг/ч':'кг'} as Record<string,string>)[rateUnit]??rateUnit.replace(/\/ч$/,'');
}
export default function SelectionPage() {
  const {id} = useParams();
  const {user} = useAuth();
  const project = useApi<Project>(`/projects/${id}`);
  const facilities = useApi<Facility[]>("/reference/facility-types");
  if(project.error || facilities.error) return <ErrorState message={(project.error || facilities.error)!.message} onRetry={()=>{project.reload();facilities.reload();}}/>;
  if(project.loading || facilities.loading || !project.data || !facilities.data) return <Spinner label="Загружаем параметры объекта…"/>;
  return <Workflow key={`${id}-${user?.id ?? 'guest'}`} project={project.data} processes={facilities.data.find(f=>f.id===project.data!.facility_type_id)?.processes ?? []}/>;
}

function Workflow({project,processes}:{project:Project;processes:Facility['processes']}) {
  const history = useApi<Saved[]>(`/projects/${project.id}/calculations`);
  const [options,setOptions] = useState<Options>({process_id:processes[0]?.id ?? 0,utilization:.8,availability:.9,reserve_percent:15,demand_reason:"",throughput_overrides:{},equipment:{...DEFAULT_EQUIPMENT}});
  const [selection,setSelection] = useState<Selection|null>(null);
  const [selected,setSelected] = useState<number[]>([]);
  const [comparison,setComparison] = useState<Comparison|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [version,setVersion] = useState(project.updated_at);
  const [revision,setRevision] = useState(0);
  const [step,setStep] = useState('setup');
  const [candidateFilter,setCandidateFilter] = useState('available');
  function navigateStep(next:string) {
    setStep(next);
    document.getElementById('model-navigation')?.scrollIntoView({block:'start'});
  }
  const steps=[
    {id:'setup',label:'Настройка',hint:'Процесс и нагрузка',icon:SlidersHorizontal,disabled:false},
    {id:'robots',label:'Решения',hint:'Выбор роботов',icon:Bot,disabled:!selection},
    {id:'economics',label:'Экономика',hint:'Затраты и выгода',icon:Calculator,disabled:!comparison},
    {id:'simulation',label:'Симуляция',hint:'Работа парка',icon:Play,disabled:false},
    {id:'history',label:'История',hint:'Сохранённые расчёты',icon:History,disabled:false},
  ];
  function change(patch:Partial<Options>) {setOptions(o=>({...o,...patch}));setSelection(null);setComparison(null);setSelected([]);setError("");}
  async function select(e?:FormEvent, next=options) {
    e?.preventDefault();setBusy(true);setError("");setComparison(null);setSelected([]);setSelection(null);
    try {const result=await api<Selection>(`/projects/${project.id}/selection`,{method:"POST",body:next});setSelection(result);setVersion(result.project_updated_at);setRevision(r=>r+1);navigateStep('robots');}
    catch(e) {setError((e as Error).message);setStep('setup');} finally {setBusy(false);}
  }
  async function fillSelectionDefaults(ids=selected) {
    setBusy(true);setError("");
    try {
      const result=await api<Selection>(`/projects/${project.id}/selection/defaults`,{method:'POST',body:{selection:options,product_ids:ids}});
      setOptions(result.options);setSelection(result);setVersion(result.project_updated_at);setRevision(r=>r+1);setComparison(null);
      setSelected(ids.length?ids.filter(id=>result.candidates.some(c=>c.product_id===id&&c.status!=='excluded')):result.candidates.filter(c=>c.status!=='excluded'&&c.quantity!==null).slice(0,2).map(c=>c.product_id));
      navigateStep('robots');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function openEconomics() {
    setBusy(true);setError("");
    try {setComparison(await api<Comparison>(`/catalog/compare?${selected.map(id=>`ids=${id}`).join('&')}`));navigateStep('economics');}
    catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function prepareEconomicsFleet() {
    const ids=comparison?.products.map(p=>p.id)??selected;
    setBusy(true);setError('');
    try {
      const result=await api<Selection>(`/projects/${project.id}/selection/defaults`,{method:'POST',body:{selection:options,product_ids:ids}});
      const candidates=ids.map(id=>result.candidates.find(c=>c.product_id===id));
      const unavailable=candidates.filter(c=>!c||c.status==='excluded'||c.quantity===null);
      if(unavailable.length)throw new Error(`Не удалось рассчитать парк: ${unavailable.map(c=>c?`${c.name}: ${[...c.excluded,...c.missing].join('; ')}`:'решение больше не доступно для этого процесса').join('. ')}. Уточните параметры в разделе «Решения».`);
      // Keep the economics component mounted: prices and other user inputs must survive.
      setOptions(result.options);setSelection(result);setVersion(result.project_updated_at);
      return {quantities:Object.fromEntries(candidates.map(c=>[c!.product_id,c!.quantity!])),hoursPerDay:result.context.hours_per_day!,dailyVolume:result.context.daily_demand,volumeUnit:economicVolumeUnit(result.context.unit),
        notes:[...result.context.assumptions,result.options.demand_reason,...ids.map(id=>result.options.throughput_overrides[id]?.reason)].filter((n):n is string=>!!n)};
    }finally{setBusy(false);}
  }
  const common:Record<string,string> = {};
  if(selection?.context.daily_demand)common.daily_volume=String(selection.context.daily_demand);
  if(selection?.context.hours_per_day) common.hours_per_day=String(selection.context.hours_per_day);
  for(const key of ['horizon_years','working_days_per_year']) {
    const value=Number((selection?.parameters??project.parameters)[key]);
    if(Number.isFinite(value) && value>0) common[key==='working_days_per_year'?'days_per_year':key]=String(value);
  }
  const params=selection?.parameters??project.parameters;
  const processCode=selection?.process.code??'';
  const staffByProcess:Record<string,[string,string]>={
    picking:['pickers_count','picker_salary_rub_month'],
    inbound:['forklift_operators_count','forklift_operator_salary_rub_month'],
    outbound:['forklift_operators_count','forklift_operator_salary_rub_month'],
    internal_transport:['forklift_operators_count','forklift_operator_salary_rub_month'],
    ramp_transport:['ramp_staff_count','ramp_staff_salary_rub_month'],
    baggage:['ramp_staff_count','ramp_staff_salary_rub_month'],
    food:['kitchen_staff_count','kitchen_staff_salary_rub_month'],
    linen:['laundry_staff_count','orderly_salary_rub_month'],
    medicines:['orderlies_count','orderly_salary_rub_month'],
    lab_samples:['orderlies_count','orderly_salary_rub_month'],
    waste:['orderlies_count','orderly_salary_rub_month'],
  };
  const staffFields=staffByProcess[processCode];
  const people=staffFields?Number(params[staffFields[0]]):0;
  const salary=staffFields?Number(params[staffFields[1]]):0;
  const payroll=Number(params.payroll_tax_coef);
  if(people>0&&salary>0&&payroll>0)common.baseline_annual_labor=String(people*salary*12*payroll);
  const unresolved=selection?.candidates.filter(c=>selected.includes(c.product_id)&&c.quantity===null)??[];
  return <div className="page selection-page">
    <Link to={`/projects/${project.id}`}>← Параметры проекта</Link>
    <header className="model-hero"><div><span className="model-eyebrow">МОДЕЛИРОВАНИЕ РОБОТИЗАЦИИ</span><h1>От задачи — к решению</h1><p>{project.name}</p><span>Настройте процесс, выберите роботов и сравните экономику.</span></div><div className="model-hero__symbol" aria-hidden="true"><Bot size={54}/></div></header>
    <nav id="model-navigation" className="model-navigation" aria-label="Разделы моделирования">{steps.map((item,i)=><button key={item.id} type="button" disabled={item.disabled||busy} aria-current={step===item.id?'step':undefined} onClick={()=>navigateStep(item.id)} title={item.disabled?'Сначала выполните предыдущий шаг':undefined}><span className="model-navigation__icon"><item.icon size={20}/></span><span><strong>{i+1}. {item.label}</strong><small>{item.hint}</small></span></button>)}</nav>
    {!!project.missing_required.length && <div className="card project-card" role="alert"><p>До расчёта заполните обязательные параметры объекта: осталось {project.missing_required.length}.</p><Link className="btn btn--primary" to={`/projects/${project.id}`}>Заполнить параметры</Link></div>}
    <section hidden={step!=='setup'} id="selection-inputs" className="card project-card model-panel"><span className="model-eyebrow">ШАГ 01</span><h2>Как работает ваш объект?</h2>
      <p>Подбор использует сохранённые параметры объекта. Количество рассчитывается отдельно для выбранного процесса. Решения ниже — альтернативы, их эффект нельзя складывать.</p>
      <form onSubmit={select} onInvalid={e=>{let node=(e.target as HTMLElement).parentElement;while(node){if(node.tagName==='DETAILS')node.setAttribute('open','');node=node.parentElement;}}}><fieldset disabled={busy || !!project.missing_required.length} className="economics__fieldset">
        <button type="button" className="btn btn--ghost" onClick={()=>void fillSelectionDefaults([])}>Заполнить пример и рассчитать парк</button><p className="economics__warning">Недостающие поток и производительность будут заполнены примерными допущениями команды с формулами. Данные объекта и известные характеристики имеют приоритет. Для реального проекта уточните замеры.</p>
        <div className="selection-fields">
          <label>Процесс<select value={options.process_id} onChange={e=>change({process_id:Number(e.target.value),throughput_overrides:{},daily_demand:undefined,hours_per_day:undefined,peak_factor:undefined,demand_reason:""})}>{processes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {([['utilization','Коэффициент загрузки',.01,1],['availability','Техническая доступность',.01,1],['reserve_percent','Резерв парка, %',0,100],['daily_demand','Объём в сутки (пусто — из объекта)',.01,1e9],['hours_per_day','Часы в сутки (пусто — из объекта)',.01,24],['peak_factor','Пиковый коэффициент (пусто — из объекта)',1,10]] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" step="any" min={min} max={max} required={['utilization','availability','reserve_percent'].includes(key)} value={options[key]??''} onChange={e=>change({[key]:e.target.value===''?undefined:Number(e.target.value)})}/></label>)}
          <label>Обоснование изменения нагрузки / режима / коэффициентов<input maxLength={1000} value={options.demand_reason} onChange={e=>change({demand_reason:e.target.value})}/></label>
        </div><details className="model-disclosure"><summary>Зарядные станции и рабочие посты <small>Дополнительные параметры</small></summary><EquipmentFields value={options.equipment} onChange={equipment=>change({equipment})}/></details><button className="btn btn--primary" disabled={!options.process_id} type="submit">{busy?'Подбираем…':'Подобрать решения и рассчитать парк'}</button>
      </fieldset></form>
    </section>
    {error && <p role="alert" className="economics__error">{error}</p>}
    {selection && <div hidden={step!=='robots'} className="model-stage"><section className="card project-card model-panel"><span className="model-eyebrow">ШАГ 02</span><h2>Выберите решения для сравнения</h2><p>Добавьте до 6 роботов. Затем сравните покупку и аренду, затраты и окупаемость.</p><div className="model-stats"><div><strong>{selection.candidates.filter(c=>c.status!=='excluded').length}</strong><span>доступно для оценки</span></div><div><strong>{selected.length} / 6</strong><span>выбрано решений</span></div><div><strong>{selection.context.hours_per_day??'—'} ч</strong><span>рабочий день</span></div></div><details className="model-disclosure"><summary>Как рассчитан подбор</summary>
      <p>{selection.formula}</p><p>Объём: {selection.context.daily_demand??'не указан'} в сутки · Производительность: {selection.context.unit} · Режим: {selection.context.hours_per_day??'не указан'} ч/сутки · Пик: {selection.context.peak_factor}</p>
      <ul>{[...selection.context.missing,...selection.context.assumptions].map((n,i)=><li key={i}>{n}</li>)}</ul>
      <p>Сначала применяются блокирующие ограничения, затем решения ранжируются по совместимости, проверкам, расчётности парка и качеству данных. Балл не является гарантией пригодности.</p>
      </details>
      {!selection.candidates.length && <p>В опубликованном каталоге нет решений для этого процесса.</p>}
    </section>
    <div className="card project-card"><button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>void fillSelectionDefaults()}>Заполнить допущения и рассчитать парк</button><p>Для выбранных решений (или первых 6, если ничего не выбрано) добавим только недостающую производительность. Это пример для предварительной оценки, не данные производителя.</p>{!!unresolved.length&&<p role="status" className="economics__warning">У {unresolved.length} выбранных решений количество роботов не рассчитано. Сначала заполните допущения кнопкой выше или уточните производительность в карточках.</p>}</div>
    <div className="model-filters" aria-label="Фильтр решений">{[['available','Доступные'],['selected','Выбранные'],['all','Все, включая исключённые']].map(([id,label])=><button type="button" key={id} aria-pressed={candidateFilter===id} onClick={()=>setCandidateFilter(id)}>{label}</button>)}</div>
    {candidateFilter==='selected'&&!selected.length&&<p className="model-empty">Пока ничего не выбрано. Откройте «Доступные» и отметьте подходящих роботов.</p>}
    <div className="selection-candidates">{selection.candidates.filter(c=>candidateFilter==='all'||(candidateFilter==='selected'?selected.includes(c.product_id):c.status!=='excluded')).map(c=><article className={`card project-card model-candidate ${selected.includes(c.product_id)?'is-selected':''}`} key={c.product_id}>
      <h3><Link to={`/products/${c.product_id}`}>{c.name}</Link></h3>
      <p className={`model-status model-status--${c.status}`}>{c.status==='excluded'?'Исключено':c.status==='suitable'?'Предварительно подходит':'Требуется проверка'} · {c.score}/100</p>
      {c.decision&&<p>{c.decision}</p>}
      <strong>Количество роботов: {c.quantity??'недостаточно данных'}</strong><p>Производительность: {c.throughput??'не указана'} {c.unit}</p>
      <details className="model-disclosure"><summary>Расчёт парка и оборудование</summary>{c.calculation&&<p>Пиковая потребность: {c.calculation.peak_hourly_demand.toLocaleString('ru-RU')} {c.unit}; эффективная производительность робота: {c.calculation.effective_throughput.toLocaleString('ru-RU')} {c.unit}; до округления: {c.calculation.unrounded_quantity.toLocaleString('ru-RU')}.</p>}
      {c.equipment&&<EquipmentTable plan={c.equipment}/>}</details>
      <details><summary>Причины, ограничения, риски и рейтинг</summary><ul>{[...c.reasons,...c.excluded,...c.missing,...(c.risks??[])].map((v,i)=><li key={i}>{v}</li>)}</ul><dl>{Object.entries(c.score_factors).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details>
      {c.status!=='excluded' && <RateForm key={`${c.product_id}-${revision}`} candidate={c} initial={options.throughput_overrides[c.product_id]} busy={busy} apply={rate=>{const next={...options,throughput_overrides:{...options.throughput_overrides,[c.product_id]:rate}};setOptions(next);void select(undefined,next);}}/>}
      <label className="selection-candidate-choice"><input type="checkbox" disabled={busy || c.status==='excluded' || (!selected.includes(c.product_id)&&selected.length>=6)} checked={selected.includes(c.product_id)} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,c.product_id]:ids.filter(id=>id!==c.product_id));setComparison(null);}}/><span>В экономическую оценку
        {c.quantity===null&&c.status!=='excluded'&&<small>Количество не рассчитано — заполните допущения или укажите производительность в этой карточке.</small>}
        {c.status==='excluded'&&<small>Исключённое решение нельзя добавить в расчёт.</small>}
      </span></label>
    </article>)}</div>
    <div className="model-actionbar"><span><strong>{selected.length} из 6</strong> решений выбрано</span><button className="btn btn--primary" disabled={busy||!selected.length} onClick={openEconomics}>{busy?'Открываем…':'К экономике →'}</button></div></div>}
    {comparison && selection && <div hidden={step!=='economics'}><EconomicsPanel key={`${revision}-${comparison.products.map(p=>p.id).join(',')}`} data={comparison} project={{common,volumeUnit:economicVolumeUnit(selection.context.unit),onFixSelection:()=>navigateStep('robots'),prepareFleet:prepareEconomicsFleet,fleetBasis:Object.fromEntries(selection.candidates.filter(c=>c.calculation?.unrounded_quantity).map(c=>[c.product_id,c.calculation!.unrounded_quantity])),recommend:async(inputs,bindings)=>api(`/projects/${project.id}/recommendation`,{method:'POST',body:{project_updated_at:version,selection:selection.options,inputs,bindings,accept_assumptions:true}}),equipment:Object.fromEntries(selection.candidates.filter(c=>c.equipment).map(c=>[c.product_id,c.equipment!.inputs])),quantities:Object.fromEntries(selection.candidates.filter(c=>c.quantity!==null).map(c=>[c.product_id,c.quantity!])),saveBlockedReason:comparison.products.some(p=>!selection.candidates.some(c=>c.product_id===p.id&&c.status!=='excluded'&&c.quantity!==null))?'Не хватает объёма операций, часов работы или производительности робота. Заполните недостающие данные примерами кнопкой ниже — количество рассчитается автоматически.':undefined,save:async(inputs,bindings)=>{
      if(project.is_demo) throw new Error('Скопируйте демо-проект в свои проекты для сохранения расчётов.');
      const result=await api<{project_updated_at:string}>(`/projects/${project.id}/economics`,{method:'POST',body:{project_updated_at:version,selection:selection.options,inputs,bindings,accept_assumptions:true}});
      setVersion(result.project_updated_at);history.reload();
    }}}/></div>}
    {project.is_demo && <p>Демо доступно для подбора и расчёта. Для сохранения создайте свою копию на странице параметров проекта.</p>}
    {step==='simulation'&&<SimulationPanel onSetup={()=>navigateStep('setup')} projectId={project.id} version={version} isDemo={project.is_demo} selection={selection} saved={history.data??[]}/>}
    <section hidden={step!=='history'} className="card project-card economics model-panel"><span className="model-eyebrow">ВАШИ РЕЗУЛЬТАТЫ</span><h2>Сохранённые расчёты</h2>
      <p>Последние 50 запусков. Исходные данные и результаты сохраняются как снимок; изменение каталога не переписывает историю.</p>
      {history.error ? <ErrorState message={history.error.message} onRetry={history.reload}/> : history.loading ? <Spinner label="Загружаем расчёты…"/> : !history.data?.length ? <p>Сохранённых расчётов пока нет.</p> : history.data.map(run=><details key={run.id} className="economics__draft"><summary>{new Date(run.created_at).toLocaleString('ru-RU')} · {run.results.results.map(r=>r.name).join(', ')}</summary>
        {run.stale&&<p>Параметры объекта изменились после расчёта. Выполните подбор заново.</p>}
        <EconomicsResults result={run.results} savedUrl={`/projects/${project.id}/calculations/${run.id}/export.xlsx`} title={`${project.name} — расчёт от ${new Date(run.created_at).toLocaleString('ru-RU')}`}/><details><summary>Снимок подбора и входных данных</summary><pre className="selection-snapshot">{JSON.stringify(run.inputs,null,2)}</pre></details>
      </details>)}
    </section>
  </div>;
}

function RateForm({candidate,initial,busy,apply}:{candidate:Candidate;initial?:{value:number;reason:string};busy:boolean;apply:(rate:{value:number;reason:string})=>void}) {
  const [value,setValue]=useState(initial?String(initial.value):'');
  const [reason,setReason]=useState(initial?.reason??'');
  return <details><summary>Уточнить производительность</summary><form onSubmit={e=>{e.preventDefault();apply({value:Number(value),reason});}}><fieldset disabled={busy} className="economics__fieldset selection-fields">
    {candidate.capacity_example&&<button type="button" className="btn btn--ghost" onClick={()=>{setValue(String(candidate.capacity_example!.value));setReason(candidate.capacity_example!.reason);}}>Заполнить примерную производительность</button>}
    <label>Производительность, {candidate.unit}<input type="number" required min="0.001" max="100000000" step="any" value={value} onChange={e=>setValue(e.target.value)}/></label>
    <label>Источник или обоснование<input required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button className="btn btn--ghost" type="submit">Применить и пересчитать</button>
  </fieldset></form></details>;
}

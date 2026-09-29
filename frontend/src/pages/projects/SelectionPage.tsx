import { useState, type FormEvent } from "react";
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
  decision?:string;reasons:string[];missing:string[];excluded:string[];risks?:string[];score:number;score_factors:Record<string,number>;
  calculation?:{peak_hourly_demand:number;required_rate_with_reserve:number;effective_throughput:number;unrounded_quantity:number}|null};
type Selection = {formula:string;model_version:string;project_updated_at:string;options:Options;parameters:Project['parameters'];
  context:{daily_demand:number|null;hours_per_day:number|null;peak_factor:number;unit:string;missing:string[];assumptions:string[]}; candidates:Candidate[]};
type Saved = {id:string;created_at:string;stale:boolean;inputs:unknown;results:EconomicsResponse};
type Facility = {id:number;processes:{id:number;name:string}[]};

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
  function change(patch:Partial<Options>) {setOptions(o=>({...o,...patch}));setSelection(null);setComparison(null);setSelected([]);setError("");}
  async function select(e?:FormEvent, next=options) {
    e?.preventDefault();setBusy(true);setError("");setComparison(null);setSelected([]);setSelection(null);
    try {const result=await api<Selection>(`/projects/${project.id}/selection`,{method:"POST",body:next});setSelection(result);setVersion(result.project_updated_at);setRevision(r=>r+1);}
    catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function openEconomics() {
    setBusy(true);setError("");
    try {setComparison(await api<Comparison>(`/catalog/compare?${selected.map(id=>`ids=${id}`).join('&')}`));}
    catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  const common:Record<string,string> = {};
  if(selection?.context.hours_per_day) common.hours_per_day=String(selection.context.hours_per_day);
  for(const key of ['horizon_years','working_days_per_year']) {
    const value=Number((selection?.parameters??project.parameters)[key]);
    if(Number.isFinite(value) && value>0) common[key==='working_days_per_year'?'days_per_year':key]=String(value);
  }
  return <div className="page selection-page">
    <Link to={`/projects/${project.id}`}>← Параметры проекта</Link>
    <header className="page-header"><div><h1>Подбор и экономика</h1><p>{project.name}</p></div></header>
    {!!project.missing_required.length && <div className="card project-card" role="alert"><p>До расчёта заполните обязательные параметры объекта: осталось {project.missing_required.length}.</p><Link className="btn btn--primary" to={`/projects/${project.id}`}>Заполнить параметры</Link></div>}
    <section id="selection-inputs" className="card project-card"><h2>1. Процесс и нагрузка</h2>
      <p>Подбор использует сохранённые параметры объекта. Количество рассчитывается отдельно для выбранного процесса. Решения ниже — альтернативы, их эффект нельзя складывать.</p>
      <form onSubmit={select}><fieldset disabled={busy || !!project.missing_required.length} className="economics__fieldset">
        <div className="selection-fields">
          <label>Процесс<select value={options.process_id} onChange={e=>change({process_id:Number(e.target.value),throughput_overrides:{},daily_demand:undefined,hours_per_day:undefined,peak_factor:undefined,demand_reason:""})}>{processes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {([['utilization','Коэффициент загрузки',.01,1],['availability','Техническая доступность',.01,1],['reserve_percent','Резерв парка, %',0,100],['daily_demand','Объём в сутки (пусто — из объекта)',.01,1e9],['hours_per_day','Часы в сутки (пусто — из объекта)',.01,24],['peak_factor','Пиковый коэффициент (пусто — из объекта)',1,10]] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" step="any" min={min} max={max} required={['utilization','availability','reserve_percent'].includes(key)} value={options[key]??''} onChange={e=>change({[key]:e.target.value===''?undefined:Number(e.target.value)})}/></label>)}
          <label>Обоснование изменения нагрузки / режима / коэффициентов<input maxLength={1000} value={options.demand_reason} onChange={e=>change({demand_reason:e.target.value})}/></label>
        </div><EquipmentFields value={options.equipment} onChange={equipment=>change({equipment})}/><button className="btn btn--primary" disabled={!options.process_id} type="submit">{busy?'Подбираем…':'Подобрать решения и рассчитать парк'}</button>
      </fieldset></form>
    </section>
    {error && <p role="alert" className="economics__error">{error}</p>}
    {selection && <><section className="card project-card"><h2>2. Результаты подбора</h2>
      <p>{selection.formula}</p><p>Объём: {selection.context.daily_demand??'не указан'} в сутки · Производительность: {selection.context.unit} · Режим: {selection.context.hours_per_day??'не указан'} ч/сутки · Пик: {selection.context.peak_factor}</p>
      <ul>{[...selection.context.missing,...selection.context.assumptions].map((n,i)=><li key={i}>{n}</li>)}</ul>
      <p>Сначала применяются блокирующие ограничения, затем решения ранжируются по совместимости, проверкам, расчётности парка и качеству данных. Балл не является гарантией пригодности.</p>
      {!selection.candidates.length && <p>В опубликованном каталоге нет решений для этого процесса.</p>}
    </section>
    <div className="selection-candidates">{selection.candidates.map(c=><article className="card project-card" key={c.product_id}>
      <h3><Link to={`/products/${c.product_id}`}>{c.name}</Link></h3>
      <p>{c.status==='excluded'?'Исключено':c.status==='suitable'?'Предварительно подходит':'Требуется проверка'} · {c.score}/100</p>
      {c.decision&&<p>{c.decision}</p>}
      <strong>Количество роботов: {c.quantity??'недостаточно данных'}</strong><p>Производительность: {c.throughput??'не указана'} {c.unit}</p>
      {c.calculation&&<p>Пиковая потребность: {c.calculation.peak_hourly_demand.toLocaleString('ru-RU')} {c.unit}; эффективная производительность робота: {c.calculation.effective_throughput.toLocaleString('ru-RU')} {c.unit}; до округления: {c.calculation.unrounded_quantity.toLocaleString('ru-RU')}.</p>}
      {c.equipment&&<EquipmentTable plan={c.equipment}/>}
      <details><summary>Причины, ограничения, риски и рейтинг</summary><ul>{[...c.reasons,...c.excluded,...c.missing,...(c.risks??[])].map((v,i)=><li key={i}>{v}</li>)}</ul><dl>{Object.entries(c.score_factors).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details>
      {c.status!=='excluded' && <RateForm key={`${c.product_id}-${revision}`} candidate={c} initial={options.throughput_overrides[c.product_id]} busy={busy} apply={rate=>{const next={...options,throughput_overrides:{...options.throughput_overrides,[c.product_id]:rate}};setOptions(next);void select(undefined,next);}}/>}
      <label className="selection-candidate-choice"><input type="checkbox" disabled={busy || c.status==='excluded' || (!selected.includes(c.product_id)&&selected.length>=6)} checked={selected.includes(c.product_id)} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,c.product_id]:ids.filter(id=>id!==c.product_id));setComparison(null);}}/><span>В экономическую оценку
        {c.quantity===null&&c.status!=='excluded'&&<small>Количество не рассчитано — задайте его вручную в экономической модели.</small>}
        {c.status==='excluded'&&<small>Исключённое решение нельзя добавить в расчёт.</small>}
      </span></label>
    </article>)}</div>
    <button className="btn btn--primary" disabled={busy||!selected.length} onClick={openEconomics}>Рассчитать экономику выбранных ({selected.length}/6)</button></>}
    {comparison && selection && <EconomicsPanel key={`${revision}-${comparison.products.map(p=>p.id).join(',')}`} data={comparison} project={{common,equipment:Object.fromEntries(selection.candidates.filter(c=>c.equipment).map(c=>[c.product_id,c.equipment!.inputs])),quantities:Object.fromEntries(selection.candidates.filter(c=>c.quantity!==null).map(c=>[c.product_id,c.quantity!])),saveBlockedReason:selection.candidates.some(c=>selected.includes(c.product_id)&&c.quantity===null)?'Для сохранения и имитации нужен рассчитанный парк. Заполните объём и часы работы в блоке «Процесс и нагрузка», затем повторите подбор.':undefined,save:async(inputs,bindings)=>{
      if(project.is_demo) throw new Error('Скопируйте демо-проект в свои проекты для сохранения расчётов.');
      const result=await api<{project_updated_at:string}>(`/projects/${project.id}/economics`,{method:'POST',body:{project_updated_at:version,selection:selection.options,inputs,bindings,accept_assumptions:true}});
      setVersion(result.project_updated_at);history.reload();
    }}}/>}
    {project.is_demo && <p>Демо доступно для подбора и расчёта. Для сохранения создайте свою копию на странице параметров проекта.</p>}
    <SimulationPanel projectId={project.id} version={version} isDemo={project.is_demo} selection={selection} saved={history.data??[]}/>
    <section className="card project-card economics"><h2>Сохранённые расчёты</h2>
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
    <label>Производительность, {candidate.unit}<input type="number" required min="0.001" max="100000000" step="any" value={value} onChange={e=>setValue(e.target.value)}/></label>
    <label>Источник или обоснование<input required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button className="btn btn--ghost" type="submit">Применить и пересчитать</button>
  </fieldset></form></details>;
}

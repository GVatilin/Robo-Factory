import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bot, Check, Copy, Save, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams, useBlocker } from "react-router";
import { api, ApiError } from "../../api/client";
import { useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthContext";
import { Field, Input, TextArea } from "../../ui/Field";
import { ErrorState, Spinner } from "../../ui/Controls";
import { FacilityIcon, ProjectWorkflow, type Facility, type Project } from "./ProjectsPage";
import ParameterImport from "./ParameterImport";
import ProjectScenarioComparison from "./ProjectScenarioComparison";
import "./Projects.css";

type Parameter = { facility_type_id: number; code: string; name: string; section: string | null; unit: string | null; data_type: string;
  is_required: boolean; default_value: string | number | boolean | null; min_value: number | null; max_value: number | null;
  allowed_values: string[] | null; hint: string | null; example: string | null; source: string | null; source_type?: string; source_url?: string; source_note: string | null };

export default function ProjectPage() {
  const { id } = useParams();
  const { user, loading } = useAuth();
  const facilities = useApi<Facility[]>("/reference/facility-types");
  const project = useApi<Project>(id ? `/projects/${id}` : null);
  const [selected, setSelected] = useState(0);
  const facilityId = id ? project.data?.facility_type_id : (selected || facilities.data?.find(f=>f.code==="warehouse")?.id || facilities.data?.[0]?.id);
  const definitions = useApi<Parameter[]>(facilityId ? `/projects/parameters/${facilityId}` : null);
  if (loading) return <div className="page"><Spinner label="Загружаем…"/></div>;
  if (!id && !user) return <div className="page"><h1>Новый проект</h1><Link to="/login" state={{from:"/projects/new"}}>Войдите, чтобы создать проект</Link></div>;
  const error=project.error || facilities.error || definitions.error;
  if(error) return <div className="page"><ErrorState message={error.message} onRetry={()=>{project.reload();facilities.reload();definitions.reload();}}/></div>;
  if(!facilities.data || !definitions.data || definitions.loading || (id && (project.loading || !project.data))) return <div className="page"><Spinner label="Загружаем параметры объекта…"/></div>;
  // Do not render the previous facility's cached fields during a type switch.
  if(definitions.data.some(d=>d.facility_type_id!==facilityId)) return <div className="page"><Spinner label="Загружаем параметры выбранного типа…"/></div>;
  return <ProjectForm key={`${id || "new"}-${facilityId}-${user?.id}`} project={id ? project.data! : null} definitions={definitions.data}
    facilities={facilities.data} facilityId={facilityId!} onFacility={setSelected} loggedIn={!!user}/>;
}

function ProjectForm({project, definitions, facilities, facilityId, onFacility, loggedIn}: {
  project: Project | null; definitions: Parameter[]; facilities: Facility[]; facilityId: number;
  onFacility: (id:number)=>void; loggedIn:boolean;
}) {
  const navigate=useNavigate();
  const [name,setName]=useState(project?.name ?? "Новый проект");
  const [description,setDescription]=useState(project?.description ?? "");
  const [values,setValues]=useState<Record<string,string|number|boolean>>(project?.parameters ?? {});
  const [version,setVersion]=useState(project?.updated_at);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [fields,setFields]=useState<Record<string,string>>({});
  const readOnly=!!project?.is_demo;
  const blocker=useBlocker(dirty && !busy);
  useEffect(()=>{
    if(!dirty) return;
    const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",prevent);return ()=>window.removeEventListener("beforeunload",prevent);
  },[dirty]);
  const missing=definitions.filter(d=>d.is_required && (values[d.code]===undefined || values[d.code]===""));
  const requiredTotal=definitions.filter(d=>d.is_required).length;
  const requiredFilled=requiredTotal-missing.length;
  const facility=facilities.find(f=>f.id===facilityId);
  const facilityHints: Record<string,string>={
    warehouse:"Площади, хранение, SKU, потоки паллет, маршруты и персонал.",
    airport:"Пассажиры, багаж и грузы, зоны операций, маршруты и безопасность.",
    medical:"Корпуса и этажи, доставки, лифты, санитарные требования и доступ.",
  };
  function selectFacility(next:number) {
    if(next===facilityId)return;
    if(!dirty || window.confirm("Сменить тип объекта и сбросить введённые данные?"))onFacility(next);
  }
  const groups=Array.from(new Set(definitions.map(d=>d.section || "Общие параметры")));
  function change(code:string,value:string|number|boolean) {setValues(s=>({...s,[code]:value}));setDirty(true);setMessage("");setFields(s=>({...s,[`parameters.${code}`]:""}));}
  async function save(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");setFields({});setMessage("");
    try {
      const body={name,description:description||null,parameters:values,...(project ? {updated_at:version} : {facility_type_id:facilityId})};
      const saved=await api<Project>(project ? `/projects/${project.id}` : "/projects",{method:project?"PUT":"POST",body});
      setDirty(false);setVersion(saved.updated_at);setValues(saved.parameters);setMessage("Проект сохранён");
      if(!project) navigate(`/projects/${saved.id}`,{replace:true});
    } catch(e) {const failure=e as ApiError;setError(failure.message);setFields(failure.fields??{});}
    finally {setBusy(false);}
  }
  async function copy() {
    setBusy(true);setError("");
    try {const copied=await api<Project>(`/projects/${project!.id}/copy`,{method:"POST"});setDirty(false);navigate(`/projects/${copied.id}`);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function remove() {
    if(!window.confirm(`Удалить проект «${name}» и связанные данные?`))return;
    setBusy(true);setError("");
    try {await api(`/projects/${project!.id}`,{method:"DELETE"});setDirty(false);navigate("/projects");}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function checkParameters() {
    setBusy(true);setError("");setFields({});setMessage("");
    try {
      await api(`/projects/parameters/${facilityId}/validate`,{method:"POST",body:{parameters:values}});
      setMessage("Параметры корректны: обязательные поля заполнены, типы и диапазоны проверены.");
    } catch(e) {
      const failure=e as ApiError;setError("Исправьте параметры, отмеченные ниже.");setFields(failure.fields??{});
      if(!Object.keys(failure.fields??{}).length)setError(failure.message);
      for(const path of Object.keys(failure.fields??{})) {
        const element=document.getElementById(`param-${path.replace("parameters.","")}`);
        element?.closest("details")?.setAttribute("open","");
      }
    }finally{setBusy(false);}
  }
  return <div className="page project-editor">
    <Link className="project-back" to="/projects"><ArrowLeft size={16} aria-hidden="true" />Все проекты</Link>
    <header className="page-header projects-hero project-editor__hero"><div className="projects-hero__copy">
      <p className="page-header__eyebrow">Паспорт объекта</p><h1>{project ? name : "Создание проекта"}</h1>
      <p className="project-editor__facility"><FacilityIcon code={facility?.code} size={20} />{facility?.name}
        {readOnly && <span className="project-status project-status--demo">Демо-проект</span>}</p>
      <p className="projects-hero__description">Опишите объект и его нагрузку. Эти данные используются для подбора роботов и расчёта экономики.</p>
    </div>{project && <Link className="btn btn--primary" to={`/projects/${project.id}/selection`}><Bot size={18} aria-hidden="true" />Подбор и экономика<ArrowRight size={17} aria-hidden="true" /></Link>}</header>
    <ProjectWorkflow current={1} />
    {!project && <section className="card project-card project-facility-picker" aria-label="Выбор типа объекта">
      <div className="project-section-heading"><h2>Для какого объекта создаём проект?</h2><p>У каждого типа свой набор параметров и свой шаблон импорта.</p></div>
      <div className="project-facility-options">{facilities.map(f=><button type="button" key={f.id} className={f.id===facilityId?"is-selected":undefined} aria-pressed={f.id===facilityId} disabled={busy} onClick={()=>selectFacility(f.id)}>
        <FacilityIcon code={f.code}/><strong>{f.name}</strong><span>{facilityHints[f.code] || "Параметры и ограничения выбранного объекта."}</span>
      </button>)}</div>
    </section>}
    <div className="project-parameter-scope" role="status"><strong>{facility?.name}: {definitions.length} параметров</strong><span>{requiredTotal} обязательных · {definitions.length-requiredTotal} дополнительных. Значения сохраняются только в этом проекте.</span></div>
    {blocker.state==="blocked" && <div className="card project-card" role="alert"><p>Есть несохранённые изменения.</p><button className="btn btn--ghost" onClick={()=>blocker.reset()}>Продолжить редактирование</button><button className="btn btn--ghost" onClick={()=>blocker.proceed()}>Уйти без сохранения</button></div>}
    {error && <p role="alert" className="project-feedback project-feedback--error">{error}</p>}
    {message && <p role="status" className="project-feedback project-feedback--success"><Check size={18} aria-hidden="true" />{message}</p>}
    {readOnly && <div className="project-demo-notice"><div><strong>Готовый пример для знакомства с платформой</strong><p>Изучите параметры и подбор. Чтобы изменить данные и сохранить свои расчёты, создайте копию проекта.</p></div>
      {loggedIn ? <button type="button" className="btn btn--primary" disabled={busy} onClick={copy}><Copy size={17} aria-hidden="true" />Создать свой проект из демо</button>
        : <Link className="btn btn--primary" to="/login" state={{from:`/projects/${project!.id}`}}>Войти и скопировать</Link>}
    </div>}
    <div className="projects-actions">
      {project && loggedIn && !readOnly && <button type="button" className="btn btn--ghost" disabled={busy||dirty} onClick={copy}><Copy size={16} aria-hidden="true" />Создать копию</button>}
      <Link className="btn btn--ghost" to={`/robots?facility_type_id=${facilityId}`}>Роботы для этого типа объекта</Link>
      {project && !readOnly && <button type="button" className="btn btn--danger-ghost project-delete" disabled={busy} onClick={remove}><Trash2 size={16} aria-hidden="true" />Удалить проект</button>}
    </div>
    <section className="project-completeness" aria-label="Заполнение параметров"><div><strong>Готовность исходных данных</strong>
      <p>{missing.length ? `Осталось обязательных параметров: ${missing.length}. Можно сохранить проект как черновик.` : requiredTotal ? "Обязательные параметры заполнены. Проверьте допущения при подборе роботов." : "Обязательные параметры для этого объекта не определены."}</p></div>
      {requiredTotal > 0 && <div className="project-completeness__meter"><span><strong>{requiredFilled}</strong> / {requiredTotal}</span><progress value={requiredFilled} max={requiredTotal} aria-label={`Заполнено ${requiredFilled} из ${requiredTotal} обязательных параметров`} /></div>}
      {!!missing.length && <details className="project-missing"><summary>Какие обязательные поля остались?</summary><ul>{missing.map(d=><li key={d.code}><button type="button" onClick={()=>{const el=document.getElementById(`param-${d.code}`);el?.closest("details")?.setAttribute("open","");el?.focus();el?.scrollIntoView({block:"center",behavior:"smooth"});}}>{d.name}</button></li>)}</ul></details>}
    </section>
    <ParameterImport facilityId={facilityId} projectId={project?.id} values={values} readOnly={readOnly} disabled={busy}
      onApply={imported=>{setValues(imported);setDirty(true);setFields({});setError("");setMessage("Параметры перенесены в форму. Сохраните проект.");}}/>
    {!readOnly && <div className="projects-actions"><button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>void checkParameters()}><Check size={17}/>Проверить параметры</button></div>}
    {!definitions.length && <p role="alert">Параметры этого типа объекта пока не загружены. Обратитесь к администратору.</p>}
    <form onSubmit={save} onInvalid={e=>(e.target as HTMLElement).closest("details")?.setAttribute("open","")}>
      {!readOnly && <div className="project-savebar"><div><strong>{dirty ? "Есть несохранённые изменения" : project ? "Изменения сохранены" : "Новый проект"}</strong>
        <span>{project && version ? `Последнее сохранение: ${new Date(version).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}` : "Сохраните объект, чтобы перейти к подбору роботов"}</span></div>
        <button className="btn btn--primary" disabled={busy || (!!project && !dirty)} type="submit"><Save size={17} aria-hidden="true" />{busy?"Сохраняем…":missing.length?"Сохранить черновик":"Сохранить проект"}</button>
      </div>}
      <fieldset className="project-fieldset" disabled={busy||readOnly}>
        <div className="card project-card">
          <div className="project-section-heading"><h2>Об объекте</h2><p>Название и краткое описание задачи роботизации.</p></div>
          <Field label="Название проекта" htmlFor="project-name" required error={fields.name}><Input id="project-name" required maxLength={300} value={name} onChange={e=>{setName(e.target.value);setDirty(true);setMessage("");}}/></Field>
          <Field label="Описание" htmlFor="project-description"><TextArea id="project-description" maxLength={5000} value={description} onChange={e=>{setDescription(e.target.value);setDirty(true);setMessage("");}}/></Field>
          {!readOnly && <div className="project-defaults"><p>Для первого расчёта можно использовать типовые значения, затем заменить их данными вашего объекта.</p><button type="button" className="btn btn--ghost" onClick={()=>{if((dirty || Object.keys(values).length > 0) && !window.confirm("Заменить параметры значениями по умолчанию?"))return;setValues(Object.fromEntries(definitions.filter(d=>d.default_value!==null).map(d=>[d.code,d.default_value!])));setDirty(true);setMessage("");}}>Заполнить значениями по умолчанию</button></div>}
        </div>
        {groups.map((group,index)=><details key={group} className="card project-card" open={index===0 || undefined}>
          <summary><span>{group}</span><small>{definitions.filter(d=>(d.section||"Общие параметры")===group && values[d.code]!==undefined && values[d.code]!=="").length} / {definitions.filter(d=>(d.section||"Общие параметры")===group).length} заполнено</small></summary><div className="project-fields">{definitions.filter(d=>(d.section||"Общие параметры")===group).map(d=>{
            const id=`param-${d.code}`;const value=values[d.code];
            return <Field key={d.code} htmlFor={id} label={d.name} required={d.is_required} error={fields[`parameters.${d.code}`]}
              aside={<details className="parameter-source"><summary>Источник и допущения</summary><div><strong>{d.source_type==="team_assumption" ? "Допущение команды" : d.source_type==="organizer" ? "Данные организатора — справочный пример" : d.source_type==="regulation" ? "Нормативный документ" : "Справочные данные"}</strong><p>{d.source || "Источник не указан"}</p>{d.source_url && /^https?:\/\//.test(d.source_url) && <a href={d.source_url} target="_blank" rel="noreferrer">Открыть источник</a>}{d.source_note && <p>{d.source_note}</p>}<p>{d.default_value===null?"Значение по умолчанию не задано: введите данные объекта.":"Значение по умолчанию справочное. Уточните его для своего объекта."}</p></div></details>}
              hint={<>{d.hint} {d.unit && `Единица: ${d.unit}. `}{d.min_value!==null && `Минимум: ${d.min_value}. `}{d.max_value!==null && `Максимум: ${d.max_value}. `}
                {d.default_value!==null && `По умолчанию: ${typeof d.default_value==="boolean" ? d.default_value ? "Да" : "Нет" : String(d.default_value)}. `}</>}>
              {d.data_type==="boolean" ? <select id={id} value={value===undefined||value===""?"":String(value)} onChange={e=>change(d.code,e.target.value===""?"":e.target.value==="true")}><option value="">Не указано</option><option value="true">Да</option><option value="false">Нет</option></select>
              : d.data_type==="enum" ? <select id={id} value={String(value??"")} onChange={e=>change(d.code,e.target.value)}><option value="">Не указано</option>{d.allowed_values?.map(v=><option key={v} value={v}>{v}</option>)}</select>
              : <Input id={id} type={d.data_type==="number"||d.data_type==="integer"?"number":"text"} min={d.min_value??undefined} max={d.max_value??undefined} maxLength={2000} step={d.data_type==="integer"?"1":"any"} value={String(value??"")} unit={d.unit} placeholder={d.example??undefined}
                onChange={e=>change(d.code,e.target.type==="number"&&e.target.value!==""?Number(e.target.value):e.target.value)}/>}
            </Field>;
          })}</div>
        </details>)}
      </fieldset>
    </form>
    {project && <><section className="card project-card project-next-step"><div><p className="page-header__eyebrow">Следующий шаг</p><h2>Подберите роботов под ваш объект</h2><p>Сравните покупку и RaaS, сохраните экономику и выгрузите отчёт. Подбор использует сохранённые параметры проекта.</p></div><Link className="btn btn--primary" to={`/projects/${project.id}/selection`}>Подбор роботов и экономика<ArrowRight size={17} aria-hidden="true" /></Link></section>
      <ProjectScenarioComparison key={version} projectId={project.id}/></>}
  </div>;
}

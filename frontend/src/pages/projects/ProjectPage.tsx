import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bot, Check, Copy, Download, Save, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams, useBlocker } from "react-router";
import { api, ApiError, getToken } from "../../api/client";
import { useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthContext";
import { Field, Input, TextArea } from "../../ui/Field";
import { ErrorState, Spinner } from "../../ui/Controls";
import { FacilityIcon, ProjectWorkflow, type Facility, type Project } from "./ProjectsPage";
import ProjectScenarioComparison from "./ProjectScenarioComparison";
import "./Projects.css";

type Parameter = { code: string; name: string; section: string | null; unit: string | null; data_type: string;
  is_required: boolean; default_value: string | number | boolean | null; min_value: number | null; max_value: number | null;
  allowed_values: string[] | null; hint: string | null; example: string | null; source: string | null; source_note: string | null };

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
  async function downloadTemplate() {
    setError("");
    try {
      const token=getToken();
      const response=await fetch(`/api/v1/projects/${project!.id}/parameters/template`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
      if(!response.ok)throw new Error("Не удалось скачать шаблон. Обновите страницу и повторите.");
      const url=URL.createObjectURL(await response.blob());const link=document.createElement("a");
      link.href=url;link.download="project-parameters.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e){setError((e as Error).message);}
  }
  async function importFile(file:File) {
    setError("");setFields({});setMessage("");
    if(file.size>2_000_000){setError("Размер файла должен быть не больше 2 МБ.");return;}
    setBusy(true);
    try {
      const body=new FormData();body.append("file",file);body.append("updated_at",version!);
      const saved=await api<Project>(`/projects/${project!.id}/parameters/import`,{method:"POST",body});
      setValues(saved.parameters);setVersion(saved.updated_at);setDirty(false);setMessage("Параметры загружены и сохранены");
    } catch(e){const failure=e as ApiError;setError(failure.fields?.file || failure.message);setFields(failure.fields??{});}
    finally{setBusy(false);}
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
    </section>
    {project && <details className="card project-card project-import"><summary><span>Параметры из файла</span><small>CSV / Excel</small></summary>
      <div className="project-import__content"><p>Скачайте шаблон, заполните значения и загрузите файл обратно. Поддерживаются CSV UTF-8 и Excel (.xlsx), до 2 МБ.</p>
        <p>Сохраняйте коды параметров и единицы измерения. Пустая ячейка очищает значение, пропущенная строка оставляет его прежним.</p>
        <div className="projects-actions"><button className="btn btn--ghost" type="button" disabled={busy} onClick={downloadTemplate}><Download size={17} aria-hidden="true" />Скачать шаблон CSV</button></div>
        {!readOnly && <div className="project-import__upload"><label htmlFor="project-import">Загрузить параметры CSV / Excel</label>
          <input id="project-import" type="file" accept=".csv,.xlsx" disabled={busy||dirty} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void importFile(file);}}/>
          {dirty && <p>Перед загрузкой файла сохраните введённые изменения.</p>}</div>}
      </div>
    </details>}
    {!definitions.length && <p role="alert">Параметры этого типа объекта пока не загружены. Обратитесь к администратору.</p>}
    <form onSubmit={save} onInvalid={e=>(e.target as HTMLElement).closest("details")?.setAttribute("open","")}>
      {!readOnly && <div className="project-savebar"><div><strong>{dirty ? "Есть несохранённые изменения" : project ? "Изменения сохранены" : "Новый проект"}</strong>
        <span>{project && version ? `Последнее сохранение: ${new Date(version).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}` : "Сохраните объект, чтобы перейти к подбору роботов"}</span></div>
        <button className="btn btn--primary" disabled={busy || (!!project && !dirty)} type="submit"><Save size={17} aria-hidden="true" />{busy?"Сохраняем…":"Сохранить проект"}</button>
      </div>}
      <fieldset className="project-fieldset" disabled={busy||readOnly}>
        <div className="card project-card">
          <div className="project-section-heading"><h2>Об объекте</h2><p>Название и краткое описание задачи роботизации.</p></div>
          {!project && <Field label="Тип объекта" htmlFor="project-facility"><select id="project-facility" value={facilityId} onChange={e=>{if(!dirty || window.confirm("Сменить тип объекта и сбросить введённые данные?"))onFacility(Number(e.target.value));}}>{facilities.map(f=><option value={f.id} key={f.id}>{f.name}</option>)}</select></Field>}
          <Field label="Название проекта" htmlFor="project-name" required error={fields.name}><Input id="project-name" required maxLength={300} value={name} onChange={e=>{setName(e.target.value);setDirty(true);setMessage("");}}/></Field>
          <Field label="Описание" htmlFor="project-description"><TextArea id="project-description" maxLength={5000} value={description} onChange={e=>{setDescription(e.target.value);setDirty(true);setMessage("");}}/></Field>
          {!readOnly && <div className="project-defaults"><p>Для первого расчёта можно использовать типовые значения, затем заменить их данными вашего объекта.</p><button type="button" className="btn btn--ghost" onClick={()=>{if((dirty || Object.keys(values).length > 0) && !window.confirm("Заменить параметры значениями по умолчанию?"))return;setValues(Object.fromEntries(definitions.filter(d=>d.default_value!==null).map(d=>[d.code,d.default_value!])));setDirty(true);setMessage("");}}>Заполнить значениями по умолчанию</button></div>}
        </div>
        {groups.map((group,index)=><details key={group} className="card project-card" open={index===0 || undefined}>
          <summary><span>{group}</span><small>{definitions.filter(d=>(d.section||"Общие параметры")===group && values[d.code]!==undefined && values[d.code]!=="").length} / {definitions.filter(d=>(d.section||"Общие параметры")===group).length} заполнено</small></summary><div className="project-fields">{definitions.filter(d=>(d.section||"Общие параметры")===group).map(d=>{
            const id=`param-${d.code}`;const value=values[d.code];
            return <Field key={d.code} htmlFor={id} label={d.name} required={d.is_required} error={fields[`parameters.${d.code}`]}
              hint={<>{d.hint} {d.unit && `Единица: ${d.unit}. `}{d.min_value!==null && `Минимум: ${d.min_value}. `}{d.max_value!==null && `Максимум: ${d.max_value}. `}
                {d.default_value!==null && `По умолчанию: ${typeof d.default_value==="boolean" ? d.default_value ? "Да" : "Нет" : String(d.default_value)}. `}{d.source && `Источник: ${d.source}. `}{d.source_note}</>}>
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

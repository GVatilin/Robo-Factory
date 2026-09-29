import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import { Field, Input } from "../ui/Field";
import { ErrorState, Spinner } from "../ui/Controls";
import "./projects/Projects.css";

type Ref = { id: number; name: string };
type Source = { id: number; title: string; source_type: string };
type Definition = {
  code: string; name: string; section: string | null; data_type: string; unit: string | null;
  is_required: boolean; default_value: unknown; min_value: number | null; max_value: number | null;
  allowed_values: string[] | null; hint: string | null; source_id: number | null;
  source_note: string | null; sort_order: number;
};
const empty = {code:"",name:"",section:"Дополнительные параметры",data_type:"number",unit:"",is_required:false,
  defaultText:"",minText:"",maxText:"",allowedText:"",hint:"",source_id:0,source_note:"",sort_order:1000};
const types = {number:"Число",integer:"Целое число",string:"Текст",boolean:"Да / нет",enum:"Список",dimensions:"Габариты Д×Ш×В"};
const sourceTypes: Record<string,string> = {team_assumption:"Допущение команды",organizer:"Данные организатора",regulation:"Нормативный документ",user_input:"Данные объекта",public_spec:"Техническая документация"};

export default function ObjectReferencesPage() {
  const [version,setVersion]=useState(0);
  const facilities=useApi<Ref[]>(`/reference/facility-types?v=${version}`);
  const industries=useApi<Ref[]>("/reference/industries");
  const sources=useApi<Source[]>(`/reference/parameter-sources?v=${version}`);
  const [facility,setFacility]=useState(1);
  const definitions=useApi<Definition[]>(`/projects/parameters/${facility}?v=${version}`);
  const [draft,setDraft]=useState({...empty});
  const [editing,setEditing]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [object,setObject]=useState({code:"",name:"",industry_id:0,description:""});
  const [source,setSource]=useState({title:"",source_type:"team_assumption",url:"",notes:""});
  async function perform(action:()=>Promise<unknown>,done:()=>void) {
    setBusy(true);setError("");setMessage("");
    try {await action();done();setVersion(v=>v+1);setMessage("Изменения сохранены. Формы и шаблоны используют обновлённый справочник.");}
    catch(e){const failure=e as ApiError;setError([failure.message,...Object.values(failure.fields??{})].join(" "));}
    finally{setBusy(false);}
  }
  function edit(d:Definition) {
    setEditing(d.code);setDraft({...empty,...d,section:d.section??"Дополнительные параметры",unit:d.unit??"",hint:d.hint??"",
      source_id:d.source_id??0,source_note:d.source_note??"",defaultText:d.default_value==null?"":String(d.default_value),
      minText:d.min_value==null?"":String(d.min_value),maxText:d.max_value==null?"":String(d.max_value),allowedText:(d.allowed_values??[]).join("\n")});
  }
  function save(e:FormEvent) {
    e.preventDefault();const numeric=["number","integer"].includes(draft.data_type);
    const defaultValue=draft.defaultText===""?null:numeric?Number(draft.defaultText):draft.data_type==="boolean"?draft.defaultText==="true":draft.defaultText;
    if(numeric && draft.defaultText!=="" && !Number.isFinite(defaultValue)){setError("Введите конечное число по умолчанию.");return;}
    const payload={code:draft.code,name:draft.name,section:draft.section,data_type:draft.data_type,unit:draft.unit||null,is_required:draft.is_required,
      default_value:defaultValue,min_value:numeric&&draft.minText!==""?Number(draft.minText):null,max_value:numeric&&draft.maxText!==""?Number(draft.maxText):null,
      allowed_values:draft.data_type==="enum"?draft.allowedText.split("\n").map(s=>s.trim()).filter(Boolean):null,
      hint:draft.hint||null,source_id:draft.source_id,source_note:draft.source_note||null,sort_order:draft.sort_order};
    void perform(()=>api(`/reference/facility-types/${facility}/parameters${editing?`/${editing}`:""}`,{method:editing?"PUT":"POST",body:payload}),()=>{setEditing(null);setDraft({...empty});});
  }
  if(facilities.error||sources.error||industries.error)return <div className="page"><ErrorState message="Не удалось загрузить справочники"/></div>;
  if(!facilities.data||!sources.data||!industries.data)return <div className="page"><Spinner/></div>;
  return <div className="page projects-page"><header className="page-header"><h1>Справочники объектов</h1><p>Типы объектов, параметры форм, единицы измерения и источники значений.</p></header>
    {error&&<p role="alert" className="card">{error}</p>}{message&&<p role="status" className="card">{message}</p>}
    <details className="card project-card"><summary>Добавить тип объекта</summary><form onSubmit={e=>{e.preventDefault();void perform(()=>api("/reference/facility-types",{method:"POST",body:object}),()=>setObject({code:"",name:"",industry_id:0,description:""}));}}>
      <Field label="Название"><Input required value={object.name} onChange={e=>setObject({...object,name:e.target.value})}/></Field>
      <Field label="Код латиницей"><Input required pattern="[a-z][a-z0-9_]{1,63}" value={object.code} onChange={e=>setObject({...object,code:e.target.value})}/></Field>
      <Field label="Отрасль"><select required value={object.industry_id||""} onChange={e=>setObject({...object,industry_id:Number(e.target.value)})}><option value="">Выберите отрасль</option>{industries.data.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Описание"><Input value={object.description} onChange={e=>setObject({...object,description:e.target.value})}/></Field>
      <button className="btn btn--primary" disabled={busy}>Добавить тип</button><p>Для нового типа сначала добавьте параметры. Правила автоматического подбора для новой отрасли настраиваются отдельно.</p>
    </form></details>
    <details className="card project-card"><summary>Добавить источник</summary><form onSubmit={e=>{e.preventDefault();void perform(()=>api("/reference/parameter-sources",{method:"POST",body:{...source,url:source.url||null}}),()=>setSource({...source,title:"",url:"",notes:""}));}}>
      <Field label="Название документа или основания"><Input required value={source.title} onChange={e=>setSource({...source,title:e.target.value})}/></Field>
      <Field label="Тип источника"><select value={source.source_type} onChange={e=>setSource({...source,source_type:e.target.value})}>{Object.entries(sourceTypes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Ссылка на документ"><Input type="url" value={source.url} onChange={e=>setSource({...source,url:e.target.value})}/></Field>
      <Field label="Обоснование и ограничения"><Input value={source.notes} onChange={e=>setSource({...source,notes:e.target.value})}/></Field>
      <button className="btn btn--primary" disabled={busy}>Добавить источник</button>
    </form></details>
    <section className="card project-card"><Field label="Тип объекта"><select value={facility} disabled={busy} onChange={e=>{setFacility(Number(e.target.value));setEditing(null);setDraft({...empty});}}>{facilities.data.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <h2>{editing?"Редактирование параметра":"Добавить параметр"}</h2>
      <form onSubmit={save}><fieldset disabled={busy} className="project-fieldset"><div className="project-fields">
        <Field label="Название"><Input required maxLength={300} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field>
        <Field label="Код латиницей"><Input required disabled={!!editing} pattern="[a-z][a-z0-9_]{1,99}" value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value})}/></Field>
        <Field label="Раздел формы"><Input required value={draft.section} onChange={e=>setDraft({...draft,section:e.target.value})}/></Field>
        <Field label="Тип значения"><select disabled={!!editing} value={draft.data_type} onChange={e=>setDraft({...draft,data_type:e.target.value,defaultText:""})}>{Object.entries(types).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Единица измерения"><Input disabled={!!editing} value={draft.unit} onChange={e=>setDraft({...draft,unit:e.target.value})}/></Field>
        <Field label="Значение по умолчанию">{draft.data_type==="boolean"?<select value={draft.defaultText} onChange={e=>setDraft({...draft,defaultText:e.target.value})}><option value="">Не задано</option><option value="true">Да</option><option value="false">Нет</option></select>:<Input value={draft.defaultText} onChange={e=>setDraft({...draft,defaultText:e.target.value})}/>}</Field>
        {["number","integer"].includes(draft.data_type)&&<><Field label="Минимум"><Input type="number" step="any" value={draft.minText} onChange={e=>setDraft({...draft,minText:e.target.value})}/></Field><Field label="Максимум"><Input type="number" step="any" value={draft.maxText} onChange={e=>setDraft({...draft,maxText:e.target.value})}/></Field></>}
        {draft.data_type==="enum"&&<Field label="Варианты — каждый с новой строки"><textarea required value={draft.allowedText} onChange={e=>setDraft({...draft,allowedText:e.target.value})}/></Field>}
        <Field label="Источник"><select required value={draft.source_id||""} onChange={e=>setDraft({...draft,source_id:Number(e.target.value)})}><option value="">Выберите источник</option>{sources.data.map(r=><option key={r.id} value={r.id}>{sourceTypes[r.source_type]??"Справочные данные"}: {r.title}</option>)}</select></Field>
        <Field label="Допущения для этого параметра"><Input value={draft.source_note} onChange={e=>setDraft({...draft,source_note:e.target.value})}/></Field>
        <Field label="Подсказка"><Input value={draft.hint} onChange={e=>setDraft({...draft,hint:e.target.value})}/></Field>
        <Field label="Порядок отображения"><Input type="number" min={0} max={100000} value={draft.sort_order} onChange={e=>setDraft({...draft,sort_order:Number(e.target.value)})}/></Field>
      </div><label><input type="checkbox" checked={draft.is_required} onChange={e=>setDraft({...draft,is_required:e.target.checked})}/> Обязательный параметр</label>
      <div className="projects-actions"><button className="btn btn--primary">{editing?"Сохранить параметр":"Добавить параметр"}</button>{editing&&<button type="button" className="btn btn--ghost" onClick={()=>{setEditing(null);setDraft({...empty});}}>Отмена</button>}</div></fieldset></form>
    </section>
    <section className="card project-card"><h2>Параметры объекта ({definitions.data?.length??0})</h2>{definitions.loading?<Spinner/>:definitions.error?<ErrorState message="Не удалось загрузить параметры"/>:<div>{definitions.data?.map(d=><div className="project-savebar" key={d.code}><div><strong>{d.name}</strong><p>{d.section} · {d.unit||"без единицы"} · {d.is_required?"обязательный":"дополнительный"}</p></div><button disabled={busy} className="btn btn--ghost" onClick={()=>edit(d)}>Редактировать</button></div>)}</div>}</section>
  </div>;
}

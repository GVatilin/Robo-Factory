import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import { Field, Input } from "../ui/Field";
import { ErrorState, Spinner } from "../ui/Controls";
import { BookOpen, Building2, FileText, Plus, Search, Sparkles, Pencil, Check, X } from "lucide-react";
import { Link } from "react-router";
import "./projects/Projects.css";
import "./references/References.css";

type Ref = { id: number; name: string; description?:string; code?:string };
type Source = { id: number; title: string; source_type: string; url?:string|null };
type Definition = {
  code: string; name: string; section: string | null; data_type: string; unit: string | null;
  is_required: boolean; default_value: unknown; min_value: number | null; max_value: number | null;
  allowed_values: string[] | null; hint: string | null; source_id: number | null;
  source_note: string | null; sort_order: number;
};
const empty = {code:"",name:"",section:"Дополнительные параметры",data_type:"number",unit:"",is_required:false,
  defaultText:"",minText:"",maxText:"",allowedText:"",hint:"",source_id:0,source_note:"",sort_order:1000};
const types = {number:"Число",integer:"Целое число",string:"Текст",boolean:"Да / нет",enum:"Список",dimensions:"Габариты Д×Ш×В"};
const sourceTypes: Record<string,string> = {manufacturer:"Производитель",integrator:"Интегратор",marketplace:"Торговая площадка",review:"Обзор",case_study:"Реализованный кейс",team_assumption:"Допущение команды",organizer:"Данные организатора",regulation:"Нормативный документ",user_input:"Данные объекта",public_spec:"Техническая документация"};

export default function ObjectReferencesPage() {
  const [version,setVersion]=useState(0);
  const facilities=useApi<Ref[]>(`/reference/facility-types?v=${version}`);
  const industries=useApi<Ref[]>("/reference/industries");
  const sources=useApi<Source[]>(`/reference/parameter-sources?v=${version}`);
  const [facility,setFacility]=useState(1);
  const [tab,setTab]=useState('parameters');
  const [search,setSearch]=useState('');
  const [section,setSection]=useState('all');
  const [showEditor,setShowEditor]=useState(false);
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
    setShowEditor(true);setEditing(d.code);setTab('parameters');setTimeout(()=>document.getElementById('reference-editor')?.scrollIntoView({block:'start',behavior:'smooth'}),0);setDraft({...empty,...d,section:d.section??"Дополнительные параметры",unit:d.unit??"",hint:d.hint??"",
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
    void perform(()=>api(`/reference/facility-types/${facility}/parameters${editing?`/${editing}`:""}`,{method:editing?"PUT":"POST",body:payload}),()=>{setEditing(null);setDraft({...empty});setShowEditor(false);});
  }
  if(facilities.error||sources.error||industries.error)return <div className="page"><ErrorState message="Не удалось загрузить справочники"/></div>;
  if(!facilities.data||!sources.data||!industries.data)return <div className="page"><Spinner/></div>;
  const selectedFacility=facilities.data.find(f=>f.id===facility);
  const sections=[...new Set((definitions.data??[]).map(d=>d.section||"Без раздела"))];
  const shown=(definitions.data??[]).filter(d=>(section==='all'||(d.section||'Без раздела')===section)&&`${d.name} ${d.code} ${d.unit??''}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
  const displayValue=(value:unknown)=>value==null?'Не задано':typeof value==='boolean'?value?'Да':'Нет':String(value);
  return <div className="page refs-page">
    <header className="refs-hero"><div className="refs-hero__icon"><BookOpen size={30}/></div><div><span className="refs-eyebrow">УПРАВЛЕНИЕ ДАННЫМИ</span><h1>Справочники объектов</h1><p>Настройте формы проектов: типы объектов, параметры и источники данных.</p></div><button type="button" className="btn btn--primary" disabled={busy} onClick={()=>setTab('import')}><Sparkles size={17}/>Добавить решение с GPT</button></header>
    <nav className="refs-tabs" aria-label="Разделы справочника">{[{id:'parameters',label:'Параметры',icon:BookOpen},{id:'objects',label:'Типы объектов',icon:Building2},{id:'sources',label:'Источники',icon:FileText},{id:'import',label:'Импорт решений',icon:Sparkles}].map(t=><button type="button" key={t.id} disabled={busy} aria-current={tab===t.id?'page':undefined} onClick={()=>{setTab(t.id);setSearch('');}}><t.icon size={18}/>{t.label}</button>)}</nav>
    {error&&<div role="alert" className="refs-feedback refs-feedback--error">{error}</div>}{message&&<div role="status" className="refs-feedback"><Check size={18}/>{message}</div>}
    {tab==='parameters'&&<section className="card refs-context"><div><span className="refs-eyebrow">ВЫБРАННЫЙ ОБЪЕКТ</span><label>Тип объекта<select value={facility} disabled={busy} onChange={e=>{setFacility(Number(e.target.value));setEditing(null);setDraft({...empty});setShowEditor(false);setSection('all');setSearch('');}}>{facilities.data.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div><div className="refs-stat"><strong>{definitions.loading?'…':definitions.data?.length??0}</strong><span>параметров</span></div><div className="refs-stat"><strong>{definitions.loading?'…':definitions.data?.filter(d=>d.is_required).length??0}</strong><span>обязательных</span></div><p>Изменения применяются к новым формам и шаблонам этого типа объекта.</p></section>}
    {tab==='parameters'&&<>
      {showEditor&&<section id="reference-editor" className="card refs-editor">      <div className="refs-editor__heading"><h2>{editing?"Редактирование параметра":"Новый параметр"}</h2><button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>setShowEditor(false)}><X size={16}/>Закрыть</button></div><p className="refs-muted">Поле появится в форме проекта и шаблоне Excel для выбранного объекта.</p>
      <form onSubmit={save}><fieldset disabled={busy} className="project-fieldset"><div className="refs-fields">
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
      <div className="projects-actions"><button className="btn btn--primary">{editing?"Сохранить параметр":"Добавить параметр"}</button>{editing&&<button type="button" className="btn btn--ghost" onClick={()=>{setEditing(null);setDraft({...empty});setShowEditor(false);}}>Отмена</button>}</div></fieldset></form>
    </section>
}
      <section className="card refs-list"><div className="refs-list__heading"><div><h2>Параметры · {selectedFacility?.name}</h2><p className="refs-muted">Найдите поле, чтобы посмотреть его значение и источник или изменить настройки.</p></div><button type="button" className="btn btn--primary" disabled={busy} onClick={()=>{setEditing(null);setDraft({...empty});setShowEditor(true);setTimeout(()=>document.getElementById('reference-editor')?.scrollIntoView({block:'start',behavior:'smooth'}),0);}}><Plus size={17}/>Добавить параметр</button></div>
      <div className="refs-filters"><label className="refs-search"><Search size={18}/><input aria-label="Поиск параметров" placeholder="Название, код или единица измерения" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Раздел формы" value={section} onChange={e=>setSection(e.target.value)}><option value="all">Все разделы</option>{sections.map(v=><option key={v}>{v}</option>)}</select></div>
      {definitions.loading?<Spinner/>:definitions.error?<ErrorState message="Не удалось загрузить параметры" onRetry={definitions.reload}/>:!shown.length?<div className="refs-empty"><BookOpen size={28}/><h3>Параметры не найдены</h3><p>Измените поиск или добавьте новое поле вручную либо через GPT.</p></div>:<div className="refs-parameter-list">{shown.map(d=><article className="refs-parameter" key={d.code}><div><span className="refs-tag">{d.section||'Без раздела'}</span><h3>{d.name}</h3><p>{types[d.data_type as keyof typeof types]??d.data_type}{d.unit?` · ${d.unit}`:''} · <span className={d.is_required?'refs-required':''}>{d.is_required?'Обязательный':'Дополнительный'}</span></p><details><summary>Источник и правила заполнения</summary><dl><div><dt>Источник</dt><dd>{sources.data?.find(s=>s.id===d.source_id)?.title??'Не указан'}</dd></div><div><dt>Код</dt><dd>{d.code}</dd></div>{d.min_value!==null&&<div><dt>Минимум</dt><dd>{d.min_value}</dd></div>}{d.max_value!==null&&<div><dt>Максимум</dt><dd>{d.max_value}</dd></div>}</dl>{d.allowed_values&&<p>Варианты: {d.allowed_values.join(', ')}</p>}{d.hint&&<p>{d.hint}</p>}{d.source_note&&<p>{d.source_note}</p>}</details></div><div className="refs-default"><small>По умолчанию</small><strong>{displayValue(d.default_value)}</strong></div><button type="button" disabled={busy} className="btn btn--ghost" onClick={()=>edit(d)}><Pencil size={15}/>Изменить</button></article>)}</div>}</section>
    </>}
    {tab==='objects'&&<div className="refs-split"><section className="card refs-list"><h2>Типы объектов</h2><p className="refs-muted">У каждого типа — свой набор полей и шаблон загрузки.</p>{facilities.data.map(f=><article className="refs-source" key={f.id}><Building2 size={20}/><div><h3>{f.name}</h3><p>{f.description||'Отдельный набор параметров объекта'}</p></div><button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>{setFacility(f.id);setTab('parameters');setSection('all');setSearch('');setShowEditor(false);}}>Параметры</button></article>)}</section>    <section className="card refs-editor"><h2>Новый тип объекта</h2><p className="refs-muted">Например, производственный цех или гостиница. Затем добавьте параметры его формы.</p><form onSubmit={e=>{e.preventDefault();void perform(()=>api("/reference/facility-types",{method:"POST",body:object}),()=>setObject({code:"",name:"",industry_id:0,description:""}));}}>
      <Field label="Название"><Input required value={object.name} onChange={e=>setObject({...object,name:e.target.value})}/></Field>
      <Field label="Код латиницей"><Input required pattern="[a-z][a-z0-9_]{1,63}" value={object.code} onChange={e=>setObject({...object,code:e.target.value})}/></Field>
      <Field label="Отрасль"><select required value={object.industry_id||""} onChange={e=>setObject({...object,industry_id:Number(e.target.value)})}><option value="">Выберите отрасль</option>{industries.data.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Описание"><Input value={object.description} onChange={e=>setObject({...object,description:e.target.value})}/></Field>
      <button className="btn btn--primary" disabled={busy}>Добавить тип</button><p>Для нового типа сначала добавьте параметры. Правила автоматического подбора для новой отрасли настраиваются отдельно.</p>
    </form></section>
</div>}
    {tab==='sources'&&<div className="refs-split"><section className="card refs-list"><h2>Источники данных</h2><p className="refs-muted">Документы, нормативы и явные допущения для параметров объектов.</p><label className="refs-search"><Search size={18}/><input aria-label="Поиск источников" placeholder="Найти документ или источник" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="refs-sources">{sources.data.filter(s=>s.title.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))).map(s=><article className="refs-source" key={s.id}><FileText size={19}/><div><span className="refs-tag">{sourceTypes[s.source_type]??s.source_type}</span><h3>{s.title}</h3>{s.url&&<a href={s.url} target="_blank" rel="noreferrer">Открыть источник ↗</a>}</div></article>)}</div></section><section className="card refs-editor"><h2>Новый источник</h2><p className="refs-muted">Укажите документ или основание, откуда взяты параметры и значения.</p><form onSubmit={e=>{e.preventDefault();void perform(()=>api("/reference/parameter-sources",{method:"POST",body:{...source,url:source.url||null}}),()=>setSource({...source,title:"",url:"",notes:""}));}}>
      <Field label="Название документа или основания"><Input required value={source.title} onChange={e=>setSource({...source,title:e.target.value})}/></Field>
      <Field label="Тип источника"><select value={source.source_type} onChange={e=>setSource({...source,source_type:e.target.value})}>{Object.entries(sourceTypes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Ссылка на документ"><Input type="url" value={source.url} onChange={e=>setSource({...source,url:e.target.value})}/></Field>
      <Field label="Обоснование и ограничения"><Input value={source.notes} onChange={e=>setSource({...source,notes:e.target.value})}/></Field>
      <button className="btn btn--primary" disabled={busy}>Добавить источник</button>
    </form></section>
</div>}
    {tab==='import'&&<section className="card refs-import-intro"><div className="refs-hero__icon"><Sparkles size={30}/></div><span className="refs-eyebrow">КАТАЛОГ РОБОТОВ</span><h2>Добавьте решение из документа</h2><p>Загрузите таблицу или вставьте текст технического паспорта. GPT распознает модели и характеристики, а вы проверите данные в обычной форме товара.</p><ol className="refs-steps"><li><span>1</span><strong>Документ</strong><small>XLSX, CSV, TXT или текст</small></li><li><span>2</span><strong>Предпросмотр</strong><small>Выбор модели и проверка источника</small></li><li><span>3</span><strong>Карточка решения</strong><small>Редактирование и сохранение</small></li></ol><div className="projects-actions"><Link to="/products/new?import=gpt" className="btn btn--primary"><Sparkles size={17}/>Загрузить решение через GPT</Link><Link to="/products/new" className="btn btn--ghost"><Plus size={17}/>Добавить вручную</Link></div><p className="refs-muted">Автоматический разбор помогает заполнить карточку. Публикацией и изменениями управляет администратор.</p></section>}
  </div>;
}

import { useState } from 'react';
import { FileText, Sparkles, Upload, ArrowRight, Check, FileUp } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import GptRequestProgress from '../solutions/GptRequestProgress';
import '../solutions/EconomicsPanel.css';
import './ProductAiImport.css';

export type ImportedProduct = {name:string;manufacturer:string;purpose:string;description:string;country:string;limitations:string;
  solution_type_id:number|null;process_ids:number[];quote:string;duplicate_ids:number[];
  specs:{code:string;name:string;value:string|null;value_max:string|null;text:string|null;flag:boolean|null;unit:string|null;note:string;quote:string}[]};
export type ImportedSource={source_type:string;title:string;url:string|null;retrieved_at:string};
type Preview={products:ImportedProduct[];notes:string[];source:ImportedSource;model:string};

export default function ProductAiImport({initialOpen,disabled,onApply}:{initialOpen:boolean;disabled:boolean;onApply:(product:ImportedProduct,source:ImportedSource)=>boolean}) {
  const [open,setOpen]=useState(initialOpen);
  const [mode,setMode]=useState<'file'|'text'>('file');
  const [file,setFile]=useState<File|null>(null);
  const [text,setText]=useState('');
  const [title,setTitle]=useState('');
  const [url,setUrl]=useState('');
  const [sourceType,setSourceType]=useState('public_spec');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [applied,setApplied]=useState('');
  const [dragging,setDragging]=useState(false);
  function chooseFile(next:File) {
    setError('');setPreview(null);setApplied('');setFile(null);
    if(!/\.(xlsx|csv|txt)$/i.test(next.name)||next.size===0||next.size>2_000_000){setError('Выберите непустой XLSX, CSV или TXT до 2 МБ.');return;}
    setFile(next);if(!title||title===file?.name)setTitle(next.name);
  }
  async function parse() {
    setBusy(true);setError('');setPreview(null);setApplied('');
    try {
      const body=new FormData();
      if(mode==='file'&&file)body.append('file',file);else body.append('text',text);
      body.append('source_title',title.trim());body.append('source_url',url.trim());body.append('source_type',sourceType);
      setPreview(await api<Preview>('/catalog-import/preview',{method:'POST',body}));
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="ai-import" aria-labelledby="ai-import-title">
    <div className="ai-import__heading"><div className="ai-import__mark"><Sparkles size={24}/></div><div><span className="ai-import__eyebrow">БЫСТРОЕ ДОБАВЛЕНИЕ</span><h2 id="ai-import-title">Заполнить карточку из документа</h2><p>GPT извлечёт модели и характеристики. Вы проверите и дополните их перед сохранением.</p></div><button type="button" className="btn btn--ghost" disabled={busy||disabled} onClick={()=>setOpen(v=>!v)}>{open?'Свернуть':'Открыть импорт'}</button></div>
    {open&&<div className="ai-import__body">
      <ol className="ai-import__steps"><li className={!preview?'is-active':''}><span>1</span>Загрузите данные</li><li className={preview&&!applied?'is-active':''}><span>2</span>Выберите модель</li><li className={applied?'is-active':''}><span>3</span>Проверьте и сохраните</li></ol>
      <div className="ai-import__grid"><div>
        <div className="ai-import__modes"><button type="button" disabled={busy||disabled} aria-pressed={mode==='file'} onClick={()=>{setMode('file');setPreview(null);}}><Upload size={16}/>Файл</button><button type="button" disabled={busy||disabled} aria-pressed={mode==='text'} onClick={()=>{setMode('text');setPreview(null);}}><FileText size={16}/>Вставить текст</button></div>
        {mode==='file'?<label className={`ai-import__drop ${dragging?'is-dragging':''}`} onDragOver={e=>{e.preventDefault();if(!busy&&!disabled)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!busy&&!disabled&&e.dataTransfer.files[0])chooseFile(e.dataTransfer.files[0]);}}><FileUp size={32}/><strong>{file?.name??'Выберите файл или перетащите сюда'}</strong><span>XLSX, CSV или TXT · до 2 МБ</span><small>До 25 000 символов. Таблицы Excel — без формул.</small><input aria-label="Документ для разбора GPT" type="file" accept=".xlsx,.csv,.txt" disabled={busy||disabled} onChange={e=>{if(e.target.files?.[0])chooseFile(e.target.files[0]);e.target.value='';}}/></label>:<label className="ai-import__text">Текст технического паспорта или страницы производителя<textarea disabled={busy||disabled} maxLength={25000} rows={9} value={text} onChange={e=>{setText(e.target.value);setPreview(null);}} placeholder="Вставьте описание модели и таблицу характеристик…"/><small>{text.length.toLocaleString('ru-RU')} / 25 000 символов</small></label>}
      </div><div className="ai-import__source"><h3>Откуда взяты данные?</h3><label>Документ или страница<input value={title} maxLength={500} disabled={busy||disabled} onChange={e=>{setTitle(e.target.value);setPreview(null);}} placeholder="Технический паспорт модели"/></label><label>Ссылка на оригинал<input type="url" value={url} maxLength={1000} disabled={busy||disabled} onChange={e=>{setUrl(e.target.value);setPreview(null);}} placeholder="https://производитель.ru/модель"/></label><label>Тип источника<select value={sourceType} disabled={busy||disabled} onChange={e=>{setSourceType(e.target.value);setPreview(null);}}><option value="public_spec">Техническая документация</option><option value="manufacturer">Сайт производителя</option><option value="integrator">Материалы интегратора</option><option value="case_study">Реализованный кейс</option></select></label><small>Ссылка сохранится как источник. Для разбора загрузите документ или вставьте его текст.</small></div></div>
      <div className="ai-import__actions"><button type="button" className="btn btn--primary" disabled={busy||disabled||!title.trim()||(mode==='file'?!file:!text.trim())} onClick={()=>void parse()}><Sparkles size={17}/>{busy?'Разбираем документ…':'Распознать через GPT'}</button><GptRequestProgress active={busy} complete={!!preview} failed={!!error} task="import"/></div>
      <p className="ai-import__note">Содержимое отправляется в настроенный сервис GPT через сервер. До 5 моделей за запрос, ожидание до 50 секунд. Результат можно исправить вручную.</p>
      {error&&<div role="alert" className="ai-import__error">{error}</div>}
      {applied&&<div role="status" className="ai-import__success"><Check size={18}/><span>«{applied}» перенесён в форму ниже. Проверьте производителя, тип решения, характеристики и публикацию, затем нажмите «Сохранить».</span></div>}
      {preview&&<div className="ai-import__preview"><h3>Распознано моделей: {preview.products.length}</h3>{!!preview.notes.length&&<details open><summary>Что проверить и дополнить</summary><ul>{preview.notes.map((n,i)=><li key={i}>{n}</li>)}</ul></details>}{!preview.products.length&&<p>Подходящих моделей не найдено. Вставьте фрагмент с названием робота и его характеристиками либо заполните карточку вручную.</p>}<div className="ai-import__products">{preview.products.map((p,i)=><article key={`${p.name}-${i}`}><span className="ai-import__eyebrow">{p.manufacturer||'Производитель не указан'}</span><h3>{p.name}</h3><p>{p.purpose||p.description}</p><span className="ai-import__count">{p.specs.length} характеристик с цитатами</span>{!p.country&&<p>Страну происхождения нужно уточнить.</p>}{!!p.duplicate_ids.length&&<p className="ai-import__duplicate">Похожее название уже есть: {p.duplicate_ids.map(id=><Link key={id} to={`/products/${id}`} target="_blank">карточка №{id} ↗ </Link>)}</p>}<details><summary>Посмотреть извлечённые значения</summary><blockquote>{p.quote}</blockquote>{p.specs.map(s=><div className="ai-import__spec" key={s.code}><strong>{s.name}</strong><span>{s.flag!==null?(s.flag?'Да':'Нет'):s.value!==null?`${s.value}${s.value_max!==null?' – '+s.value_max:''}`:s.text} {s.unit}</span><small>«{s.quote}»</small></div>)}</details><button type="button" className="btn btn--primary" disabled={busy||disabled} onClick={()=>{if(onApply(p,preview.source))setApplied(p.name);}}>Заполнить карточку <ArrowRight size={16}/></button></article>)}</div><p className="ai-import__note">Данные не опубликованы. Все распознанные характеристики требуют проверки; неизвестные значения остаются пустыми.</p></div>}
    </div>}
  </section>;
}

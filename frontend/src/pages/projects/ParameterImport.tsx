import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { api, ApiError, getToken } from "../../api/client";

type Values = Record<string, string | number | boolean>;
type Preview = {parameters: Values; ready: boolean; missing_required: {code:string;name:string}[];
  rows: {code:string;name:string;unit:string|null;value:string|number|boolean|null}[]};

export default function ParameterImport({facilityId, projectId, values, readOnly, disabled, onApply}: {
  facilityId:number;projectId?:string;values:Values;readOnly:boolean;disabled:boolean;
  onApply:(values:Values)=>void;
}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null);
  const [snapshot,setSnapshot]=useState("");
  const [fileName,setFileName]=useState("");
  async function download(format:"xlsx"|"csv") {
    setBusy(true);setError("");
    try {
      const token=getToken();
      const path=projectId?`/projects/${projectId}/parameters/template`:`/projects/parameters/${facilityId}/template`;
      const response=await fetch(`/api/v1${path}?format=${format}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
      if(!response.ok)throw new Error("Не удалось скачать шаблон. Повторите попытку.");
      const url=URL.createObjectURL(await response.blob());const link=document.createElement("a");
      link.href=url;link.download=`project-parameters.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function previewFile(file:File) {
    setError("");setPreview(null);
    if(!/\.(csv|xlsx)$/i.test(file.name)||!file.size||file.size>2_000_000){setError("Выберите непустой CSV или XLSX до 2 МБ.");return;}
    const current=JSON.stringify(values);setBusy(true);
    try {
      const body=new FormData();body.append("file",file);body.append("parameters",current);
      const result=await api<Preview>(`/projects/parameters/${facilityId}/preview`,{method:"POST",body});
      setPreview(result);setSnapshot(current);setFileName(file.name);
    }catch(e){const failure=e as ApiError;setError([failure.message,...Object.values(failure.fields??{})].filter((s,i,a)=>a.indexOf(s)===i).join(" "));}
    finally{setBusy(false);}
  }
  const stale=snapshot!==JSON.stringify(values);
  return <details className="card project-card project-import"><summary><span>Загрузить параметры из Excel / CSV</span><small>Шаблон и проверка файла</small></summary>
    <div className="project-import__content"><p>Скачайте шаблон для этого типа объекта и заполните колонку value. Колонки code и unit сохраняйте: единицы, типы и диапазоны проверяются при загрузке.</p>
      <p>Пустое значение очищает поле; отсутствующая строка оставляет прежнее. Шаблон содержит обязательность, диапазоны, значения по умолчанию и их источники. До 2 МБ, без формул.</p>
      <div className="projects-actions">{(["xlsx","csv"] as const).map(format=><button type="button" key={format} className="btn btn--ghost" disabled={disabled||busy} onClick={()=>void download(format)}><Download size={16}/>Скачать {format.toUpperCase()}</button>)}</div>
      {!readOnly && <label className="project-import__upload"><span><Upload size={16}/> Загрузить и проверить таблицу</span><input type="file" accept=".csv,.xlsx" disabled={disabled||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void previewFile(file);}}/></label>}
      {busy && <p role="status">Обрабатываем файл…</p>}
      {error && <p role="alert" className="project-feedback--error">{error}</p>}
      {preview && <div className="parameter-preview"><h3>Предпросмотр: {fileName}</h3><p>{preview.rows.length} строк прошли проверку типов, единиц и диапазонов.</p>
        <div className="parameter-preview__table"><table><thead><tr><th>Параметр</th><th>Значение после импорта</th><th>Единица</th></tr></thead><tbody>{preview.rows.map(row=><tr key={row.code}><td>{row.name}</td><td>{row.value===null?"Очистить":typeof row.value==="boolean"?row.value?"Да":"Нет":String(row.value)}</td><td>{row.unit||"—"}</td></tr>)}</tbody></table></div>
        <p>{preview.ready?"Обязательные параметры будут заполнены.":`Не заполнено обязательных параметров: ${preview.missing_required.length}. Можно применить данные и продолжить заполнение.`}</p>
        {!!preview.missing_required.length && <ul>{preview.missing_required.map(d=><li key={d.code}>{d.name}</li>)}</ul>}
        {stale && <p role="status">Форма изменилась. Загрузите файл ещё раз для актуального предпросмотра.</p>}
        <button type="button" className="btn btn--primary" disabled={disabled||busy||stale||readOnly} onClick={()=>{onApply(preview.parameters);setPreview(null);}}>Применить к форме</button>
        <p>После применения нажмите «Сохранить проект».</p>
      </div>}
    </div>
  </details>;
}

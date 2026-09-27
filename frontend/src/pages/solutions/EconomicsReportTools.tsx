import { useRef, useState } from "react";
import { api, getToken } from "../../api/client";
import { formatMoney, formatNumber } from "../../format";
import type { EconomicsResponse } from "./EconomicsPanel";

type Analysis = {model_version:string;spread_percent:number;assumptions:string[];
  rows:{factor:string;label:string;delta_percent:number;results:EconomicsResponse['results']}[]};

export default function EconomicsReportTools({result,savedUrl,title}:{result:EconomicsResponse;savedUrl?:string;title?:string}) {
  const [spread,setSpread]=useState("20");
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const root=useRef<HTMLDivElement>(null);
  const valid=Number(spread)>0&&Number(spread)<=50;
  async function analyze() {
    setBusy(true);setError("");setAnalysis(null);
    try {
      const data=await api<Analysis>('/economics/sensitivity',{method:'POST',body:{inputs:result.inputs,spread_percent:Number(spread)}});
      if(data.model_version!==result.model_version) throw new Error('Версия модели изменилась. Выполните новый расчёт для анализа чувствительности.');
      setAnalysis(data);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function excel() {
    setBusy(true);setError("");
    try {
      const token=getToken();
      const response=await fetch(`/api/v1${savedUrl??'/economics/export.xlsx'}`,{
        method:savedUrl?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},
        ...(savedUrl?{}:{body:JSON.stringify({inputs:result.inputs,spread_percent:Number(spread)})})});
      if(!response.ok) {const data=await response.json().catch(()=>null);throw new Error(typeof data?.detail==='string'?data.detail:`Не удалось скачать отчёт (${response.status}).`);}
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');link.href=url;link.download='robo-factory-report.xlsx';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  function print() {
    const source=root.current?.closest('.economics-report');
    if(!source) return;
    const clone=source.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.report-controls,button,input').forEach(n=>n.remove());
    clone.querySelectorAll('details').forEach(n=>n.setAttribute('open',''));
    const frame=document.createElement('iframe');
    frame.title='Печатный отчёт';frame.style.cssText='position:fixed;width:0;height:0;border:0;bottom:0';
    frame.setAttribute('sandbox','allow-same-origin allow-modals');
    document.body.appendChild(frame);
    const doc=frame.contentDocument;
    if(!doc) {frame.remove();setError('Не удалось открыть печатный отчёт.');return;}
    const style=doc.createElement('style');
    style.textContent='@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#152e40}h1{font-size:20px}h2,h3{break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:14px 0}th,td{border:1px solid #bbc7cf;padding:6px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}th{background:#eaf0f4}dl>div{margin:6px 0}dt{font-weight:bold}dd{margin-left:0}summary{font-weight:bold;margin-top:12px}.economics__scroll{overflow:visible}pre{white-space:pre-wrap;overflow-wrap:anywhere}';
    doc.head.appendChild(style);doc.title='Robo Factory — экономический отчёт';
    const heading=doc.createElement('h1');heading.textContent=title??'Robo Factory — экономический отчёт';doc.body.appendChild(heading);
    const note=doc.createElement('p');note.textContent='Альтернативные сценарии одного процесса. Сформировано '+new Date().toLocaleString('ru-RU');doc.body.appendChild(note);
    doc.body.appendChild(clone);
    frame.contentWindow?.addEventListener('afterprint',()=>frame.remove(),{once:true});
    setTimeout(()=>{frame.contentWindow?.focus();frame.contentWindow?.print();},150);
    setTimeout(()=>frame.remove(),300000);
  }
  return <div ref={root}>
    <div className="report-controls"><h3>Отчёт и what-if анализ</h3>
      <div className="projects-actions">
        <button type="button" className="btn btn--ghost" disabled={busy||(!savedUrl&&!valid)} onClick={excel}>Скачать Excel</button>
        <button type="button" className="btn btn--ghost" onClick={print}>Печать / сохранить PDF</button>
      </div>
      <p>Для PDF выберите «Сохранить как PDF» в окне печати. В Excel — исходные данные, статьи затрат, годовые потоки, формулы и чувствительность.{savedUrl&&' Для сохранённого расчёта Excel использует исходный снимок и диапазон ±20%.'}</p>
      <label>Диапазон изменения факторов, ±% <input aria-label="Диапазон чувствительности" type="number" min="1" max="50" step="any" value={spread} onChange={e=>{setSpread(e.target.value);setAnalysis(null);}} disabled={busy}/></label>{' '}
      <button type="button" className="btn btn--primary" disabled={busy||!valid} onClick={analyze}>{busy?'Обрабатываем…':'Рассчитать чувствительность'}</button>
      {error&&<p role="alert" className="economics__error">{error}</p>}
    </div>
    {analysis&&<section aria-live="polite"><h3>Чувствительность экономики: ±{analysis.spread_percent}%</h3>
      <ul>{analysis.assumptions.map(a=><li key={a}>{a}</li>)}</ul>
      {['labor','price','service'].map(factor=><details key={factor} className="economics__draft" open><summary>{analysis.rows.find(r=>r.factor===factor)?.label}</summary>
        <div className="economics__scroll"><table className="economics__table"><thead><tr><th>Сценарий</th><th>Изменение</th><th>TCO</th><th>Чистый эффект</th><th>Окупаемость</th><th>ROI</th></tr></thead>
          <tbody>{analysis.rows.filter(r=>r.factor===factor).flatMap(row=>row.results.map((r,i)=><tr key={`${row.delta_percent}-${i}`}><th>{r.name}</th><td>{row.delta_percent>0?'+':''}{row.delta_percent}%</td><td>{formatMoney(r.tco)}</td><td>{formatMoney(r.net_effect)}</td><td>{r.simple_payback_years===null?'Не определена':`${formatNumber(r.simple_payback_years)} лет`}</td><td>{r.roi_percent===null?'Не определён':`${formatNumber(r.roi_percent)}%`}</td></tr>))}</tbody>
        </table></div>
      </details>)}
    </section>}
  </div>;
}

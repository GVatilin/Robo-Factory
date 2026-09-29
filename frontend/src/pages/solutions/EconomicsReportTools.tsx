import { useState } from "react";
import { api, getToken } from "../../api/client";
import { formatMoney, formatNumber, formatPayback } from "../../format";
import type { EconomicsResponse, GptAdvice } from "./EconomicsPanel";

type Analysis = {model_version:string;spread_percent:number;assumptions:string[];
  rows:{factor:string;label:string;delta_percent:number;results:EconomicsResponse['results']}[]};

export default function EconomicsReportTools({result,savedUrl,title,advice}:{result:EconomicsResponse;savedUrl?:string;title?:string;advice?:GptAdvice|null}) {
  const [spread,setSpread]=useState("20");
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const valid=Number(spread)>0&&Number(spread)<=50;
  async function analyze() {
    setBusy(true);setError("");setAnalysis(null);
    try {
      const data=await api<Analysis>('/economics/sensitivity',{method:'POST',body:{inputs:result.inputs,spread_percent:Number(spread)}});
      if(data.model_version!==result.model_version) throw new Error('Версия модели изменилась. Выполните новый расчёт для анализа чувствительности.');
      setAnalysis(data);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function download(format:"xlsx"|"pdf") {
    setBusy(true);setError("");
    try {
      const token=getToken();
      const response=await fetch(`/api/v1${savedUrl?savedUrl.replace(/\.xlsx$/,'.'+format):'/economics/export.'+format}`,{
        method:savedUrl?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},
        ...(savedUrl?{}:{body:JSON.stringify({inputs:result.inputs,spread_percent:Number(spread),...(format==='pdf'?{title:title??"Экономика роботизации",recommendation:advice??null}:{})})})});
      if(!response.ok) {const data=await response.json().catch(()=>null);throw new Error(typeof data?.detail==='string'?data.detail:`Не удалось скачать отчёт (${response.status}).`);}
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');link.href=url;link.download='robo-factory-report.'+format;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <div>
    <div className="report-controls"><h3>Отчёт и устойчивость результата</h3>
      <div className="projects-actions">
        <button type="button" className="btn btn--ghost" disabled={busy||(!savedUrl&&!valid)} onClick={()=>void download('xlsx')}>Скачать Excel</button>
        <button type="button" className="btn btn--primary" disabled={busy||(!savedUrl&&!valid)} onClick={()=>void download('pdf')}>{busy?"Формируем файл…":"Скачать PDF"}</button>
      </div>
      <p>PDF скачивается готовым файлом: таблицы сценариев, расходы, денежные потоки, формулы, источники и чувствительность. Excel содержит данные для дальнейшей работы.{savedUrl&&' Для сохранённого расчёта отчёт использует исходный снимок и диапазон ±20%.'}</p>
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>{setSpread('20');setAnalysis(null);}}>По умолчанию: ±20%</button> <label>Насколько изменить цены, нагрузку и зарплаты, ±% <input aria-label="Диапазон чувствительности" type="number" min="1" max="50" step="any" value={spread} onChange={e=>{setSpread(e.target.value);setAnalysis(null);}} disabled={busy}/></label>{' '}
      <button type="button" className="btn btn--primary" disabled={busy||!valid} onClick={analyze}>{busy?'Обрабатываем…':'Рассчитать чувствительность'}</button>
      {error&&<p role="alert" className="economics__error">{error}</p>}
    </div>
    {analysis&&<section aria-live="polite"><h3>Чувствительность экономики: ±{analysis.spread_percent}%</h3>
      <ul>{analysis.assumptions.map(a=><li key={a}>{a}</li>)}</ul>
      {['labor','price','volume','service'].map(factor=><details key={factor} className="economics__draft" open><summary>{analysis.rows.find(r=>r.factor===factor)?.label}</summary>
        <div className="economics__scroll" tabIndex={0} role="region" aria-label="Таблица расчёта: прокрутка по горизонтали"><table className="economics__table"><thead><tr><th>Сценарий</th><th>Изменение</th><th>TCO</th><th>Чистый эффект</th><th>Окупаемость</th><th>ROI</th></tr></thead>
          <tbody>{analysis.rows.filter(r=>r.factor===factor).flatMap(row=>row.results.map((r,i)=><tr key={`${row.delta_percent}-${i}`}><th>{r.name}</th><td>{row.delta_percent>0?'+':''}{row.delta_percent}%</td><td>{formatMoney(r.tco)}</td><td>{formatMoney(r.net_effect)}</td><td>{r.simple_payback_years===null?'Не определена':formatPayback(r.simple_payback_years)}</td><td>{r.roi_percent===null?'Не определён':`${formatNumber(r.roi_percent)}%`}</td></tr>))}</tbody>
        </table></div>
      </details>)}
    </section>}
  </div>;
}

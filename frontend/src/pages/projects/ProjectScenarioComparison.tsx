import { Link } from "react-router";
import { useApi } from "../../api/hooks";
import { formatMoney, formatNumber } from "../../format";
import { ErrorState, Spinner } from "../../ui/Controls";
import "./ProjectScenarioComparison.css";

type Result = {capex:number;annual_opex:number;tco:number;net_effect:number;roi_percent:number|null;simple_payback_years:number|null};
type Scenario = {id:string;name:string;kind:string;quantity:number;product_names:string[];calculated_at:string;latest_result:Result};
type Group = {process_name:string;common:{horizon_years:number;hours_per_day:number;days_per_year:number};stale:boolean;baseline_annual_opex:number;baseline_tco:number;scenarios:Scenario[]};

export default function ProjectScenarioComparison({projectId}:{projectId:string}) {
  const response=useApi<{groups:Group[]}>(`/projects/${projectId}/scenario-comparison`);
  return <section className="card project-comparison" aria-labelledby="project-comparison-title">
    <div className="project-comparison__heading"><div><span className="project-comparison__eyebrow">ЭКОНОМИКА ПРОЕКТА</span><h2 id="project-comparison-title">Сравнение сохранённых сценариев</h2></div>
      <Link className="btn btn--ghost" to={`/projects/${projectId}/selection`}>Расчёты и отчёты →</Link></div>
    <p>Базовый процесс, покупка и RaaS — рядом. Для каждого сценария показан последний сохранённый расчёт. Разные процессы, параметры объекта или экономические предпосылки сравниваются в отдельных таблицах.</p>
    {response.loading?<Spinner label="Загружаем сценарии…"/>:response.error?<ErrorState message={response.error.message} onRetry={response.reload}/>:!response.data?.groups.length?<div className="project-comparison__empty">
      <h3>Сравнение появится после первого сохранённого расчёта</h3>
      <p>Подберите решение, включите покупку и RaaS, задайте цены и сохраните экономику. Вместе с базовым процессом получите три варианта для сравнения.</p>
      <Link className="btn btn--primary" to={`/projects/${projectId}/selection`}>Перейти к подбору</Link>
    </div>:response.data.groups.map((group,index)=><div className="project-comparison__group" key={index}>
      <h3>{group.process_name}</h3><p>{group.common.horizon_years} лет · {group.common.hours_per_day} ч/сутки · {group.common.days_per_year} дней/год</p>
      {group.stale&&<p className="project-comparison__notice">Параметры объекта изменились. Здесь сохранённый результат; для актуальной оценки выполните новый подбор.</p>}
      <div className="project-comparison__scroll" role="region" aria-label={`Сценарии: ${group.process_name}`} tabIndex={0}><table>
        <caption>Альтернативы одного процесса — экономический эффект не суммируется</caption>
        <thead><tr><th scope="col">Показатель</th><th scope="col">Без роботизации</th>{group.scenarios.map(s=><th scope="col" key={s.id}>{s.name}<small>{s.kind==='purchase'?'Покупка':s.kind==='raas'?'RaaS':'Сценарий'}</small></th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">Роботов</th><td>—</td>{group.scenarios.map(s=><td key={s.id}>{s.quantity}</td>)}</tr>
          {([['CAPEX','capex',0],['OPEX, в год','annual_opex',group.baseline_annual_opex],['TCO за горизонт','tco',group.baseline_tco],['Чистый эффект','net_effect',0]] as const).map(([label,key,base])=><tr key={key}><th scope="row">{label}</th><td>{formatMoney(base)}</td>{group.scenarios.map(s=><td key={s.id}>{formatMoney(s.latest_result[key])}</td>)}</tr>)}
          <tr><th scope="row">Окупаемость</th><td>—</td>{group.scenarios.map(s=><td key={s.id}>{s.latest_result.simple_payback_years===null?'Не определена':`${formatNumber(s.latest_result.simple_payback_years)} лет`}</td>)}</tr>
          <tr><th scope="row">ROI за горизонт</th><td>—</td>{group.scenarios.map(s=><td key={s.id}>{s.latest_result.roi_percent===null?'Не определён':`${formatNumber(s.latest_result.roi_percent)}%`}</td>)}</tr>
          <tr><th scope="row">Сохранён</th><td>В тех же предпосылках</td>{group.scenarios.map(s=><td key={s.id}>{new Date(s.calculated_at).toLocaleString('ru-RU')}</td>)}</tr>
        </tbody>
      </table></div>
    </div>)}
  </section>;
}

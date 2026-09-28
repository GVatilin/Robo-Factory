import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { Comparison } from "../../api/types";
import { formatMoney, formatNumber } from "../../format";
import { Field, Input } from "../../ui/Field";
import "./EconomicsPanel.css";
import EconomicsReportTools from "./EconomicsReportTools";
import {EquipmentTable, type EquipmentInput, type EquipmentPlan} from "../projects/Equipment";

type Values = Record<string, string>;
type Draft = { id: number; name: string; buy: boolean; rent: boolean; values: Values };
type Result = {
  name: string; mode: string; capex: number; annual_opex: number; annual_effect: number;
  tco: number; net_effect: number; simple_payback_years: number | null; roi_percent: number | null;
  capex_breakdown: Record<string, number>; opex_breakdown: Record<string, number>;
  years: { year: number; opex: number; replacement: number; cashflow: number; cumulative: number }[];
  equipment?: EquipmentPlan | null;
};
export type EconomicsResponse = {
  model_version: string; inputs: unknown; baseline_annual_opex: number; baseline_tco: number;
  results: Result[]; formulas: Record<string, string>; assumptions: string[];
};
type FieldSpec = { key: string; label: string; unit?: string; hint?: string; min?: number; max?: number; step?: string; optional?: boolean };

const COMMON: FieldSpec[] = [
  { key: "horizon_years", label: "Горизонт", unit: "лет", min: 5, max: 30, step: "1" },
  { key: "baseline_annual_labor", label: "Персонал базового процесса", unit: "₽/год", hint: "Полные расходы, включая взносы. Укажите сумму для выбранного процесса." },
  { key: "baseline_annual_other", label: "Прочие расходы базового процесса", unit: "₽/год" },
  { key: "hours_per_day", label: "Работа роботов", unit: "ч/сутки", min: 0.01, max: 24 },
  { key: "days_per_year", label: "Рабочие дни", unit: "дней/год", min: 1, max: 366, step: "1" },
  { key: "electricity_price", label: "Тариф на электроэнергию", unit: "₽/кВт·ч", hint: "Включите потери зарядки в среднюю мощность робота." },
];
const SCENARIO: FieldSpec[] = [
  { key: "quantity", label: "Количество роботов", min: 1, max: 100000, step: "1", hint: "Задаётся вручную; требуемая производительность должна быть проверена отдельно." },
  { key: "labor_saving_percent", label: "Сокращение расходов на персонал", unit: "%", max: 100 },
  { key: "other_saving_percent", label: "Сокращение прочих базовых расходов", unit: "%", max: 100 },
  { key: "software", label: "ПО, разово на весь парк", unit: "₽" },
  { key: "infrastructure", label: "Инфраструктура, разово", unit: "₽" },
  { key: "integration", label: "Внедрение и интеграция, разово", unit: "₽" },
  { key: "training", label: "Обучение, разово", unit: "₽" },
  { key: "reserve_percent", label: "Резерв от начальных затрат", unit: "%", max: 100 },
  { key: "annual_service_per_robot", label: "Обслуживание одного робота", unit: "₽/год", hint: "Для покупки. Для RaaS обслуживание считается включённым в ставку; доплаты укажите ниже." },
  { key: "annual_licenses", label: "Лицензии на весь парк", unit: "₽/год" },
  { key: "annual_operators", label: "Операторы роботов", unit: "₽/год" },
  { key: "annual_other", label: "Ремонт, связь, расходники и прочее", unit: "₽/год" },
  { key: "power_kw", label: "Средняя мощность одного робота", unit: "кВт", max: 100000 },
  { key: "annual_additional_benefit", label: "Дополнительный эффект", unit: "₽/год", hint: "Обоснованный доход или предотвращённые потери сверх экономии затрат." },
  { key: "service_life_years", label: "Срок службы оборудования", unit: "лет", min: 1, max: 100, step: "1", optional: true, hint: "Если неизвестен, оставьте пустым: замены не будут учтены." },
];

function initialDrafts(data: Comparison): Draft[] {
  const rows = data.groups.flatMap(g => g.rows);
  const value = (key: string, index: number) => rows.find(r => r.key === key)?.cells[index]?.value;
  return data.products.map((p, index) => {
    const values: Values = Object.fromEntries(SCENARIO.map(f => [f.key, "0"]));
    values.quantity = "1";
    values.service_life_years = value("service_life", index)?.toString() ?? "";
    values.equipment_price = value("equipment_price", index)?.toString() ?? "";
    values.monthly_fee = value("monthly_fee", index)?.toString() ?? "";
    values.software = value("software_price", index)?.toString() ?? "0";
    values.integration = value("implementation_price", index)?.toString() ?? "0";
    values.annual_service_per_robot = value("annual_service_cost", index)?.toString() ?? "0";
    return { id: p.id, name: p.name, buy: true, rent: values.monthly_fee !== "", values };
  });
}

type ProjectEconomics = {
  quantities: Record<number, number>; common: Values;
  equipment?: Record<number, EquipmentInput>;
  save: (inputs: unknown, bindings: {product_id: number; quantity_reason: string}[]) => Promise<void>;
};
export default function EconomicsPanel({ data, project }: { data: Comparison; project?: ProjectEconomics }) {
  const [common, setCommon] = useState<Values>({ horizon_years: "5", baseline_annual_labor: "", baseline_annual_other: "0", hours_per_day: "8", days_per_year: "250", electricity_price: "0", ...project?.common });
  const [drafts, setDrafts] = useState<Draft[]>(() => initialDrafts(data).map(d => ({ ...d, values: {...d.values, quantity: String(project?.quantities[d.id] ?? 1)} })));
  const [result, setResult] = useState<EconomicsResponse | null>(null);
  const [saved, setSaved] = useState(false);
  const [quantityReason, setQuantityReason] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function changeCommon(key: string, value: string) { setCommon(s => ({ ...s, [key]: value })); setResult(null); setSaved(false); setError(""); }
  function changeDraft(id: number, patch: Partial<Draft>) {
    setDrafts(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d)); setResult(null); setSaved(false); setError("");
  }
  function field(spec: FieldSpec, values: Values, onChange: (key: string, value: string) => void, prefix: string) {
    const id = `econ-${prefix}-${spec.key}`;
    return <Field key={spec.key} label={spec.label} htmlFor={id} hint={project && spec.key === "quantity" ? "Из автоматического подбора. Ручная корректировка требует обоснования." : spec.hint} required={!spec.optional}>
      <Input id={id} type="number" disabled={!!project && spec.key === "hours_per_day"} min={spec.min ?? 0} max={spec.max ?? 1e12} step={spec.step ?? "any"}
        unit={spec.unit} required={!spec.optional} value={values[spec.key] ?? ""}
        onChange={e => onChange(spec.key, e.target.value)} />
    </Field>;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setResult(null);
    const scenarios = drafts.flatMap(d => {
      const v = Object.fromEntries(Object.entries(d.values).map(([k, v]) => [k, v === "" ? null : Number(v)]));
      return [
        ...(d.buy ? [{ ...v, equipment:project?.equipment?.[d.id]??null, name: `${d.name} — покупка`, mode: "purchase" }] : []),
        ...(d.rent ? [{ ...v, equipment:project?.equipment?.[d.id]??null, name: `${d.name} — RaaS`, mode: "raas", annual_service_per_robot: 0 }] : []),
      ];
    });
    if (!scenarios.length) { setError("Выберите покупку или RaaS хотя бы для одного решения."); return; }
    setBusy(true);
    try {
      const inputs = { ...Object.fromEntries(Object.entries(common).map(([k, v]) => [k, Number(v)])), scenarios };
      setResult(await api<EconomicsResponse>("/economics/calculate", { method: "POST", body: inputs }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!project || !result) return;
    setBusy(true); setError("");
    try {
      await project.save(result.inputs, drafts.flatMap(d => [
        ...(d.buy ? [{product_id:d.id, quantity_reason:quantityReason}] : []),
        ...(d.rent ? [{product_id:d.id, quantity_reason:quantityReason}] : [])]));
      setSaved(true);
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "robo-factory-economics.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="economics card" aria-labelledby="economics-heading">
    <h2 id="economics-heading">Экономическая оценка</h2>
    <p>Сравните базовый процесс с покупкой и услугой RaaS. Цены подставлены из карточек и доступны для изменения.
      Неизвестная цена остаётся пустой. Остальные отсутствующие расходы приняты равными нулю — проверьте их перед расчётом.</p>
    <p>{project ? "Количество подставлено из подбора. Режим — из объекта, при отсутствии: 8 ч/сутки и 250 дней/год. Экономию затрат задайте отдельно." : "8 часов в сутки и 250 дней в году — начальные допущения. Количество и экономия задаются вами."}
      ПО и внедрение из карточки подставлены для одного робота: при изменении количества уточните стоимость на весь парк.</p>
    <form onSubmit={submit} onInvalid={e => (e.target as HTMLElement).closest("details")?.setAttribute("open", "")}>
      <fieldset disabled={busy} className="economics__fieldset">
        <legend>Базовый процесс и режим работы</legend>
        <div className="economics__fields">{COMMON.map(f => field(f, common, changeCommon, "common"))}</div>
        {drafts.map(d => <details className="economics__draft" key={d.id} open={drafts.length === 1 ? true : undefined}>
          <summary>{d.name}</summary>
          <div className="economics__modes">
            <label><input type="checkbox" checked={d.buy} onChange={e => changeDraft(d.id, { buy: e.target.checked })} /> Покупка</label>
            <label><input type="checkbox" checked={d.rent} onChange={e => changeDraft(d.id, { rent: e.target.checked })} /> RaaS</label>
          </div>
          {(d.buy || d.rent) && <div className="economics__fields">
            {d.buy && field({ key: "equipment_price", label: "Цена одного робота", unit: "₽", hint: "Из предложения каталога или ваша оценка." }, d.values, (k, v) => changeDraft(d.id, { values: { ...d.values, [k]: v } }), String(d.id))}
            {d.rent && field({ key: "monthly_fee", label: "RaaS за одного робота", unit: "₽/мес", hint: "Договорная ставка, включая обслуживание и замены. Прочие поля — расходы сверх ставки." }, d.values, (k, v) => changeDraft(d.id, { values: { ...d.values, [k]: v } }), String(d.id))}
            {SCENARIO.map(f => field(f, d.values, (k, v) => changeDraft(d.id, { values: { ...d.values, [k]: v } }), String(d.id)))}
          </div>}
        </details>)}
        <button className="btn btn--primary" type="submit">{busy ? "Рассчитываем…" : "Рассчитать экономику"}</button>
      </fieldset>
    </form>
    {error && <p role="alert" className="economics__error">{error}</p>}
    {result && <div aria-live="polite">
      <EconomicsResults result={result} />
      {project && <div className="project-card">
        <label>Обоснование изменения количества (если изменили)<input className="input" value={quantityReason} maxLength={1000} onChange={e=>setQuantityReason(e.target.value)} /></label>
        <label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} /> Подтверждаю допущения подбора и необходимость проверки ограничений на объекте</label>
        <button type="button" className="btn btn--primary" disabled={busy || saved || !accepted} onClick={save}>{saved ? "Сохранено в сценариях проекта" : busy ? "Сохраняем…" : "Сохранить экономику в проект"}</button>
      </div>}
      <button type="button" className="btn btn--ghost" onClick={download}>Скачать расчёт и допущения (JSON)</button>
    </div>}
  </section>;
}

export function EconomicsResults({result,savedUrl,title}: {result: EconomicsResponse;savedUrl?:string;title?:string}) {
  const inputs = result.inputs as {horizon_years:number;scenarios:({name:string;mode:string}&Record<string,unknown>)[]}&Record<string,unknown>;
  const horizon = inputs.horizon_years;
  return <div className="economics-report">      <h3>Результаты за {horizon} лет</h3>
      <div className="economics__scroll"><table className="economics__table">
        <caption>Базовый процесс и сценарии роботизации</caption>
        <thead><tr><th scope="col">Показатель</th><th scope="col">Без роботизации</th>{result.results.map((r, i) => <th key={i} scope="col">{r.name}</th>)}</tr></thead>
        <tbody>
          {([ ["CAPEX", "capex", 0], ["OPEX в год", "annual_opex", result.baseline_annual_opex], ["Эффект в год", "annual_effect", 0],
            ["TCO за горизонт", "tco", result.baseline_tco], ["Чистый эффект за горизонт", "net_effect", 0] ] as const).map(([label, key, base]) =>
            <tr key={key}><th scope="row">{label}</th><td>{formatMoney(base)}</td>{result.results.map((r, i) => <td key={i}>{formatMoney(r[key])}</td>)}</tr>)}
          <tr><th scope="row">Простая окупаемость</th><td>—</td>{result.results.map((r, i) => <td key={i}>{r.simple_payback_years === null ? (r.capex === 0 ? "Нет начальных инвестиций" : "Нет положительного эффекта") : `${formatNumber(r.simple_payback_years)} лет${r.simple_payback_years > Number(horizon) ? " — за горизонтом" : ""}`}</td>)}</tr>
          <tr><th scope="row">ROI за горизонт</th><td>—</td>{result.results.map((r, i) => <td key={i}>{r.roi_percent === null ? "Не определён: CAPEX = 0" : `${formatNumber(r.roi_percent)} %`}</td>)}</tr>
        </tbody>
      </table></div>
      {result.results.map((r, i) => <details key={i} className="economics__draft">
        <summary>{r.name}: статьи затрат и денежный поток</summary>
        {r.equipment&&<EquipmentTable plan={r.equipment}/>}
        <div className="economics__fields">{([ ["CAPEX", r.capex_breakdown], ["OPEX в год", r.opex_breakdown] ] as const).map(([title, parts]) => <div key={title}>
          <h4>{title}</h4><dl className="economics__breakdown">{Object.entries(parts).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatMoney(value)}</dd></div>)}</dl>
        </div>)}</div>
        <div className="economics__scroll"><table className="economics__table"><caption>Поток относительно базового процесса; год 0 — начальные инвестиции</caption>
          <thead><tr><th>Год</th><th>OPEX</th><th>Замены</th><th>Денежный поток</th><th>Накопленный эффект</th></tr></thead>
          <tbody>{r.years.map(y => <tr key={y.year}><th scope="row">{y.year}</th><td>{formatMoney(y.opex)}</td><td>{formatMoney(y.replacement)}</td><td>{formatMoney(y.cashflow)}</td><td>{formatMoney(y.cumulative)}</td></tr>)}</tbody>
        </table></div>
      </details>)}
      <h3>Формулы и допущения</h3>
      <dl className="economics__formulas">{Object.entries(result.formulas).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <ul>{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
      <p>Версия модели: {result.model_version}. Снимок содержит входные данные и результаты расчёта.</p>
      <details className="economics__draft"><summary>Исходные данные экономической модели</summary>
        <dl className="economics__breakdown">{COMMON.map(f=><div key={f.key}><dt>{f.label}{f.unit?`, ${f.unit}`:''}</dt><dd>{String(inputs[f.key]??'не указано')}</dd></div>)}</dl>
        {inputs.scenarios.map((s,i)=><section key={i}><h4>{s.name}</h4><p>{s.mode==='purchase'?'Покупка':'RaaS'}</p>
          <dl className="economics__breakdown">{[{key:'equipment_price',label:'Цена оборудования',unit:'₽/робот'},{key:'monthly_fee',label:'Ставка RaaS',unit:'₽/робот/мес'},...SCENARIO].map(f=><div key={f.key}><dt>{f.label}{f.unit?`, ${f.unit}`:''}</dt><dd>{String(s[f.key]??'не указано')}</dd></div>)}</dl>
        </section>)}
      </details>
      <EconomicsReportTools key={JSON.stringify(result.inputs)} result={result} savedUrl={savedUrl} title={title}/>
</div>;
}

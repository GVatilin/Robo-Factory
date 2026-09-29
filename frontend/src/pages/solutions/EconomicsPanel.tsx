import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { Comparison } from "../../api/types";
import { formatMoney, formatNumber, formatPayback } from "../../format";
import { Field, Input } from "../../ui/Field";
import "./EconomicsPanel.css";
import EconomicsReportTools from "./EconomicsReportTools";
import GptRequestProgress from "./GptRequestProgress";
import {EquipmentTable, type EquipmentInput, type EquipmentPlan} from "../projects/Equipment";

export type GptAdvice = {selected_scenario:number;recommendation:string;alternatives:string[];risks:string[];missing_data:string[];model:string};
type Values = Record<string, string>;
const CATALOG_FIELDS: Record<string,string> = {equipment_price:'equipment_price',monthly_fee:'monthly_fee',service_life_years:'service_life',software:'software_price',integration:'implementation_price',annual_service_per_robot:'annual_service_cost'};
function catalogValue(data:Comparison,id:number,key:string) {
  const index=data.products.findIndex(p=>p.id===id);
  return data.groups.flatMap(g=>g.rows).find(r=>r.key===CATALOG_FIELDS[key])?.cells[index]?.value;
}
type Draft = { id: number; name: string; buy: boolean; rent: boolean; values: Values };
type Result = {
  name: string; mode: string; capex: number; annual_opex: number; annual_effect: number;
  cost_per_unit?: number|null; saving_per_unit?: number|null; tco_saving_percent?: number|null;
  annual_labor_saving?: number; annual_opex_change?: number; interpretation?: string; risks?: string[];
  tco: number; net_effect: number; simple_payback_years: number | null; roi_percent: number | null;
  capex_breakdown: Record<string, number>; opex_breakdown: Record<string, number>;
  years: { year: number; opex: number; replacement: number; cashflow: number; cumulative: number }[];
  equipment?: EquipmentPlan | null;
};
export type EconomicsResponse = {
  model_version: string; inputs: unknown; baseline_annual_opex: number; baseline_tco: number;
  annual_volume?: number|null; baseline_cost_per_unit?: number|null;
  results: Result[]; formulas: Record<string, string>; assumptions: string[];
};
type FieldSpec = { key: string; label: string; unit?: string; hint?: string; min?: number; max?: number; step?: string; optional?: boolean };

const COMMON: FieldSpec[] = [
  { key: "daily_volume", label: "Объём работы в сутки", unit: "ед./сутки", optional: true, min: 0.000001, hint: "Одинаковый плановый объём для всех вариантов, без пикового коэффициента. Нужен только для стоимости и экономии на единице работы." },
  { key: "horizon_years", label: "Горизонт", unit: "лет", min: 5, max: 30, step: "1" },
  { key: "baseline_annual_labor", label: "Персонал базового процесса", unit: "₽/год", hint: "Полные расходы, включая взносы. Укажите сумму для выбранного процесса." },
  { key: "baseline_annual_other", label: "Прочие расходы базового процесса", unit: "₽/год" },
  { key: "hours_per_day", label: "Работа роботов", unit: "ч/сутки", min: 0.01, max: 24 },
  { key: "days_per_year", label: "Рабочие дни", unit: "дней/год", min: 1, max: 366, step: "1" },
  { key: "electricity_price", label: "Тариф на электроэнергию", unit: "₽/кВт·ч", hint: "Включите потери зарядки в среднюю мощность робота." },
];
const SCENARIO: FieldSpec[] = [
  { key: "quantity", label: "Количество роботов", min: 1, max: 100000, step: "1", hint: "Задаётся вручную; требуемая производительность должна быть проверена отдельно." },
  { key: "labor_saving_percent", label: "Сокращение расходов на персонал", unit: "%", max: 100, hint: "По умолчанию 0%: экономия не подтверждена. Укажите реальное сокращение затрат именно выбранного процесса." },
  { key: "other_saving_percent", label: "Сокращение прочих базовых расходов", unit: "%", max: 100 },
  { key: "software", label: "ПО, разово на весь парк", unit: "₽" },
  { key: "infrastructure", label: "Инфраструктура, разово", unit: "₽" },
  { key: "integration", label: "Внедрение и интеграция, разово", unit: "₽" },
  { key: "commissioning", label: "Пусконаладка, разово", unit: "₽" },
  { key: "training", label: "Обучение, разово", unit: "₽" },
  { key: "reserve_percent", label: "Резерв от начальных затрат", unit: "%", max: 100 },
  { key: "annual_service_per_robot", label: "Обслуживание одного робота", unit: "₽/год", hint: "Для покупки. Для RaaS обслуживание считается включённым в ставку; доплаты укажите ниже." },
  { key: "annual_licenses", label: "Лицензии на весь парк", unit: "₽/год" },
  { key: "annual_operators", label: "Операторы роботов", unit: "₽/год" },
  { key: "annual_connectivity", label: "Связь", unit: "₽/год" },
  { key: "annual_consumables", label: "Расходные материалы", unit: "₽/год" },
  { key: "annual_repairs", label: "Ремонт", unit: "₽/год" },
  { key: "annual_other", label: "Прочие расходы", unit: "₽/год" },
  { key: "component_replacement_cost", label: "Замена компонентов на весь парк", unit: "₽" },
  { key: "component_replacement_interval", label: "Период замены компонентов", unit: "лет", min: 1, max: 100, step: "1", optional: true },
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
    values.component_replacement_interval = "";
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
  quantities: Record<number, number>; common: Values; commonEvidence?:Record<string,string>; facilityTypeId?:number; volumeUnit?:string; onFixSelection?:()=>void;
  prepareFleet?:()=>Promise<{quantities:Record<number,number>;hoursPerDay:number;dailyVolume:number|null;volumeUnit:string;notes:string[]}>;
  fleetBasis?: Record<number, number>;
  recommend?: (inputs: unknown, bindings: {product_id:number;quantity_reason:string}[]) => Promise<unknown>;
  equipment?: Record<number, EquipmentInput>;
  saveBlockedReason?: string;
  save: (inputs: unknown, bindings: {product_id: number; quantity_reason: string}[]) => Promise<void>;
};
export default function EconomicsPanel({ data, project }: { data: Comparison; project?: ProjectEconomics }) {
  const [common, setCommon] = useState<Values>({ daily_volume: "", horizon_years: "5", baseline_annual_labor: "", baseline_annual_other: "0", hours_per_day: "8", days_per_year: "250", electricity_price: "0", ...project?.common });
  const [volumeUnit,setVolumeUnit]=useState(project?.volumeUnit??"операция");
  const [drafts, setDrafts] = useState<Draft[]>(() => initialDrafts(data).map(d => ({ ...d, values: {...d.values, quantity: String(project ? project.quantities[d.id] ?? '' : 1)} })));
  const [view,setView]=useState<'inputs'|'results'>('inputs');
  const [profile,setProfile]=useState<string|null>(null);
  const [defaultNotes,setDefaultNotes]=useState<string[]>([]);
  const [evidence,setEvidence]=useState<Record<string,string>>(()=>Object.fromEntries([
    ...Object.entries(common).filter(([,v])=>v!=='').map(([k])=>[`common.${k}`,project?.commonEvidence?.[k]??(k==='daily_volume'?'Плановый суточный объём выбранного процесса из подбора, без пикового коэффициента.':project?.common[k]!==undefined?'Параметры объекта. ФОТ = персонал × зарплата × 12 × коэффициент начислений; уточните долю выбранного процесса.':'Начальное допущение формы: горизонт 5 лет, режим 8 часов × 250 дней, прочие затраты 0. Требует уточнения.')]),
    ...drafts.flatMap(d=>Object.entries(d.values).filter(([,v])=>v!=='').map(([k])=>[`product.${d.id}.${k}`,catalogValue(data,d.id,k)!=null?`Каталог, карточка решения /products/${d.id}; проверить условия предложения.`:k==='quantity'&&project?.quantities[d.id]!==undefined?'Рассчитанное количество из автоматического подбора.':'Начальное допущение формы: количество 1, неизвестные дополнительные затраты и экономия 0. Требует уточнения.']))
  ]));
  const [automaticValues,setAutomaticValues]=useState<Record<string,number|null>>(()=>Object.fromEntries([
    ...Object.entries(common).filter(([,v])=>v!=='').map(([k,v])=>[`common.${k}`,Number(v)]),
    ...drafts.flatMap(d=>Object.entries(d.values).filter(([,v])=>v!=='').map(([k,v])=>[`product.${d.id}.${k}`,Number(v)]))
  ]));
  const [adjustmentReason,setAdjustmentReason]=useState("");
  const [advice,setAdvice]=useState<GptAdvice|null>(null);
  const [advising,setAdvising]=useState(false);
  const [adviceError,setAdviceError]=useState('');
  async function fillDefaults() {
    if(!window.confirm("Заполнить экономику демонстрационными допущениями? Режим объекта, рассчитанный парк и известные данные каталога будут сохранены. Введённые вручную экономические значения заменятся."))return;
    setBusy(true);setError("");
    try {
      const defaults=await api<{profile:string;common:Record<string,number>;scenario:Record<string,number>;source:string;field_sources:Record<string,string>;notes:string[]}>(`/economics/defaults${project?.facilityTypeId?`?facility_type_id=${project.facilityTypeId}`:''}`);
      const nextCommon={...Object.fromEntries(Object.entries(defaults.common).map(([k,v])=>[k,String(v)])),...project?.common};
      const originals=initialDrafts(data);
      const nextDrafts=originals.map(d=>{
        const values:Values=Object.fromEntries(Object.entries(defaults.scenario).map(([k,v])=>[k,String(v)]));
        for(const key of Object.keys(CATALOG_FIELDS))if(catalogValue(data,d.id,key)!=null)values[key]=d.values[key];
        values.quantity=String(project ? project.quantities[d.id]??'' : 1);
        return {...d,buy:true,rent:true,values};
      });
      const origins:Record<string,string>={};const automatic:Record<string,number|null>={};
      for(const [key,value] of Object.entries(nextCommon)){origins[`common.${key}`]=project?.commonEvidence?.[key]??(key==='daily_volume'&&project?.common[key]!==undefined?'Плановый суточный объём выбранного процесса из подбора, без пикового коэффициента.':project?.common[key]!==undefined?'Параметры объекта или ФОТ = персонал × зарплата × 12 × коэффициент начислений. Уточните долю выбранного процесса.':defaults.field_sources[`common.${key}`]??defaults.source);automatic[`common.${key}`]=Number(value);}
      for(const d of nextDrafts)for(const [key,value] of Object.entries(d.values)){
        origins[`product.${d.id}.${key}`]=key==='quantity'&&project?.quantities[d.id]!==undefined?'Автоматический подбор: пиковая нагрузка / эффективная производительность с резервом.':catalogValue(data,d.id,key)!=null?`Каталог, карточка решения /products/${d.id}; проверить условия предложения.`:defaults.field_sources[`scenario.${key}`]??defaults.source;
        automatic[`product.${d.id}.${key}`]=value===''?null:Number(value);
      }
      setCommon(nextCommon);setDrafts(nextDrafts);setProfile(defaults.profile);setDefaultNotes(defaults.notes);setEvidence(origins);setAutomaticValues(automatic);setAdjustmentReason("");setResult(null);setAdvice(null);setSaved(false);setAccepted(false);setAdviceError('');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const [result, setResult] = useState<EconomicsResponse | null>(null);
  const [saved, setSaved] = useState(false);
  const [quantityReason, setQuantityReason] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fleetNotice,setFleetNotice]=useState('');
  async function prepareFleet() {
    if(!project?.prepareFleet)return;
    setBusy(true);setError('');setFleetNotice('');
    try {
      const fleet=await project.prepareFleet();
      setDrafts(ds=>ds.map(d=>({...d,values:{...d.values,quantity:String(fleet.quantities[d.id])}})));
      setCommon(c=>({...c,hours_per_day:String(fleet.hoursPerDay),daily_volume:fleet.dailyVolume==null?'':String(fleet.dailyVolume)}));
      setVolumeUnit(fleet.volumeUnit);
      const values:Record<string,number|null>=Object.fromEntries(Object.entries(fleet.quantities).map(([id,value])=>[`product.${id}.quantity`,value]));
      values['common.hours_per_day']=fleet.hoursPerDay;
      values['common.daily_volume']=fleet.dailyVolume;
      setAutomaticValues(v=>({...v,...values}));
      setEvidence(v=>({...v,...Object.fromEntries(Object.keys(values).map(key=>[key,('Расчёт парка с явными демонстрационными допущениями. '+[...new Set(fleet.notes)].join(' ')).slice(0,2000)]))}));
      setDefaultNotes(notes=>[...new Set([...notes,...fleet.notes])]);
      setResult(null);setAdvice(null);setSaved(false);setAccepted(false);setAdviceError('');setQuantityReason('');setView('inputs');
      setFleetNotice('Парк рассчитан. Количество роботов, объём и часы работы обновлены, введённые цены и затраты сохранены. Проверьте данные, нажмите «Рассчитать экономику», затем «Сохранить экономику в проект».');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function changeCommon(key: string, value: string) { setCommon(s => ({ ...s, [key]: value })); setResult(null); setAdvice(null); setSaved(false);setAccepted(false);setAdviceError(''); setError(""); }
  function changeDraft(id: number, patch: Partial<Draft>) {
    setDrafts(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d)); setResult(null); setAdvice(null); setSaved(false);setAccepted(false);setAdviceError(''); setError("");
  }
  function field(spec: FieldSpec, values: Values, onChange: (key: string, value: string) => void, prefix: string) {
    const id = `econ-${prefix}-${spec.key}`;
    const hint=project&&spec.key==="quantity"
      ? project.quantities[Number(prefix)]!==undefined
        ? "Из автоматического подбора. Ручная корректировка требует обоснования."
        : "Количество ещё не рассчитано. Вернитесь к решениям и заполните недостающие нагрузку и производительность."
      : spec.hint;
    return <Field key={spec.key} label={spec.label} htmlFor={id} hint={hint} required={!spec.optional}>
      <Input id={id} type="number" disabled={!!project && spec.key === "hours_per_day"} min={spec.min ?? 0} max={spec.max ?? 1e12} step={spec.step ?? "any"}
        unit={spec.key==='daily_volume'?`${volumeUnit}/сутки`:spec.unit} required={!spec.optional} value={values[spec.key] ?? ""}
        onChange={e => onChange(spec.key, e.target.value)} />
      {evidence[`${prefix==='common'?'common':`product.${prefix}`}.${spec.key}`]&&<details className="economics__field-source"><summary>Источник значения</summary>{evidence[`${prefix==='common'?'common':`product.${prefix}`}.${spec.key}`]}</details>}
    </Field>;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setResult(null); setAdvice(null);setAdviceError('');
    if(project?.saveBlockedReason){setError(project.saveBlockedReason);return;}
    const scenarios = drafts.flatMap(d => {
      const v = Object.fromEntries(Object.entries(d.values).map(([k, v]) => [k, v === "" ? null : Number(v)]));
      const fleetBasis=Number(d.values.quantity)===project?.quantities[d.id]?project?.fleetBasis?.[d.id]??null:Number(d.values.quantity);
      return [
        ...(d.buy ? [{ ...v, equipment:project?.equipment?.[d.id]??null, fleet_unrounded:fleetBasis, name: `${d.name} — покупка`, mode: "purchase" }] : []),
        ...(d.rent ? [{ ...v, equipment:project?.equipment?.[d.id]??null, fleet_unrounded:fleetBasis, name: `${d.name} — RaaS`, mode: "raas", annual_service_per_robot: 0 }] : []),
      ];
    });
    if (scenarios.length<2) { setError("Для сравнения нужны два варианта роботизации: выберите два решения или покупку и RaaS одного решения. Базовый процесс добавляется автоматически."); return; }
    const changed=Object.entries(automaticValues).some(([path,value])=>{const parts=path.split('.');const current=parts[0]==='common'?common[parts[1]]:drafts.find(d=>d.id===Number(parts[1]))?.values[parts[2]];return (current===''?null:Number(current))!==value;});
    if(changed&&adjustmentReason.trim().length<3){setError("Укажите обоснование изменения автоматически заполненных значений.");return;}
    setBusy(true);
    try {
      const inputs = { ...Object.fromEntries(Object.entries(common).map(([k, v]) => [k, k==='daily_volume'&&v===''?null:Number(v)])), volume_unit:volumeUnit, scenarios, default_profile:profile,input_evidence:evidence,automatic_values:automaticValues,adjustment_reason:adjustmentReason };
      setResult(await api<EconomicsResponse>("/economics/calculate", { method: "POST", body: inputs }));
      setView("results");setSaved(false);setAccepted(false);setAdviceError('');document.getElementById("economics-heading")?.scrollIntoView({block:"start"});
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!project || !result || project.saveBlockedReason) return;
    if(!accepted){setError('Для сохранения подтвердите допущения: поставьте галочку над кнопкой сохранения.');document.getElementById('economics-accept')?.focus();return;}
    setBusy(true); setError("");
    try {
      await project.save(result.inputs, drafts.flatMap(d => [
        ...(d.buy ? [{product_id:d.id, quantity_reason:quantityReason||adjustmentReason}] : []),
        ...(d.rent ? [{product_id:d.id, quantity_reason:quantityReason||adjustmentReason}] : [])]));
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
    <div className="economics__heading"><div><span className="model-eyebrow">ЭКОНОМИЧЕСКАЯ МОДЕЛЬ</span><h2 id="economics-heading">Сколько стоит роботизация?</h2><p>Сравните расходы сегодня и после внедрения роботов.</p></div><span className="economics__horizon">{common.horizon_years} лет · {drafts.length} решений</span></div>
    <nav className="economics__tabs" aria-label="Экономическая модель"><button type="button" aria-current={view==='inputs'?'page':undefined} disabled={advising||busy} onClick={()=>setView('inputs')}>1. Данные и допущения</button><button type="button" aria-current={view==='results'?'page':undefined} disabled={!result||advising||busy} onClick={()=>setView('results')}>2. Результат и рекомендация</button></nav>
    {project?.saveBlockedReason&&<div className="economics__warning" role="status"><strong>Рассчитаем, сколько роботов нужно объекту</strong><p>{project.saveBlockedReason}</p><p>Примеры нагрузки и производительности будут отмечены как допущения команды. Перед внедрением замените их замерами.</p><button type="button" className="btn btn--primary" disabled={busy||advising} onClick={()=>void prepareFleet()}>{busy?'Рассчитываем парк…':'Заполнить недостающее и рассчитать парк'}</button> <button type="button" className="btn btn--ghost" disabled={busy||advising} onClick={project.onFixSelection}>Уточнить вручную</button></div>}
    {fleetNotice&&<div className="economics__quickstart" role="status"><div><strong>Теперь можно рассчитать и сохранить экономику</strong><p>{fleetNotice}</p><details><summary>Какие допущения использованы</summary><ul>{defaultNotes.map((n,i)=><li key={i}>{n}</li>)}</ul></details></div></div>}
    <div hidden={view!=='inputs'}>
    <div className="economics__quickstart"><div><strong>Начните с готового примера</strong><p>Заполните форму одним нажатием, затем уточните цены и затраты под свой объект. Это допущения, а не предложения поставщиков.</p></div><button type="button" className="btn btn--primary" disabled={busy||advising} onClick={()=>void fillDefaults()}>Заполнить по умолчанию</button></div>
    <p>{project ? "Количество подставлено из подбора. Режим — из объекта, при отсутствии: 8 ч/сутки и 250 дней/год. Экономию затрат задайте отдельно." : "8 часов в сутки и 250 дней в году — начальные допущения. Количество и экономия задаются вами."}
      ПО и внедрение из карточки подставлены для одного робота: при изменении количества уточните стоимость на весь парк.</p>

    {profile&&<details className="economics__draft"><summary>Источники и допущения заполнения</summary><ul>{defaultNotes.map(n=><li key={n}>{n}</li>)}</ul><p>Значения примера не являются ценами поставщиков или нормативами. Изменяйте их под свой объект.</p></details>}
    <Field label="Обоснование ручных изменений" htmlFor="economics-adjustment-reason" hint="Сохраняется вместе с исходными и изменёнными значениями."><Input id="economics-adjustment-reason" disabled={advising||busy} maxLength={2000} value={adjustmentReason} onChange={e=>{setAdjustmentReason(e.target.value);setResult(null);setAdvice(null);setSaved(false);setAccepted(false);setAdviceError('');}}/></Field>
    <form onSubmit={submit} onInvalid={e => {let node=(e.target as HTMLElement).parentElement;while(node){if(node.tagName==='DETAILS')node.setAttribute('open','');node=node.parentElement;}}}>
      <fieldset disabled={busy||advising} className="economics__fieldset">
        <legend>Сегодня: расходы и режим работы</legend>
        {project?<p className="economics__unit-note">Единица выбранного процесса: <strong>{volumeUnit}</strong>. Объём из подбора можно уточнить с обоснованием; парк пересчитывается на шаге «Решения».</p>:<Field label="Единица работы" htmlFor="economics-volume-unit"><select id="economics-volume-unit" className="input" value={volumeUnit} onChange={e=>{setVolumeUnit(e.target.value);setResult(null);setAdvice(null);setSaved(false);setAccepted(false);setAdviceError('');}}>{['операция','паллета','рейс','строка','отправление','м²','кг','порция','контейнер','заявка','образец','позиция'].map(unit=><option key={unit}>{unit}</option>)}</select></Field>}
        <div className="economics__fields">{COMMON.map(f => field(f, common, changeCommon, "common"))}</div>
        {drafts.map(d => <details className="economics__draft" key={d.id} open={drafts.length === 1 ? true : undefined}>
          <summary><span>{d.name}</span><small className="economics__product-caption">{d.values.quantity} роботов · настройка сценариев</small></summary>
          <div className="economics__modes">
            <label><input type="checkbox" checked={d.buy} onChange={e => changeDraft(d.id, { buy: e.target.checked })} /> Покупка</label>
            <label><input type="checkbox" checked={d.rent} onChange={e => changeDraft(d.id, { rent: e.target.checked })} /> Аренда / RaaS</label>
          </div>
          {(d.buy || d.rent) && <div className="economics__fields">
            {d.buy && field({ key: "equipment_price", label: "Цена одного робота", unit: "₽", hint: "Из предложения каталога или ваша оценка." }, d.values, (k, v) => changeDraft(d.id, { values: { ...d.values, [k]: v } }), String(d.id))}
            {d.rent && field({ key: "monthly_fee", label: "RaaS за одного робота", unit: "₽/мес", hint: "Договорная ставка, включая обслуживание и замены. Прочие поля — расходы сверх ставки." }, d.values, (k, v) => changeDraft(d.id, { values: { ...d.values, [k]: v } }), String(d.id))}
            {SCENARIO.filter(f=>['quantity','labor_saving_percent','other_saving_percent','annual_additional_benefit'].includes(f.key)).map(f => field(f, d.values, (k, v) => changeDraft(d.id, { values: { ...d.values, [k]: v } }), String(d.id)))}
            {[
              {title:'Разовые затраты · CAPEX',hint:'ПО, внедрение, инфраструктура и резерв',keys:['software','infrastructure','integration','commissioning','training','reserve_percent']},
              {title:'Расходы в год · OPEX',hint:'Сервис, персонал, связь и электроэнергия',keys:['annual_service_per_robot','annual_licenses','annual_operators','annual_connectivity','annual_consumables','annual_repairs','annual_other','power_kw']},
              {title:'Срок службы и замены',hint:'Учёт затрат на протяжении всего горизонта',keys:['service_life_years','component_replacement_cost','component_replacement_interval']},
            ].map(group=><details className="economics__field-group" key={group.title}><summary>{group.title}<small>{group.hint}</small></summary><div className="economics__fields">{SCENARIO.filter(f=>group.keys.includes(f.key)).map(f=>field(f,d.values,(k,v)=>changeDraft(d.id,{values:{...d.values,[k]:v}}),String(d.id)))}</div></details>)}
          </div>}
        </details>)}
        <button className="btn btn--primary" type="submit" disabled={!!project?.saveBlockedReason}>{busy ? "Рассчитываем…" : "Рассчитать экономику"}</button>
      </fieldset>
    </form>
    </div>
    {error && view==='inputs' && <p role="alert" className="economics__error">{error}</p>}
    <div hidden={view!=='results'}>
    {result && <div className="economics__result-intro"><strong>Расчёт готов</strong><span>Сравните варианты ниже. GPT поможет объяснить различия и риски.</span></div>}
    {result && project?.recommend && <div className="economics__advisor"><h3>Рекомендация GPT</h3><p>GPT сравнит рассчитанные варианты и объяснит выбор. Параметры объекта и расчёты будут отправлены в сервис. Ожидание ответа — до 50 секунд.</p><div className="economics__advisor-action"><button type="button" className="btn btn--primary" disabled={advising||busy||!!project?.saveBlockedReason} onClick={async()=>{setAdvising(true);setError("");setAdvice(null);setAdviceError('');try{const response=await project.recommend!(result.inputs,drafts.flatMap(d=>[...(d.buy?[{product_id:d.id,quantity_reason:quantityReason||adjustmentReason}]:[]),...(d.rent?[{product_id:d.id,quantity_reason:quantityReason||adjustmentReason}]:[])]));setAdvice(response as typeof advice);}catch(e){setAdviceError((e as Error).message);}finally{setAdvising(false);}}}>{advising?'Запрос выполняется…':adviceError?'Повторить запрос к GPT':'Объяснить и рекомендовать через GPT'}</button><GptRequestProgress active={advising} complete={!!advice} failed={!!adviceError}/></div>{adviceError&&<p role="alert" className="economics__advisor-error">{adviceError}</p>}{advice&&<section><h4>{advice.selected_scenario===-1?"Сохранить базовый процесс или уточнить данные":`Рекомендация: ${result.results[advice.selected_scenario]?.name??"уточнить данные"}`}</h4><p style={{whiteSpace:'pre-wrap'}}>{advice.recommendation}</p><h4>Альтернативы</h4><ul>{advice.alternatives.map((v,i)=><li key={i}>{v}</li>)}</ul><h4>Риски и недостающие данные</h4><ul>{[...advice.risks,...advice.missing_data].map((v,i)=><li key={i}>{v}</li>)}</ul><small>Модель: {advice.model}. Рекомендация не изменяет расчёт автоматически.</small></section>}</div>}
    {error&&!project&&<p role="alert" className="economics__error">{error}</p>}
    {result && <div aria-live="polite">
      <EconomicsResults result={result} advice={advice}/>
      {project && <div className="project-card">
        <label>Обоснование изменения количества (если изменили)<input className="input" value={quantityReason} maxLength={1000} onChange={e=>setQuantityReason(e.target.value)} /></label>
        <label><input id="economics-accept" type="checkbox" disabled={busy||advising} checked={accepted} onChange={e=>{setAccepted(e.target.checked);setError('');}} /> Подтверждаю допущения подбора и необходимость проверки ограничений на объекте</label>
        {project.saveBlockedReason&&<p role="status" className="economics__warning">{project.saveBlockedReason}</p>}
        {!accepted&&!saved&&<p>Перед сохранением отметьте подтверждение допущений выше. Расчёт появится в разделе «История» и в сценариях проекта.</p>}
        {error&&<p role="alert" className="economics__error">{error}</p>}
        {project.prepareFleet&&<details><summary>Парк изменился или сохранение просит повторить подбор?</summary><p>Пересчитаем количество роботов и оборудование. Недостающую нагрузку и производительность заполним явными примерами. Цены и затраты сохранятся; экономику и рекомендацию GPT потребуется рассчитать повторно.</p><button type="button" className="btn btn--ghost" disabled={busy||advising} onClick={()=>void prepareFleet()}>Обновить парк с допущениями</button></details>}
        <button type="button" className="btn btn--primary" disabled={busy || advising || saved || !!project.saveBlockedReason} onClick={save}>{saved ? "Сохранено в сценариях проекта" : busy ? "Сохраняем…" : "Сохранить экономику в проект"}</button>
      </div>}
      <button type="button" className="btn btn--ghost" onClick={download}>Скачать расчёт и допущения (JSON)</button>
    </div>}
    </div>
  </section>;
}

export function EconomicsResults({result,savedUrl,title,advice}: {result: EconomicsResponse;savedUrl?:string;title?:string;advice?:GptAdvice|null}) {
  const inputs = result.inputs as {horizon_years:number;scenarios:({name:string;mode:string}&Record<string,unknown>)[]}&Record<string,unknown>;
  const horizon = inputs.horizon_years;
  const unit=String(inputs.volume_unit??'операция');
  const hasUnitMetrics='baseline_cost_per_unit' in result;
  const unitMoney=(value:number|null|undefined)=>value==null?'Укажите объём':`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:4}).format(value)} ₽/${unit}`;
  return <div className="economics-report"><h3>Результаты за {horizon} лет</h3>
      <EconomicsReportTools key={JSON.stringify(result.inputs)} result={result} savedUrl={savedUrl} title={title} advice={advice}/>
      <div className="economics__summary-grid">{result.results.map((r,i)=><article className="economics__summary-card" key={i}><span>{r.mode==='purchase'?'ПОКУПКА':'АРЕНДА / RaaS'}</span><h4>{r.name}</h4><div className={`economics__effect ${r.net_effect>0?'is-positive':'is-negative'}`}>{formatMoney(r.net_effect)}</div><p>чистый эффект за {horizon} лет</p><dl><div><dt>Вложения</dt><dd>{formatMoney(r.capex)}</dd></div><div><dt>Эффект в год</dt><dd>{formatMoney(r.annual_effect)}</dd></div><div><dt>Окупаемость</dt><dd>{r.simple_payback_years===null?'Не определена':formatPayback(r.simple_payback_years)}</dd></div></dl></article>)}</div>
      {hasUnitMetrics&&<div className="economics__unit-note"><strong>Сравнение на единицу работы</strong><p>{result.annual_volume?`План: ${formatNumber(result.annual_volume)} ${unit} в год, одинаковый для всех вариантов.`:'Укажите объём работы в сутки на вкладке «Данные и допущения», чтобы увидеть удельные затраты.'} Стоимость включает вложения, эксплуатацию и замены за {horizon} лет. Отрицательная экономия означает удорожание; дополнительный доход в неё не входит.</p></div>}
      <div className="economics__scroll" tabIndex={0} role="region" aria-label="Таблица расчёта: прокрутка по горизонтали"><table className="economics__table">
        <caption>Базовый процесс и сценарии роботизации</caption>
        <thead><tr><th scope="col">Показатель</th><th scope="col">Без роботизации</th>{result.results.map((r, i) => <th key={i} scope="col">{r.name}</th>)}</tr></thead>
        <tbody>
          {([ ["CAPEX", "capex", 0], ["OPEX в год", "annual_opex", result.baseline_annual_opex], ["Эффект в год", "annual_effect", 0],
            ["TCO за горизонт", "tco", result.baseline_tco], ["Чистый эффект за горизонт", "net_effect", 0] ] as const).map(([label, key, base]) =>
            <tr key={key}><th scope="row">{label}</th><td>{formatMoney(base)}</td>{result.results.map((r, i) => <td key={i}>{formatMoney(r[key])}</td>)}</tr>)}
          {hasUnitMetrics&&<>
            <tr className="economics__unit-row"><th scope="row">Полная стоимость единицы<small>TCO ÷ объём за {horizon} лет</small></th><td>{unitMoney(result.baseline_cost_per_unit)}</td>{result.results.map((r,i)=><td key={i}>{unitMoney(r.cost_per_unit)}</td>)}</tr>
            <tr className="economics__unit-row"><th scope="row">Экономия на единице<small>Стоимость базы − стоимость варианта</small></th><td>{result.annual_volume?'0 ₽':'—'}</td>{result.results.map((r,i)=><td key={i}>{unitMoney(r.saving_per_unit)}</td>)}</tr>
            <tr className="economics__unit-row"><th scope="row">Снижение полной стоимости<small>Относительно TCO базового процесса</small></th><td>{result.baseline_tco>0?'0 %':'—'}</td>{result.results.map((r,i)=><td key={i}>{r.tco_saving_percent==null?'Не определено: TCO базы = 0':`${formatNumber(r.tco_saving_percent)} %`}</td>)}</tr>
          </>}
          <tr><th scope="row">Простая окупаемость</th><td>—</td>{result.results.map((r, i) => <td key={i}>{r.simple_payback_years === null ? (r.capex === 0 ? "Нет начальных инвестиций" : "Нет положительного эффекта") : `${formatPayback(r.simple_payback_years)}${r.simple_payback_years > Number(horizon) ? " — за горизонтом" : ""}`}</td>)}</tr>
          <tr><th scope="row">ROI за горизонт</th><td>—</td>{result.results.map((r, i) => <td key={i}>{r.roi_percent === null ? "Не определён: CAPEX = 0" : `${formatNumber(r.roi_percent)} %`}</td>)}</tr>
        </tbody>
      </table></div>
      {result.results.map((r,i)=><section key={`interpretation-${i}`}><h4>{r.name}</h4><p>{r.interpretation}</p>{r.annual_labor_saving!==undefined&&<p>Экономия ФОТ: {formatMoney(r.annual_labor_saving)}/год. Изменение OPEX: {formatMoney(r.annual_opex_change??0)}/год (минус — снижение).</p>}<ul>{r.risks?.map((risk,j)=><li key={j}>{risk}</li>)}</ul></section>)}
      {result.results.map((r, i) => <details key={i} className="economics__draft">
        <summary>{r.name}: статьи затрат и денежный поток</summary>
        {r.equipment&&<EquipmentTable plan={r.equipment}/>}
        <div className="economics__fields">{([ ["CAPEX", r.capex_breakdown], ["OPEX в год", r.opex_breakdown] ] as const).map(([title, parts]) => <div key={title}>
          <h4>{title}</h4><dl className="economics__breakdown">{Object.entries(parts).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{formatMoney(value)}</dd></div>)}</dl>
        </div>)}</div>
        <div className="economics__scroll" tabIndex={0} role="region" aria-label="Таблица расчёта: прокрутка по горизонтали"><table className="economics__table"><caption>Поток относительно базового процесса; год 0 — начальные инвестиции</caption>
          <thead><tr><th>Год</th><th>OPEX</th><th>Замены</th><th>Денежный поток</th><th>Накопленный эффект</th></tr></thead>
          <tbody>{r.years.map(y => <tr key={y.year}><th scope="row">{y.year}</th><td>{formatMoney(y.opex)}</td><td>{formatMoney(y.replacement)}</td><td>{formatMoney(y.cashflow)}</td><td>{formatMoney(y.cumulative)}</td></tr>)}</tbody>
        </table></div>
      </details>)}
      <details className="economics__draft"><summary>Как мы считаем: формулы и допущения</summary>
      <dl className="economics__formulas">{Object.entries(result.formulas).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <ul>{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
      <p>Версия модели: {result.model_version}. Снимок содержит входные данные и результаты расчёта.</p></details>
      <details className="economics__draft"><summary>Исходные данные экономической модели</summary><p>Единица объёма: {unit}</p>
        <dl className="economics__breakdown">{COMMON.map(f=><div key={f.key}><dt>{f.label}{f.unit?`, ${f.unit}`:''}</dt><dd>{String(inputs[f.key]??'не указано')}</dd></div>)}</dl>
        {inputs.scenarios.map((s,i)=><section key={i}><h4>{s.name}</h4><p>{s.mode==='purchase'?'Покупка':'RaaS'}</p>
          <dl className="economics__breakdown">{[{key:'equipment_price',label:'Цена оборудования',unit:'₽/робот'},{key:'monthly_fee',label:'Ставка RaaS',unit:'₽/робот/мес'},...SCENARIO].map(f=><div key={f.key}><dt>{f.label}{f.unit?`, ${f.unit}`:''}</dt><dd>{String(s[f.key]??'не указано')}</dd></div>)}</dl>
        </section>)}
      </details>
      {!!inputs.input_evidence&&<details><summary>Источники значений и ручные корректировки</summary><p>{String(inputs.adjustment_reason||"Ручные изменения не обоснованы или отсутствуют.")}</p><dl>{Object.entries(inputs.input_evidence as Record<string,string>).map(([path,source])=><div key={path}><dt>{path}</dt><dd>{source} Исходное значение: {String((inputs.automatic_values as Record<string,unknown>)?.[path]??'не указано')}</dd></div>)}</dl></details>}
</div>;
}

export type EquipmentInput = {
  runtime_hours:number; charge_hours:number; charger_utilization:number;
  operations_per_cycle:number; handling_seconds:number; station_utilization:number;
  peak_rate:number; charger_price:number; station_price:number;
  charger_count:number|null; station_count:number|null; override_reason:string;
};
export type EquipmentPlan = {inputs:EquipmentInput;items:{code:string;name:string;calculated:number;quantity:number;unit_price:number;cost:number}[];total_cost:number;formulas:string[];assumptions:string[]};
export const DEFAULT_EQUIPMENT:EquipmentInput = {runtime_hours:8,charge_hours:2,charger_utilization:.8,
  operations_per_cycle:1,handling_seconds:30,station_utilization:.8,peak_rate:0,
  charger_price:0,station_price:0,charger_count:null,station_count:null,override_reason:''};

export function EquipmentFields({value,onChange}:{value:EquipmentInput;onChange:(value:EquipmentInput)=>void}) {
  return <details><summary>Вспомогательное оборудование и параметры цикла</summary>
    <p>Типовая схема мобильных роботов: общие зарядки и посты обработки. Начальные значения — допущения; сверяйте автономность и зарядку с карточкой выбранного робота. Цены задаются отдельно, 0 означает неоценённую стоимость или оборудование, уже включённое в договор.</p>
    <div className="selection-fields">{([
      ['runtime_hours','Автономность, ч',.01,168],['charge_hours','Зарядка, ч',.01,48],
      ['charger_utilization','Допустимая загрузка зарядки',.01,1],['operations_per_cycle','Единиц потока за цикл',.001,1e6],
      ['handling_seconds','Обработка партии на посту, с',.01,3600],['station_utilization','Допустимая загрузка поста',.01,1],
      ['charger_price','Цена одной зарядки, ₽',0,1e12],['station_price','Цена одного поста, ₽',0,1e12],
    ] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" required min={min} max={max} step="any" value={value[key]} onChange={e=>onChange({...value,[key]:e.target.value===''?0:Number(e.target.value)})}/></label>)}
    {(['charger_count','station_count'] as const).map(key=><label key={key}>{key==='charger_count'?'Зарядок':'Рабочих постов'} вручную (пусто — автоматически)<input type="number" min="1" max="100000" step="1" value={value[key]??''} onChange={e=>onChange({...value,[key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}
    <label>Причина ручного количества<input value={value.override_reason} maxLength={1000} onChange={e=>onChange({...value,override_reason:e.target.value})}/></label>
    </div>
  </details>;
}

export function EquipmentTable({plan}:{plan:EquipmentPlan}) {
  return <div className="simulation-equipment"><h4>Вспомогательное оборудование</h4>
    <div className="economics__scroll" tabIndex={0} role="region" aria-label="Таблица расчёта: прокрутка по горизонтали"><table className="economics__table"><thead><tr><th>Позиция</th><th>Расчёт, шт.</th><th>Принято, шт.</th><th>Цена, ₽/шт.</th><th>Всего, ₽</th></tr></thead>
    <tbody>{plan.items.map(item=><tr key={item.code}><th>{item.name}</th><td>{item.calculated}</td><td>{item.quantity}</td><td>{item.unit_price.toLocaleString('ru-RU')}</td><td>{item.cost.toLocaleString('ru-RU')}</td></tr>)}</tbody></table></div>
    <p>Итого: {plan.total_cost.toLocaleString('ru-RU')} ₽, до резерва CAPEX. Инфраструктура в экономике — дополнительные затраты сверх этих позиций.</p>
    <details><summary>Формулы и допущения по оборудованию</summary><ul>{[...plan.formulas,...plan.assumptions].map(s=><li key={s}>{s}</li>)}</ul>{plan.inputs.override_reason&&<p>Ручная корректировка: {plan.inputs.override_reason}</p>}</details>
  </div>;
}

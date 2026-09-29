import { Coins, Plus, Trash2 } from "lucide-react";

import type { AcquisitionModel } from "../../api/types";
import { formatMoneyCompact, parseNumber } from "../../format";
import { Segmented, Switch } from "../../ui/Controls";
import { cx, Field, Input, TextArea } from "../../ui/Field";
import { emptyOffer, type OfferDraft } from "./draft";
import { SectionShell, type SectionProps } from "./Section";

const MODEL_LABELS: Record<AcquisitionModel, string> = { purchase: "Покупка", lease: "Лизинг", raas: "RaaS" };
const LABEL_EXAMPLES: Record<AcquisitionModel, string> = {
  purchase: "Базовая комплектация",
  lease: "Лизинг на 36 месяцев",
  raas: "Аренда с сервисом",
};

function moneyHint(text: string, suffix = ""): string | undefined {
  const value = parseNumber(text);
  return value !== null && !Number.isNaN(value) && value > 0 ? `≈ ${formatMoneyCompact(value)}${suffix}` : undefined;
}

interface MoneyFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  name: string;
  unit?: string;
  hint?: string;
  suffix?: string;
}

function MoneyField({ label, value, onChange, error, name, unit = "₽", hint, suffix }: MoneyFieldProps) {
  const id = `f-${name.replaceAll(".", "-")}`;
  return (
    <Field label={label} htmlFor={id} name={name} error={error} hint={moneyHint(value, suffix) ?? hint}>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} unit={unit} invalid={Boolean(error)} placeholder="0" />
    </Field>
  );
}

interface OfferCardProps {
  offer: OfferDraft;
  index: number;
  single: boolean;
  errors: Record<string, string>;
  onChange: (changes: Partial<OfferDraft>) => void;
  onDefault: () => void;
  onRemove: () => void;
}

function OfferCard({ offer, index, single, errors, onChange, onDefault, onRemove }: OfferCardProps) {
  const key = `offers.${index}`;
  const rented = offer.model !== "purchase";
  const e = (field: string) => errors[`${key}.${field}`];
  return (
    <div className={cx("offer", offer.isDefault && "offer--default")} data-field={key}>
      <div className="offer__head">
        <Segmented
          label="Модель приобретения"
          size="sm"
          options={(Object.keys(MODEL_LABELS) as AcquisitionModel[]).map((value) => ({ value, label: MODEL_LABELS[value] }))}
          value={offer.model}
          onChange={(model) => onChange({ model, months: model === "purchase" ? "" : offer.months || "36" })}
        />
        <label className="offer__default">
          <input type="radio" name="default-offer" checked={offer.isDefault} onChange={onDefault} />
          Основное предложение
        </label>
        {!single && (
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={onRemove} aria-label="Удалить вариант">
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="offer__grid">
        <Field label="Название варианта" htmlFor={`f-${key}-label`} name={`${key}.label`} error={e("label")}>
          <Input id={`f-${key}-label`} value={offer.label} onChange={(ev) => onChange({ label: ev.target.value })} placeholder={LABEL_EXAMPLES[offer.model]} />
        </Field>
        {rented && (
          <>
            <MoneyField label="Платёж в месяц" name={`${key}.monthly_fee`} value={offer.monthly} onChange={(monthly) => onChange({ monthly })} error={e("monthly_fee")} unit="₽/мес" suffix=" в месяц" />
            <Field label="Минимальный срок договора" htmlFor={`f-${key}-months`} name={`${key}.min_contract_months`} error={e("min_contract_months")}>
              <Input id={`f-${key}-months`} inputMode="numeric" value={offer.months} onChange={(ev) => onChange({ months: ev.target.value })} unit="мес." placeholder="36" invalid={Boolean(e("min_contract_months"))} />
            </Field>
          </>
        )}
        <MoneyField
          label={rented ? "Стоимость оборудования (выкуп)" : "Стоимость оборудования"}
          name={`${key}.equipment_price`}
          value={offer.equipment}
          onChange={(equipment) => onChange({ equipment })}
          error={e("equipment_price")}
          hint={rented ? "Для расчёта выкупа по окончании договора" : "За единицу, без доставки и пусконаладки"}
        />
        {!rented && (
          <>
            <MoneyField label="Программное обеспечение" name={`${key}.software_price`} value={offer.software} onChange={(software) => onChange({ software })} error={e("software_price")} hint="Лицензии управления парком, если продаются отдельно" />
            <MoneyField label="Внедрение и интеграция" name={`${key}.implementation_price`} value={offer.implementation} onChange={(implementation) => onChange({ implementation })} error={e("implementation_price")} hint="Пусконаладка, интеграция с WMS / ERP" />
          </>
        )}
        <MoneyField
          label="Обслуживание в год"
          name={`${key}.annual_service_cost`}
          value={offer.service}
          onChange={(service) => onChange({ service })}
          error={e("annual_service_cost")}
          unit="₽/год"
          suffix=" в год"
          hint={rented ? "Если сервис не входит в платёж" : "Сервисный контракт производителя"}
        />
        <Field
          label="Что входит в стоимость"
          htmlFor={`f-${key}-included-services`}
          name={`${key}.included_services`}
          error={e("included_services")}
          className="field--wide"
          hint="Комплектация, лицензии, обучение и услуги, включённые в предложение"
        >
          <TextArea
            id={`f-${key}-included-services`}
            value={offer.includedServices}
            onChange={(ev) => onChange({ includedServices: ev.target.value })}
            invalid={Boolean(e("included_services"))}
            placeholder="Например: робот, зарядная станция, настройка и обучение операторов"
          />
        </Field>
        <Field
          label="Условия и примечания к цене"
          htmlFor={`f-${key}-notes`}
          name={`${key}.notes`}
          error={e("notes")}
          className="field--wide"
          hint="Уточнения источника, срок действия цены и условия поставки"
        >
          <TextArea
            id={`f-${key}-notes`}
            value={offer.notes}
            onChange={(ev) => onChange({ notes: ev.target.value })}
            invalid={Boolean(e("notes"))}
            placeholder="Например: цена за комплект; окончательная стоимость уточняется в КП"
          />
        </Field>
      </div>
      <Switch checked={offer.vat} onChange={(vat) => onChange({ vat })} label="Цены с НДС" description="Цены каталога организатора указаны с НДС" />
    </div>
  );
}

export function EconomicsSection({ draft, patch, errors }: SectionProps) {
  const update = (index: number, changes: Partial<OfferDraft>) =>
    patch({ offers: draft.offers.map((o, i) => (i === index ? { ...o, ...changes } : o)) }, `offers.${index}`);
  const setDefault = (index: number) => patch({ offers: draft.offers.map((o, i) => ({ ...o, isDefault: i === index })) });
  const remove = (index: number) => {
    const offers = draft.offers.filter((_, i) => i !== index);
    if (offers.length && !offers.some((o) => o.isDefault)) offers[0] = { ...offers[0], isDefault: true };
    patch({ offers }, "offers");
  };
  const add = (model: AcquisitionModel) => patch({ offers: [...draft.offers, emptyOffer(model, draft.offers.length === 0)] });

  return (
    <SectionShell
      id="economics"
      icon={Coins}
      title="Экономика"
      lead="Ориентировочная стоимость по моделям приобретения: из этих данных считаются CAPEX, OPEX и окупаемость."
    >
      <div className="offers">
        {draft.offers.map((offer, index) => (
          <OfferCard
            key={offer.key}
            offer={offer}
            index={index}
            single={draft.offers.length === 1}
            errors={errors}
            onChange={(changes) => update(index, changes)}
            onDefault={() => setDefault(index)}
            onRemove={() => remove(index)}
          />
        ))}
        <div className="offers__add">
          <span>Добавить вариант:</span>
          {(Object.keys(MODEL_LABELS) as AcquisitionModel[]).map((model) => (
            <button key={model} type="button" className="btn btn--subtle btn--sm" onClick={() => add(model)}>
              <Plus size={14} aria-hidden="true" />
              {MODEL_LABELS[model]}
            </button>
          ))}
        </div>
      </div>
      <div className="form-grid">
        <Field label="Срок службы" htmlFor="p-life" name="service_life_years" error={errors.service_life_years} hint="Период амортизации в расчёте TCO">
          <Input
            id="p-life"
            inputMode="decimal"
            value={draft.serviceLife}
            onChange={(e) => patch({ serviceLife: e.target.value }, "service_life_years")}
            unit="лет"
            placeholder="7"
            invalid={Boolean(errors.service_life_years)}
          />
        </Field>
      </div>
    </SectionShell>
  );
}

import { useEffect, useState, type ReactNode } from "react";

import type { CatalogFacets, CatalogFilterInfo, FacetValue, SpecFilterInfo } from "../../api/types";
import { formatMoneyCompact, formatNumber, parseNumber } from "../../format";
import { Segmented, Switch } from "../../ui/Controls";
import { cx, Input } from "../../ui/Field";
import { specValue, toggleValue, withSpec, withValue, type SpecOperator } from "./params";

interface FiltersProps {
  params: URLSearchParams;
  facets: CatalogFacets | null;
  info: CatalogFilterInfo | null;
  onChange: (next: URLSearchParams) => void;
}

function Group({ title, hint, children, open = false }: { title: string; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="fgroup" open={open}>
      <summary>
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </summary>
      <div className="fgroup__body">{children}</div>
    </details>
  );
}

function Checks({ label, param, values, params, onChange, limit = 6 }: {
  label: string;
  param: string;
  values: FacetValue[];
  params: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const selected = params.getAll(param);
  const shown = all ? values : values.slice(0, limit);
  if (!values.length && !selected.length) return null;
  return (
    <fieldset className="fchecks">
      <legend>{label}</legend>
      {shown.map((facet) => (
        <label key={facet.value} className={cx("fcheck", facet.count === 0 && "is-empty")}>
          <input type="checkbox" checked={selected.includes(facet.value)} onChange={() => onChange(toggleValue(params, param, facet.value))} />
          <span className="fcheck__label">{facet.label}</span>
          <span className="fcheck__count">{facet.count}</span>
        </label>
      ))}
      {values.length > limit && (
        <button type="button" className="link-button" onClick={() => setAll(!all)}>
          {all ? "Свернуть" : `Показать все (${values.length})`}
        </button>
      )}
    </fieldset>
  );
}

/** Число с отложенным применением: фильтр срабатывает после паузы в наборе, по Enter или при уходе из поля. */
function NumberFilter({ id, label, unit, value, placeholder, onCommit }: {
  id: string;
  label: string;
  unit?: string | null;
  value: string;
  placeholder?: string;
  onCommit: (value: string | null) => void;
}) {
  const [text, setText] = useState(value.replace(".", ","));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(value.replace(".", ",")), [value]);

  const commit = (raw: string) => {
    const number = parseNumber(raw);
    if (number !== null && Number.isNaN(number)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = number === null ? null : String(number);
    if ((next ?? "") !== value) onCommit(next);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => commit(text), 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <label className="fnumber" htmlFor={id}>
      <span className="fnumber__label">{label}</span>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => e.key === "Enter" && commit(text)}
        unit={unit ?? undefined}
        placeholder={placeholder}
        invalid={invalid}
      />
    </label>
  );
}

function rangeHint(spec: SpecFilterInfo): string | undefined {
  if (spec.min === null || spec.max === null) return undefined;
  return spec.min === spec.max ? formatNumber(spec.min) : `${formatNumber(spec.min)}–${formatNumber(spec.max)}`;
}

function SpecFilter({ spec, params, onChange }: { spec: SpecFilterInfo; params: URLSearchParams; onChange: (next: URLSearchParams) => void }) {
  const set = (op: SpecOperator) => (value: string | null) => onChange(withSpec(params, spec.code, op, value));
  const id = `f-${spec.code}`;
  const hint = rangeHint(spec);
  if (spec.operator === ">=" || spec.operator === "<=") {
    const op = spec.operator;
    return (
      <NumberFilter
        id={id}
        label={`${spec.name}, ${op === ">=" ? "не меньше" : "не больше"}`}
        unit={spec.unit}
        value={specValue(params, spec.code, op)}
        placeholder={hint ? `в каталоге ${hint}` : undefined}
        onCommit={set(op)}
      />
    );
  }
  if (spec.operator === "range") {
    return (
      <div className="frange">
        <span className="fnumber__label">{spec.name}: работает при</span>
        <div className="frange__inputs">
          <NumberFilter id={`${id}-min`} label="от" unit={spec.unit} value={specValue(params, spec.code, "<=")} placeholder={spec.min !== null ? formatNumber(spec.min) : undefined} onCommit={set("<=")} />
          <NumberFilter id={`${id}-max`} label="до" unit={spec.unit} value={specValue(params, spec.code, ">=")} placeholder={spec.max !== null ? formatNumber(spec.max) : undefined} onCommit={set(">=")} />
        </div>
      </div>
    );
  }
  if (spec.operator === "=") {
    return (
      <Switch
        checked={specValue(params, spec.code, "=") === "true"}
        onChange={(on) => set("=")(on ? "true" : null)}
        label={spec.name}
      />
    );
  }
  const current = specValue(params, spec.code, "~");
  return (
    <div className="ftext">
      <span className="fnumber__label">{spec.name} содержит</span>
      <TextFilter id={id} value={current} onCommit={set("~")} />
      {spec.suggestions.length > 0 && (
        <div className="ftext__chips">
          {spec.suggestions.map((term) => (
            <button
              key={term}
              type="button"
              className={cx("chip", "chip--small", current.toLowerCase() === term.toLowerCase() && "is-on")}
              aria-pressed={current.toLowerCase() === term.toLowerCase()}
              onClick={() => set("~")(current.toLowerCase() === term.toLowerCase() ? null : term)}
            >
              {term}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TextFilter({ id, value, onCommit }: { id: string; value: string; onCommit: (value: string | null) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const timer = window.setTimeout(() => text.trim() !== value && onCommit(text.trim() || null), 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return <Input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="например, SLAM" />;
}

export function CatalogFilters({ params, facets, info, onChange }: FiltersProps) {
  const specsOf = (group: string) => (info?.specs ?? []).filter((s) => s.group === group && s.count > 0);
  const specCount = params.getAll("spec").length;
  const completeness = params.get("min_completeness") ?? "";

  return (
    <div className="cfilters">
      <Group title="Тип решения" hint={params.get("solution_type_id") ? "выбран" : undefined} open>
        <div className="ftypes">
          {(facets?.solution_types ?? []).slice(0, 12).map((facet) => {
            const on = params.get("solution_type_id") === facet.value;
            return (
              <button
                key={facet.value}
                type="button"
                className={cx("ftype", on && "is-on")}
                aria-pressed={on}
                onClick={() => onChange(withValue(params, "solution_type_id", on ? null : facet.value))}
              >
                <span className="ftype__name">{facet.label}</span>
                {facet.group && facet.group !== facet.label && <span className="ftype__group">{facet.group}</span>}
                <span className="fcheck__count">{facet.count}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Идентификация">
        <Checks label="Класс изделия" param="product_class" values={facets?.product_classes ?? []} params={params} onChange={onChange} />
        <Checks label="Статус доступности" param="readiness_status" values={facets?.readiness_statuses ?? []} params={params} onChange={onChange} />
        <Checks label="Страна происхождения" param="country" values={facets?.countries ?? []} params={params} onChange={onChange} />
      </Group>

      <Group title="Технические характеристики" hint={specCount ? `фильтров: ${specCount}` : undefined} open={specCount > 0}>
        {specsOf("technical").map((spec) => (
          <SpecFilter key={spec.code} spec={spec} params={params} onChange={onChange} />
        ))}
      </Group>

      {specsOf("infrastructure").length > 0 && (
        <Group title="Инфраструктура">
          {specsOf("infrastructure").map((spec) => (
            <SpecFilter key={spec.code} spec={spec} params={params} onChange={onChange} />
          ))}
        </Group>
      )}

      <Group title="Экономика">
        <NumberFilter
          id="f-price"
          label="Стоимость оборудования, не выше"
          unit="₽"
          value={params.get("price_max") ?? ""}
          placeholder={info?.price_min != null && info.price_max != null ? `${formatMoneyCompact(info.price_min)} — ${formatMoneyCompact(info.price_max)}` : undefined}
          onCommit={(value) => onChange(withValue(params, "price_max", value))}
        />
        <Checks label="Модель приобретения" param="acquisition_model" values={facets?.acquisition_models ?? []} params={params} onChange={onChange} />
      </Group>

      <Group title="Применимость">
        <label className="fcheck">
          <input type="checkbox" checked={params.get("has_cases") === "true"} onChange={(e) => onChange(withValue(params, "has_cases", e.target.checked ? "true" : null))} />
          <span className="fcheck__label">Есть реализованные кейсы</span>
          <span className="fcheck__count">{facets?.with_cases ?? ""}</span>
        </label>
      </Group>

      <Group title="Качество данных">
        <label className="fcheck">
          <input type="checkbox" checked={params.get("has_image") === "true"} onChange={(e) => onChange(withValue(params, "has_image", e.target.checked ? "true" : null))} />
          <span className="fcheck__label">С фотографией</span>
          <span className="fcheck__count">{facets?.with_image ?? ""}</span>
        </label>
        <div className="fcompleteness">
          <span className="fnumber__label">Полнота карточки не ниже</span>
          <Segmented
            label="Полнота карточки"
            size="sm"
            options={[
              { value: "", label: "Любая" },
              { value: "25", label: "25%" },
              { value: "50", label: "50%" },
              { value: "75", label: "75%" },
            ]}
            value={completeness}
            onChange={(value) => onChange(withValue(params, "min_completeness", value || null))}
          />
        </div>
        <Switch
          checked={params.get("confirmed_only") === "true"}
          onChange={(on) => onChange(withValue(params, "confirmed_only", on ? "true" : null))}
          label="Только подтверждённые значения"
        />
        <Switch
          checked={params.get("with_unknown") === "true"}
          onChange={(on) => onChange(withValue(params, "with_unknown", on ? "true" : null))}
          label="Показывать роботов без данных"
        />
      </Group>
    </div>
  );
}

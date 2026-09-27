import { BadgeCheck, Cable, Gauge } from "lucide-react";

import type { SpecDefinition } from "../../api/types";
import { Segmented } from "../../ui/Controls";
import { cx, Field, Input, TextArea } from "../../ui/Field";
import { emptySpec, isSpecFilled, type SpecDraft } from "./draft";
import { SectionShell, SPEC_HINTS, THROUGHPUT_UNITS, type SectionProps } from "./Section";

const DIMENSIONS = ["length_mm", "width_mm", "height_mm"] as const;
const LONG_TEXT = new Set(["floor_requirements", "charging_infrastructure", "integration", "service_requirements", "operating_conditions"]);
/** Однострочные поля на всю ширину: длинные примеры значений не обрезаются. */
const WIDE = new Set([...LONG_TEXT, "connectivity"]);

function MandatoryMark() {
  return <span className="mandatory-mark" title="Обязательная характеристика по п. 3.3.7 ТЗ — учитывается в полноте карточки" />;
}

function ConfirmToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className={cx("confirm-toggle", on && "is-on")}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title="Значение подтверждено источником: паспортом, сайтом производителя, протоколом испытаний"
    >
      <BadgeCheck size={14} aria-hidden="true" />
      {on ? "Подтверждено" : "Подтвердить"}
    </button>
  );
}

interface SpecFieldProps {
  definition: SpecDefinition;
  spec: SpecDraft;
  onChange: (changes: Partial<SpecDraft>) => void;
  errors: Record<string, string>;
}

function SpecField({ definition, spec, onChange, errors }: SpecFieldProps) {
  const id = `spec-${definition.code}`;
  const key = `specs.${definition.code}`;
  const hints = SPEC_HINTS[definition.code] ?? {};
  const error = errors[`${key}.value`] ?? errors[`${key}.value_max`] ?? errors[key];
  const filled = isSpecFilled(definition, spec);
  const label = (
    <>
      {definition.name}
      {definition.is_mandatory && <MandatoryMark />}
    </>
  );
  const aside = filled ? <ConfirmToggle on={spec.confirmed} onChange={(confirmed) => onChange({ confirmed })} /> : undefined;
  const unitInput = !definition.unit && definition.data_type !== "boolean" && definition.data_type !== "string" && (
    <>
      <input
        className="unit-input"
        aria-label={`Единица: ${definition.name}`}
        list="throughput-units"
        value={spec.unit}
        onChange={(e) => onChange({ unit: e.target.value })}
        placeholder="ед./ч"
      />
      <datalist id="throughput-units">
        {THROUGHPUT_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </>
  );

  let control;
  if (definition.data_type === "range") {
    control = (
      <div className="range-input">
        <Input
          id={id}
          inputMode="decimal"
          value={spec.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={hints.placeholder ? `от ${hints.placeholder}` : "от"}
          invalid={Boolean(errors[`${key}.value`])}
          unit={definition.unit ?? undefined}
          aria-label={`${definition.name}: от`}
        />
        <span className="range-input__dash" aria-hidden="true">
          —
        </span>
        <Input
          inputMode="decimal"
          value={spec.max}
          onChange={(e) => onChange({ max: e.target.value })}
          placeholder={hints.placeholderMax ? `до ${hints.placeholderMax}` : "до"}
          invalid={Boolean(errors[`${key}.value_max`])}
          unit={definition.unit ?? undefined}
          aria-label={`${definition.name}: до`}
        />
        {unitInput}
      </div>
    );
  } else if (definition.data_type === "number" || definition.data_type === "integer") {
    control = (
      <div className="range-input">
        <Input
          id={id}
          inputMode={definition.data_type === "integer" ? "numeric" : "decimal"}
          value={spec.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={hints.placeholder ? `например, ${hints.placeholder}` : undefined}
          invalid={Boolean(error)}
          unit={definition.unit ?? undefined}
        />
        {unitInput}
      </div>
    );
  } else if (definition.data_type === "boolean") {
    control = (
      <Segmented
        id={id}
        label={definition.name}
        size="sm"
        options={[
          { value: "yes", label: "Да" },
          { value: "no", label: "Нет" },
          { value: "unknown", label: "Не указано" },
        ]}
        value={spec.flag === null ? "unknown" : spec.flag ? "yes" : "no"}
        onChange={(value) => onChange({ flag: value === "unknown" ? null : value === "yes" })}
      />
    );
  } else if (LONG_TEXT.has(definition.code)) {
    control = (
      <TextArea
        id={id}
        rows={2}
        value={spec.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder={hints.placeholder ? `Например: ${hints.placeholder}` : undefined}
        invalid={Boolean(error)}
      />
    );
  } else {
    control = (
      <Input
        id={id}
        value={spec.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder={hints.placeholder ? `Например: ${hints.placeholder}` : undefined}
        invalid={Boolean(error)}
      />
    );
  }

  return (
    <Field label={label} htmlFor={id} name={key} error={error} hint={hints.hint ?? definition.description ?? undefined} aside={aside} className={cx(WIDE.has(definition.code) && "field--wide")}>
      {control}
    </Field>
  );
}

function DimensionsField({ definitions, specs, setSpec, errors }: { definitions: SpecDefinition[]; specs: Record<string, SpecDraft>; setSpec: SectionProps["setSpec"]; errors: Record<string, string> }) {
  const parts = DIMENSIONS.map((code) => definitions.find((d) => d.code === code)).filter((d): d is SpecDefinition => Boolean(d));
  if (parts.length === 0) return null;
  const error = DIMENSIONS.map((code) => errors[`specs.${code}.value`]).find(Boolean);
  const filled = parts.some((d) => isSpecFilled(d, specs[d.code]));
  const confirmed = parts.every((d) => specs[d.code]?.confirmed);
  const labels = { length_mm: "Длина", width_mm: "Ширина", height_mm: "Высота" } as const;
  const examples = { length_mm: "1200", width_mm: "800", height_mm: "320" } as const;
  return (
    <Field
      label={
        <>
          Габариты: длина × ширина × высота
          <MandatoryMark />
        </>
      }
      htmlFor="spec-length_mm"
      name="specs.length_mm"
      error={error}
      hint="3D-модель справа строится по этим размерам"
      className="field--wide"
      aside={filled ? <ConfirmToggle on={confirmed} onChange={(on) => parts.forEach((d) => setSpec(d.code, { confirmed: on }))} /> : undefined}
    >
      <div className="dims-input">
        {parts.map((definition, index) => {
          const code = definition.code as (typeof DIMENSIONS)[number];
          return (
            <div key={code} className="dims-input__part" data-field={`specs.${code}`}>
              {index > 0 && (
                <span className="dims-input__times" aria-hidden="true">
                  ×
                </span>
              )}
              <Input
                id={`spec-${code}`}
                inputMode="decimal"
                value={specs[code]?.value ?? ""}
                onChange={(e) => setSpec(code, { value: e.target.value })}
                placeholder={examples[code]}
                aria-label={`${labels[code]}, мм`}
                invalid={Boolean(errors[`specs.${code}.value`])}
                unit={index === parts.length - 1 ? "мм" : undefined}
              />
              <span className="dims-input__label">{labels[code]}</span>
            </div>
          );
        })}
      </div>
    </Field>
  );
}

interface SpecsSectionProps extends SectionProps {
  group: "technical" | "infrastructure";
}

export function SpecsSection({ group, draft, setSpec, errors, reference }: SpecsSectionProps) {
  const definitions = reference.specs.filter((d) => d.group === group);
  const regular = definitions.filter((d) => !DIMENSIONS.includes(d.code as (typeof DIMENSIONS)[number]));
  const mandatory = regular.filter((d) => d.is_mandatory);
  const optional = regular.filter((d) => !d.is_mandatory);
  const spec = (code: string) => draft.specs[code] ?? emptySpec();
  const render = (definition: SpecDefinition) => (
    <SpecField
      key={definition.code}
      definition={definition}
      spec={spec(definition.code)}
      onChange={(changes) => setSpec(definition.code, changes)}
      errors={errors}
    />
  );
  const optionalFilled = optional.filter((d) => isSpecFilled(d, draft.specs[d.code])).length;

  const technical = group === "technical";
  return (
    <SectionShell
      id={group}
      icon={technical ? Gauge : Cable}
      title={technical ? "Технические характеристики" : "Инфраструктура"}
      lead={
        technical
          ? "Используются для подбора: робот исключается, если груз тяжелее грузоподъёмности или проход уже габаритов."
          : "Что нужно подготовить на объекте: покрытие, проходы, зарядка, связь, интеграция и сервис."
      }
      aside={
        <span className="legend">
          <MandatoryMark /> обязательная по ТЗ
        </span>
      }
    >
      <div className="spec-grid">
        {technical && <DimensionsField definitions={definitions} specs={draft.specs} setSpec={setSpec} errors={errors} />}
        {mandatory.map(render)}
      </div>
      {optional.length > 0 && (
        <details className="spec-more" open={optionalFilled > 0}>
          <summary>
            Дополнительные характеристики
            <span className="spec-more__count">
              {optionalFilled > 0 ? `${optionalFilled} из ${optional.length}` : optional.length}
            </span>
          </summary>
          <div className="spec-grid">{optional.map(render)}</div>
        </details>
      )}
    </SectionShell>
  );
}

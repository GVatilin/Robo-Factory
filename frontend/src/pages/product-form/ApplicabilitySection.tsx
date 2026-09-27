import { Check, Hospital, Plane, Plus, Sparkles, Target, Trash2, Warehouse, type LucideIcon } from "lucide-react";

import { cx, Field, Input, TextArea } from "../../ui/Field";
import { emptyCase, type CaseDraft } from "./draft";
import { SectionShell, type SectionProps } from "./Section";

const FACILITY_ICON: Record<string, LucideIcon> = { warehouse: Warehouse, airport: Plane, medical: Hospital };

interface ApplicabilitySectionProps extends SectionProps {
  /** Тип решения и его категория: процессы, где они применимы, отмечаются как рекомендуемые. */
  typeIds: number[];
}

export function ApplicabilitySection({ draft, patch, errors, reference, typeIds }: ApplicabilitySectionProps) {
  const selected = new Set(draft.processIds);
  const recommended = reference.facilities.flatMap((f) =>
    f.processes.filter((p) => p.solution_type_ids.some((id) => typeIds.includes(id))).map((p) => p.id),
  );
  const missingRecommended = recommended.filter((id) => !selected.has(id));

  const toggle = (id: number) =>
    patch({ processIds: selected.has(id) ? draft.processIds.filter((p) => p !== id) : [...draft.processIds, id] }, "process_ids");
  const updateCase = (index: number, changes: Partial<CaseDraft>) =>
    patch({ cases: draft.cases.map((c, i) => (i === index ? { ...c, ...changes } : c)) }, `applications.${index}`);

  return (
    <SectionShell
      id="applicability"
      icon={Target}
      title="Применимость"
      lead="Где решение работает: процессы на объектах, ограничения и реализованные кейсы."
      aside={
        missingRecommended.length > 0 && (
          <button type="button" className="btn btn--subtle btn--sm" onClick={() => patch({ processIds: [...draft.processIds, ...missingRecommended] }, "process_ids")}>
            <Sparkles size={14} aria-hidden="true" />
            Отметить рекомендуемые ({missingRecommended.length})
          </button>
        )
      }
    >
      <Field
        label="Поддерживаемые процессы"
        name="process_ids"
        error={errors.process_ids}
        hint={
          typeIds.length
            ? "Значком отмечены процессы, к которым применим выбранный тип решения"
            : "Выберите тип решения — платформа подскажет подходящие процессы"
        }
      >
        <div className="facilities">
          {reference.facilities.map((facility) => {
            const Icon = FACILITY_ICON[facility.code] ?? Warehouse;
            const count = facility.processes.filter((p) => selected.has(p.id)).length;
            return (
              <div key={facility.id} className="facility">
                <div className="facility__head">
                  <Icon size={17} aria-hidden="true" />
                  <span>{facility.name}</span>
                  {count > 0 && <span className="facility__count">{count}</span>}
                </div>
                <div className="chips">
                  {facility.processes.map((process) => {
                    const on = selected.has(process.id);
                    const hint = recommended.includes(process.id);
                    return (
                      <button
                        key={process.id}
                        type="button"
                        className={cx("chip", on && "is-on", hint && "chip--hint")}
                        aria-pressed={on}
                        onClick={() => toggle(process.id)}
                        title={hint ? "Тип решения применим к этому процессу" : undefined}
                      >
                        {on ? <Check size={13} aria-hidden="true" /> : hint ? <Sparkles size={13} aria-hidden="true" /> : null}
                        {process.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Field>

      <Field
        label="Ограничения применения"
        htmlFor="p-limitations"
        name="limitations"
        error={errors.limitations}
        hint="Условия, при которых решение не подходит: подбор исключит его для таких объектов"
      >
        <TextArea
          id="p-limitations"
          rows={3}
          value={draft.limitations}
          onChange={(e) => patch({ limitations: e.target.value }, "limitations")}
          placeholder="Только отапливаемые помещения; уклон пола не более 3%; не работает с открытым огнём"
        />
      </Field>

      <div className="cases" data-field="applications">
        <div className="cases__head">
          <span className="field__label">Реализованные кейсы</span>
          <span className="field__hint">Внедрения у заказчиков: отрасль, сценарий и результат</span>
        </div>
        {draft.cases.map((item, index) => (
          <div key={item.key} className="case">
            <div className="case__grid">
              <Field label="Отрасль" htmlFor={`case-${item.key}-industry`} name={`applications.${index}.industry_id`} error={errors[`applications.${index}.industry_id`]}>
                <select
                  id={`case-${item.key}-industry`}
                  className="select"
                  value={item.industryId ?? ""}
                  onChange={(e) => updateCase(index, { industryId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Не указана</option>
                  {reference.industries.map((industry) => (
                    <option key={industry.id} value={industry.id}>
                      {industry.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Сценарий" htmlFor={`case-${item.key}-scenario`} name={`applications.${index}.scenario`} error={errors[`applications.${index}.scenario`]}>
                <Input id={`case-${item.key}-scenario`} value={item.scenario} onChange={(e) => updateCase(index, { scenario: e.target.value })} placeholder="Внутрискладская логистика" />
              </Field>
            </div>
            <Field label="Описание и результат" htmlFor={`case-${item.key}-text`} name={`applications.${index}.case_description`} error={errors[`applications.${index}.case_description`]}>
              <TextArea
                id={`case-${item.key}-text`}
                rows={2}
                value={item.description}
                onChange={(e) => updateCase(index, { description: e.target.value })}
                placeholder="48 роботов на складе заказчика: производительность выросла с 4 до 8 тыс. отгрузок за смену"
              />
            </Field>
            <button type="button" className="btn btn--ghost btn--sm case__remove" onClick={() => patch({ cases: draft.cases.filter((_, i) => i !== index) }, "applications")}>
              <Trash2 size={14} aria-hidden="true" />
              Удалить кейс
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--subtle btn--sm cases__add" onClick={() => patch({ cases: [...draft.cases, emptyCase()] })}>
          <Plus size={14} aria-hidden="true" />
          Добавить кейс
        </button>
      </div>
    </SectionShell>
  );
}

import { ExternalLink, Fingerprint, Lock, RefreshCw } from "lucide-react";
import { useMemo } from "react";

import type { ManufacturerSummary, ProductClass, ReadinessStatus } from "../../api/types";
import { companyShortName } from "../../format";
import { Combobox, type ComboOption } from "../../ui/Combobox";
import { Segmented } from "../../ui/Controls";
import { Field, Input, TextArea } from "../../ui/Field";
import { SectionShell, type SectionProps } from "./Section";

const TRL_STAGES: Record<number, string> = {
  1: "Фундаментальные принципы",
  2: "Концепция технологии",
  3: "Экспериментальное подтверждение концепции",
  4: "Макет в лаборатории",
  5: "Макет в условиях, близких к реальным",
  6: "Прототип в условиях, близких к реальным",
  7: "Прототип в реальных условиях",
  8: "Готовая система прошла испытания",
  9: "Система успешно эксплуатируется",
};

interface IdentitySectionProps extends SectionProps {
  manufacturers: ManufacturerSummary[] | null;
  lockedManufacturer: { id: number; name: string } | null;
  canCreateManufacturer: boolean;
  onReloadManufacturers: () => void;
}

export function IdentitySection({
  draft,
  patch,
  errors,
  reference,
  manufacturers,
  lockedManufacturer,
  canCreateManufacturer,
  onReloadManufacturers,
}: IdentitySectionProps) {
  const manufacturerOptions = useMemo<ComboOption[]>(
    () =>
      (manufacturers ?? []).map((m) => ({
        value: m.id,
        label: companyShortName(m.name),
        description: [m.name !== companyShortName(m.name) ? m.name : null, m.region].filter(Boolean).join(" · "),
        meta: m.product_count ? `${m.product_count}` : undefined,
      })),
    [manufacturers],
  );

  const typeOptions = useMemo<ComboOption[]>(
    () =>
      reference.solutionTypes.flatMap((category) => [
        { value: category.id, label: category.name, group: category.name, description: "Категория без уточнения типа" },
        ...category.children.map((type) => ({
          value: type.id,
          label: type.name,
          group: category.name,
          description: type.description ?? undefined,
        })),
      ]),
    [reference.solutionTypes],
  );

  const classes = reference.options.product_classes.map((o) => ({
    value: o.value as ProductClass,
    label: o.value === "brs" ? "БРС" : o.value === "bas" ? "БАС" : "ПО",
    title: o.label,
  }));
  const shortReadiness: Record<string, string> = { operation: "Серийно", piloting: "Пилот", rnd: "НИОКР" };
  const readiness = reference.options.readiness_statuses.map((o) => ({
    value: o.value as ReadinessStatus,
    label: shortReadiness[o.value] ?? o.label,
    title: o.label,
  }));

  return (
    <SectionShell
      id="identity"
      icon={Fingerprint}
      title="Основное"
      lead="Идентификация решения: производитель, наименование, тип и статус доступности."
    >
      <Field label="Наименование" htmlFor="p-name" required error={errors.name} name="name" hint="Модель и ключевая модификация, как у производителя">
        <Input
          id="p-name"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value }, "name")}
          placeholder="Ronavi H1500"
          invalid={Boolean(errors.name)}
          maxLength={300}
        />
      </Field>

      <div className="form-grid">
        <Field
          label="Производитель"
          htmlFor="p-manufacturer"
          required
          error={errors.manufacturer_id}
          name="manufacturer_id"
          hint={lockedManufacturer ? "Вендор добавляет товары только своей компании" : undefined}
        >
          {lockedManufacturer ? (
            <Input id="p-manufacturer" value={companyShortName(lockedManufacturer.name)} disabled icon={<Lock size={15} />} />
          ) : (
            <Combobox
              id="p-manufacturer"
              options={manufacturerOptions}
              value={draft.manufacturerId}
              onChange={(value) => patch({ manufacturerId: value }, "manufacturer_id")}
              placeholder={manufacturers ? "Найдите компанию" : "Загружаем производителей…"}
              invalid={Boolean(errors.manufacturer_id)}
              emptyText="Такого производителя нет в каталоге"
              footer={
                canCreateManufacturer && (
                  <div className="combo-footer">
                    <a className="btn btn--subtle btn--sm" href="/manufacturers/new" target="_blank" rel="noreferrer">
                      <ExternalLink size={14} aria-hidden="true" />
                      Новый производитель
                    </a>
                    <button type="button" className="btn btn--ghost btn--sm" onPointerDown={(e) => e.preventDefault()} onClick={onReloadManufacturers}>
                      <RefreshCw size={14} aria-hidden="true" />
                      Обновить список
                    </button>
                  </div>
                )
              }
            />
          )}
        </Field>
        <Field label="Тип решения" htmlFor="p-type" required error={errors.solution_type_id} name="solution_type_id" hint="Определяет 3D-модель и подходящие процессы">
          <Combobox
            id="p-type"
            options={typeOptions}
            value={draft.solutionTypeId}
            onChange={(value) => patch({ solutionTypeId: value }, "solution_type_id")}
            placeholder="AMR, робот-уборщик, FMR…"
            invalid={Boolean(errors.solution_type_id)}
          />
        </Field>
      </div>

      <div className="form-grid">
        <Field label="Класс изделия" htmlFor="p-class" name="product_class">
          <Segmented id="p-class" label="Класс изделия" options={classes} value={draft.productClass} onChange={(value) => patch({ productClass: value })} />
        </Field>
        <Field
          label="Статус доступности"
          htmlFor="p-readiness"
          name="readiness_status"
          error={errors.readiness_status}
          hint={reference.options.readiness_statuses.find((o) => o.value === draft.readiness)?.label}
        >
          <Segmented id="p-readiness" label="Статус доступности" options={readiness} value={draft.readiness} onChange={(value) => patch({ readiness: value }, "readiness_status")} />
        </Field>
      </div>

      <Field
        label="Уровень готовности технологии (УГТ)"
        htmlFor="p-trl"
        name="trl"
        error={errors.trl}
        hint={draft.trl ? `УГТ ${draft.trl}: ${TRL_STAGES[draft.trl]}` : "Шкала 1–9 по ГОСТ Р 58048-2017"}
        aside={
          draft.trl !== null && (
            <button type="button" className="link-button" onClick={() => patch({ trl: null }, "trl")}>
              Сбросить
            </button>
          )
        }
      >
        <Segmented
          id="p-trl"
          label="УГТ"
          size="sm"
          options={Array.from({ length: 9 }, (_, i) => ({ value: i + 1, label: String(i + 1), title: TRL_STAGES[i + 1] }))}
          value={draft.trl}
          onChange={(value) => patch({ trl: value }, "trl")}
        />
      </Field>

      <div className="form-grid">
        <Field label="Страна происхождения" htmlFor="p-country" name="country_of_origin" error={errors.country_of_origin}>
          <Input id="p-country" value={draft.country} onChange={(e) => patch({ country: e.target.value }, "country_of_origin")} placeholder="Россия" list="countries" />
          <datalist id="countries">
            {["Россия", "Беларусь", "Китай", "Казахстан", "Германия", "Япония", "Республика Корея"].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Регион производства" htmlFor="p-region" name="region" error={errors.region}>
          <Input id="p-region" value={draft.region} onChange={(e) => patch({ region: e.target.value }, "region")} placeholder="Москва" />
        </Field>
      </div>

      <Field label="Назначение" htmlFor="p-purpose" name="purpose" error={errors.purpose} hint="Какие операции выполняет: одно-два предложения">
        <TextArea
          id="p-purpose"
          value={draft.purpose}
          onChange={(e) => patch({ purpose: e.target.value }, "purpose")}
          rows={2}
          placeholder="Перемещение паллет и тележек между зонами склада"
        />
      </Field>
      <Field label="Описание" htmlFor="p-description" name="description" error={errors.description}>
        <TextArea
          id="p-description"
          value={draft.description}
          onChange={(e) => patch({ description: e.target.value }, "description")}
          rows={4}
          placeholder="Конструкция, особенности, отличия от аналогов"
        />
      </Field>
    </SectionShell>
  );
}

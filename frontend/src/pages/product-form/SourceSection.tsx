import { ExternalLink, FileText, Info, Send } from "lucide-react";

import type { Source } from "../../api/types";
import { formatDate } from "../../format";
import { Notice, Switch } from "../../ui/Controls";
import { Field, Input } from "../../ui/Field";
import { today } from "./draft";
import { SectionShell, type SectionProps } from "./Section";

interface SourceSectionProps extends SectionProps {
  existingSources: Source[];
  canPublish: boolean;
  isVendor: boolean;
  wasPublished: boolean | null;
}

export function SourceSection({ draft, patch, errors, reference, existingSources, canPublish, isVendor, wasPublished }: SourceSectionProps) {
  const source = draft.source;
  const setSource = (changes: Partial<typeof source>, clear?: string) => patch({ source: { ...source, ...changes } }, clear);
  const types = reference.options.source_types.filter((o) => !["organizer", "team_assumption"].includes(o.value));

  return (
    <SectionShell
      id="source"
      icon={FileText}
      title="Источник и публикация"
      lead="Каждая новая или изменённая характеристика и цена сохраняется со ссылкой на источник и датой получения (п. 3.3.4 ТЗ)."
    >
      <div className="form-grid">
        <Field label="Тип источника" htmlFor="s-type" name="source.source_type">
          <select id="s-type" className="select" value={source.type} onChange={(e) => setSource({ type: e.target.value })}>
            {types.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дата получения данных" htmlFor="s-date" name="source.retrieved_at" error={errors["source.retrieved_at"]} hint="Дата актуализации карточки">
          <Input id="s-date" type="date" value={source.retrievedAt} max={today()} onChange={(e) => setSource({ retrievedAt: e.target.value }, "source.retrieved_at")} />
        </Field>
      </div>
      <Field label="Название документа" htmlFor="s-title" name="source.title" error={errors["source.title"]}>
        <Input id="s-title" value={source.title} onChange={(e) => setSource({ title: e.target.value }, "source.title")} placeholder="Технический паспорт Ronavi H1500, ред. 2026" />
      </Field>
      <Field label="Ссылка" htmlFor="s-url" name="source.url" error={errors["source.url"]} hint="Страница товара на сайте производителя, PDF паспорта или публичного каталога">
        <Input
          id="s-url"
          inputMode="url"
          value={source.url}
          onChange={(e) => setSource({ url: e.target.value }, "source.url")}
          placeholder="https://ronavi-robotics.ru/products/h1500"
          invalid={Boolean(errors["source.url"])}
        />
      </Field>
      {!source.title.trim() && !source.url.trim() && (
        <Notice tone="info" icon={<Info size={17} aria-hidden="true" />}>
          Без названия и ссылки значения будут отмечены как{" "}
          {isVendor ? "«Данные производителя из кабинета вендора»" : "«Ручной ввод администратора каталога»"}.
        </Notice>
      )}

      {existingSources.length > 0 && (
        <div className="sources">
          <span className="field__label">Источники карточки</span>
          <ul>
            {existingSources.map((s) => (
              <li key={s.id}>
                <FileText size={14} aria-hidden="true" />
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.title}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : (
                  <span>{s.title}</span>
                )}
                {s.retrieved_at && <span className="sources__date">{formatDate(s.retrieved_at)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="publish" data-field="is_published">
        {canPublish ? (
          <Switch
            checked={draft.isPublished}
            onChange={(isPublished) => patch({ isPublished })}
            label="Опубликовать в каталоге"
            description={
              draft.isPublished
                ? "Товар виден всем, включая гостей, и участвует в подборе решений."
                : "Товар сохранится как черновик: его видят только администраторы и вендор компании."
            }
          />
        ) : (
          <Notice tone="warning" icon={<Send size={17} aria-hidden="true" />}>
            <strong>{wasPublished ? "Изменения отправятся на повторную проверку" : "Товар отправится на проверку"}</strong>
            <span>
              Администратор проверит карточку и опубликует её в каталоге. До публикации товар видите вы и администраторы.
            </span>
          </Notice>
        )}
      </div>
    </SectionShell>
  );
}

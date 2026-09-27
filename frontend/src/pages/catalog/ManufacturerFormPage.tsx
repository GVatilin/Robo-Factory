import { Building2, Globe, Mail, MapPin, Phone, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { api, ApiError } from "../../api/client";
import { useApi } from "../../api/hooks";
import type { Manufacturer, ManufacturerInput } from "../../api/types";
import { companyShortName } from "../../format";
import { Avatar, ErrorState, Notice, Spinner } from "../../ui/Controls";
import { Field, Input, TextArea } from "../../ui/Field";
import "./Catalog.css";

const EMPTY = { name: "", country: "Россия", region: "", website: "", contact_email: "", phone: "", description: "" };
type Draft = typeof EMPTY;

function toInput(draft: Draft): ManufacturerInput {
  const value = (text: string) => text.trim() || null;
  return {
    name: draft.name.trim(),
    country: value(draft.country),
    region: value(draft.region),
    website: value(draft.website),
    contact_email: value(draft.contact_email),
    phone: value(draft.phone),
    description: value(draft.description),
  };
}

function validate(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.name.trim().length < 2) errors.name = "Укажите название компании — не короче 2 символов";
  if (draft.contact_email.trim() && !/^\S+@\S+\.\S+$/.test(draft.contact_email.trim()))
    errors.contact_email = "Введите корректный e-mail, например info@company.ru";
  if (draft.website.trim() && (!draft.website.includes(".") || /\s/.test(draft.website.trim())))
    errors.website = "Укажите адрес сайта, например https://company.ru";
  return errors;
}

export default function ManufacturerFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const existing = useApi<Manufacturer>(editing ? `/manufacturers/${id}` : null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const m = existing.data;
    if (!m) return;
    setDraft({
      name: m.name,
      country: m.country ?? "",
      region: m.region ?? "",
      website: m.website ?? "",
      contact_email: m.contact_email ?? "",
      phone: m.phone ?? "",
      description: m.description ?? "",
    });
  }, [existing.data]);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors(({ [key]: _, ...rest }) => rest);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local = validate(draft);
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api<Manufacturer>(editing ? `/manufacturers/${id}` : "/manufacturers", {
        method: editing ? "PUT" : "POST",
        body: toInput(draft),
      });
      navigate(`/manufacturers/${saved.id}`, { replace: true });
    } catch (reason) {
      if (reason instanceof ApiError) {
        setErrors(reason.fields);
        if (!Object.keys(reason.fields).length) setError(reason.message);
      } else {
        setError("Не удалось сохранить. Повторите попытку.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (editing && existing.error) return <div className="page"><ErrorState message={existing.error.message} onRetry={existing.reload} /></div>;
  if (editing && !existing.data) return <div className="page page--center"><Spinner /></div>;
  if (editing && existing.data && !existing.data.can_edit) {
    return (
      <div className="page">
        <Notice tone="warning">Изменять карточку может администратор или вендор этой компании.</Notice>
      </div>
    );
  }

  const previewName = draft.name.trim() || "Новый производитель";
  const location = [draft.region.trim(), draft.country.trim()].filter(Boolean).join(", ");

  return (
    <div className="page">
      <ol className="crumbs">
        <li>
          <Link to="/manufacturers">Производители</Link>
        </li>
        {editing && existing.data && (
          <li>
            <Link to={`/manufacturers/${existing.data.id}`}>{companyShortName(existing.data.name)}</Link>
          </li>
        )}
        <li aria-current="page">{editing ? "Редактирование" : "Новый производитель"}</li>
      </ol>
      <header className="page-header">
        <div className="page-header__text">
          <h1>{editing ? "Карточка производителя" : "Новый производитель"}</h1>
          <p className="page-header__lead">
            К производителю привязываются его товары. На странице компании видны все её решения.
          </p>
        </div>
      </header>

      <form className="mform" onSubmit={submit} noValidate>
        <div className="mform__fields card">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Название компании" htmlFor="m-name" required error={errors.name} hint="Как в реестре: с организационно-правовой формой">
            <Input id="m-name" value={draft.name} onChange={(e) => set("name")(e.target.value)} placeholder="ООО «Ронави Роботикс»" invalid={Boolean(errors.name)} autoFocus={!editing} />
          </Field>
          <div className="form-grid">
            <Field label="Страна" htmlFor="m-country" error={errors.country}>
              <Input id="m-country" value={draft.country} onChange={(e) => set("country")(e.target.value)} placeholder="Россия" />
            </Field>
            <Field label="Регион" htmlFor="m-region" error={errors.region}>
              <Input id="m-region" value={draft.region} onChange={(e) => set("region")(e.target.value)} placeholder="Москва" />
            </Field>
          </div>
          <Field label="Сайт" htmlFor="m-site" error={errors.website} hint="Официальный сайт — первоисточник характеристик товаров">
            <Input id="m-site" icon={<Globe size={16} />} value={draft.website} onChange={(e) => set("website")(e.target.value)} placeholder="https://company.ru" invalid={Boolean(errors.website)} inputMode="url" />
          </Field>
          <div className="form-grid">
            <Field label="E-mail для запросов" htmlFor="m-email" error={errors.contact_email}>
              <Input id="m-email" icon={<Mail size={16} />} type="email" value={draft.contact_email} onChange={(e) => set("contact_email")(e.target.value)} placeholder="sales@company.ru" invalid={Boolean(errors.contact_email)} />
            </Field>
            <Field label="Телефон" htmlFor="m-phone" error={errors.phone}>
              <Input id="m-phone" icon={<Phone size={16} />} type="tel" value={draft.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="+7 495 000-00-00" />
            </Field>
          </div>
          <Field label="О компании" htmlFor="m-description" error={errors.description} hint="Специализация, ключевые продукты, реализованные внедрения">
            <TextArea id="m-description" value={draft.description} onChange={(e) => set("description")(e.target.value)} rows={5} placeholder="Разрабатываем автономные мобильные роботы для складской логистики…" />
          </Field>
        </div>

        <aside className="mform__side">
          <div className="mform__preview card">
            <p className="mform__preview-label">Так карточка выглядит в каталоге</p>
            <div className="mcard mcard--static">
              <div className="mcard__head">
                <Avatar name={previewName} size={46} />
                <div className="mcard__title">
                  <h3>{companyShortName(previewName)}</h3>
                  <span className="mcard__legal">{previewName}</span>
                </div>
              </div>
              {location && (
                <span className="mcard__meta">
                  <MapPin size={14} aria-hidden="true" />
                  {location}
                </span>
              )}
              <div className="mcard__foot">
                <span className="mcard__count">
                  <strong>{existing.data?.product_count ?? 0}</strong> решений
                </span>
              </div>
            </div>
          </div>
          <div className="mform__actions">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              <Save size={17} aria-hidden="true" />
              {busy ? "Сохраняем…" : editing ? "Сохранить изменения" : "Добавить производителя"}
            </button>
            <Link className="btn btn--ghost" to={editing ? `/manufacturers/${id}` : "/manufacturers"}>
              Отмена
            </Link>
          </div>
          {!editing && (
            <Notice tone="info" icon={<Building2 size={18} />}>
              После создания добавьте товары компании или назначьте её представителю роль вендора в разделе
              «Пользователи и роли».
            </Notice>
          )}
        </aside>
      </form>
    </div>
  );
}

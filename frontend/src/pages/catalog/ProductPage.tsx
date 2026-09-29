import { CompanyLogo } from "../../ui/CompanyLogo";
import {
  BadgeCheck,
  Box,
  Camera,
  CircleCheck,
  Clock,
  Coins,
  ExternalLink,
  EyeOff,
  FileText,
  Gauge,
  Pencil,
  Send,
  Target,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useLocation, useParams } from "react-router";

import { api, ApiError } from "../../api/client";
import { optionLabel, useApi, useReference } from "../../api/hooks";
import type { Offer, Product, SpecValue } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { companyShortName, formatDate, formatDimensions, formatMoney, formatNumber } from "../../format";
import { resolveKind, resolveSize } from "../../scene/robots/kinds";
import { SceneBoundary, supportsWebGL, usePrefersReducedMotion } from "../../scene/support";
import { Badge, EmptyState, ErrorState, Notice, Segmented, Spinner } from "../../ui/Controls";
import { CompareToggle, CompletenessMeter, KIND_ICON, ReadinessBadge } from "./ProductCard";
import "./Catalog.css";
import "./ProductPage.css";

const RobotPreview = lazy(() => import("../../scene/robots/RobotPreview"));

function formatSpec(spec: SpecValue): string {
  if (spec.flag !== null) return spec.flag ? "Да" : "Нет";
  if (spec.text) return spec.text;
  if (spec.value === null) return "—";
  const value = spec.value_max !== null ? `${formatNumber(spec.value)} – ${formatNumber(spec.value_max)}` : formatNumber(spec.value);
  return spec.unit ? `${value} ${spec.unit}` : value;
}

function SpecTable({ title, specs }: { title: string; specs: SpecValue[] }) {
  if (specs.length === 0) return null;
  return (
    <div className="spec-table">
      <h3>{title}</h3>
      <dl>
        {specs.map((spec) => (
          <div key={spec.code}>
            <dt>{spec.name}</dt>
            <dd>
              <strong>{formatSpec(spec)}</strong>
              <small className={spec.is_confirmed && !spec.is_assumption ? "spec-table__ok" : "spec-table__pending"}>
                {spec.is_assumption ? "Допущение" : spec.is_confirmed ? <><BadgeCheck size={14} /> Подтверждено источником</> : "Требует уточнения"}
              </small>
              <small className="spec-table__source">
                {spec.source?.url ? <a href={spec.source.url} target="_blank" rel="noreferrer noopener">{spec.source.title}</a> : spec.source?.title || "Источник не указан"}
                <span>Получено: {formatDate(spec.retrieved_at || spec.source?.retrieved_at || null)}</span>
              </small>
              {spec.note && <small className="spec-table__note">{spec.note}</small>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OfferView({ offer, modelLabel }: { offer: Offer; modelLabel: string }) {
  const rows = [
    ["Платёж в месяц", offer.monthly_fee !== null ? `${formatMoney(offer.monthly_fee)}/мес` : null],
    ["Минимальный срок", offer.min_contract_months !== null ? `${offer.min_contract_months} мес.` : null],
    ["Оборудование", offer.equipment_price !== null ? formatMoney(offer.equipment_price) : null],
    ["ПО", offer.software_price !== null ? formatMoney(offer.software_price) : null],
    ["Внедрение", offer.implementation_price !== null ? formatMoney(offer.implementation_price) : null],
    ["Обслуживание", offer.annual_service_cost !== null ? `${formatMoney(offer.annual_service_cost)}/год` : null],
  ].filter(([, value]) => value !== null);
  return (
    <div className={`offer-view${offer.is_default ? " offer-view--default" : ""}`}>
      <div className="offer-view__head">
        <Badge tone={offer.acquisition_model === "purchase" ? "accent" : "violet"}>{modelLabel}</Badge>
        {offer.is_default && <span className="offer-view__main">Основное</span>}
      </div>
      <strong className="offer-view__label">{offer.label}</strong>
      {(offer.minimum_quantity ?? 1) > 1 && <p className="offer-view__vat">Цена за единицу при заказе от {offer.minimum_quantity} шт. Не используется как цена единичной поставки в подборе.</p>}
      {offer.estimation_eligible === false && <p className="offer-view__vat">Предложение не используется для автоматического расчёта: см. условия и примечания. Актуальную стоимость одного робота нужно уточнить у поставщика.</p>}
      {rows.length ? (
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="offer-view__empty">Цена по запросу</p>
      )}
      <span className="offer-view__vat">{offer.vat_status === "unknown" ? "Условия НДС в источнике не указаны" : offer.price_includes_vat ? "Цены с НДС" : "Цены без НДС"}</span>
      <small className="offer-view__vat">{offer.is_confirmed ? "Подтверждено источником" : "Стоимость требует подтверждения поставщиком"}</small>
      {offer.source && <small className="spec-table__source">
        {offer.source.url ? <a href={offer.source.url} target="_blank" rel="noreferrer noopener">{offer.source.title}</a> : offer.source.title}
        <span>Получено: {formatDate(offer.source.retrieved_at)}</span>
      </small>}
      {offer.notes && <small className="offer-view__vat">{offer.notes}</small>}
    </div>
  );
}

export default function ProductPage() {
  const { id } = useParams();
  const location = useLocation();
  const { role } = useAuth();
  const { data: reference } = useReference();
  const { data: loaded, error, reload } = useApi<Product>(`/products/${id}`);
  const [override, setOverride] = useState<Product | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const reduced = usePrefersReducedMotion();
  const [webgl] = useState(supportsWebGL);
  const { flash, photoError } = (location.state as { flash?: string; photoError?: string | null } | null) ?? {};
  const product = override?.id === loaded?.id ? (override ?? loaded) : loaded;
  const [view, setView] = useState<"photo" | "model" | null>(null);

  if (error) {
    return (
      <div className="page">
        {error.status === 404 ? (
          <EmptyState title="Товар не найден" action={<Link className="btn btn--ghost" to="/manufacturers">К производителям</Link>}>
            Возможно, он удалён или ещё не опубликован.
          </EmptyState>
        ) : (
          <ErrorState message={error.message} onRetry={reload} />
        )}
      </div>
    );
  }
  if (!product) {
    return (
      <div className="page page--center">
        <Spinner />
      </div>
    );
  }

  const setPublished = async (isPublished: boolean) => {
    setPublishing(true);
    setActionError(null);
    try {
      setOverride(await api<Product>(`/products/${product.id}/publication`, { method: "PATCH", body: { is_published: isPublished } }));
    } catch (reason) {
      setActionError(reason instanceof ApiError ? reason.message : "Не удалось изменить публикацию.");
    } finally {
      setPublishing(false);
    }
  };

  const kind = resolveKind(product.solution_type, product.product_class);
  // По умолчанию — фото, если оно есть: 3D-сцена загружается только по запросу.
  const shown = product.image ? (view ?? "photo") : "model";
  const Icon = KIND_ICON[kind];
  const { size, estimated } = resolveSize(kind, product.dimensions);
  const technical = product.specs.filter((s) => s.group === "technical");
  const infrastructure = product.specs.filter((s) => s.group === "infrastructure");
  const facilities = new Map<string, string[]>();
  for (const process of product.processes) {
    facilities.set(process.facility_type.name, [...(facilities.get(process.facility_type.name) ?? []), process.name]);
  }
  const confirmed = product.specs.filter((s) => s.is_confirmed).length;
  const dimensions = formatDimensions(product.dimensions);
  const facts = [
    product.price_from !== null && { label: "Стоимость", value: `от ${formatMoney(product.price_from)}` },
    product.monthly_fee_from !== null && { label: "Аренда", value: `от ${formatMoney(product.monthly_fee_from)}/мес` },
    product.payload_kg !== null && { label: "Грузоподъёмность", value: `${formatNumber(product.payload_kg)} кг` },
    dimensions && { label: "Габариты", value: dimensions },
    product.max_speed_mps !== null && { label: "Скорость", value: `${formatNumber(product.max_speed_mps)} м/с` },
    product.service_life_years !== null && { label: "Срок службы", value: `${formatNumber(product.service_life_years)} лет` },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="page">
      <ol className="crumbs">
        <li>
          <Link to="/manufacturers">Производители</Link>
        </li>
        {product.manufacturer && (
          <li>
            <Link to={`/manufacturers/${product.manufacturer.id}`}>{companyShortName(product.manufacturer.name)}</Link>
          </li>
        )}
        <li aria-current="page">{product.name}</li>
      </ol>

      <div className="product-notices">
        {flash && (
          <Notice tone="success" icon={<CircleCheck size={18} aria-hidden="true" />}>
            <strong>{flash === "created" ? "Товар добавлен" : "Изменения сохранены"}</strong>
            {!product.is_published && role === "vendor" && <span>Карточка отправлена на проверку администратору.</span>}
          </Notice>
        )}
        {!product.is_published && (
          <Notice tone="warning" icon={<EyeOff size={18} aria-hidden="true" />}>
            <strong>Товар не опубликован</strong>
            <span>
              {product.can_publish
                ? "Проверьте карточку и опубликуйте её — товар появится в каталоге и подборе."
                : "Администратор проверит карточку и опубликует её. Пока товар видите вы и администраторы."}
            </span>
          </Notice>
        )}
        {photoError && (
          <Notice tone="warning">
            <strong>Карточка сохранена, но фото не загружено</strong>
            <span>{photoError} Откройте редактирование и выберите фото снова.</span>
          </Notice>
        )}
        {actionError && <Notice tone="danger">{actionError}</Notice>}
      </div>

      <section className="phero">
        <div className="phero__stage card">
          {product.image && (
            <div className="phero__switch">
              <Segmented
                label="Вид"
                size="sm"
                options={[
                  { value: "photo", label: <><Camera size={14} aria-hidden="true" /> {product.image.is_illustration ? "Иллюстрация" : "Фото"}</> },
                  { value: "model", label: <><Box size={14} aria-hidden="true" /> 3D в масштабе</> },
                ]}
                value={shown}
                onChange={setView}
              />
            </div>
          )}
          {shown === "photo" && product.image ? (
            <img
              className="phero__photo"
              src={product.image.url}
              width={product.image.width}
              height={product.image.height}
              alt={product.image.caption || `Фотография: ${product.name}`}
            />
          ) : webgl ? (
            <SceneBoundary fallback={<p className="preview__fallback">3D-превью недоступно</p>}>
              <Suspense fallback={<div className="lineup__loading"><Spinner label="Загружаем 3D…" /></div>}>
                <RobotPreview kind={kind} size={size} animate={!reduced} />
              </Suspense>
            </SceneBoundary>
          ) : (
            <p className="preview__fallback">3D-превью недоступно: браузер не поддерживает WebGL</p>
          )}
          {shown === "model" && estimated && kind !== "software" && (
            <span className="phero__badge">
              <Badge tone="warning">Габариты условные — в карточке их нет</Badge>
            </span>
          )}
          {shown === "photo" && product.image && (
            <div className="phero__photo-links">
              {product.image.source?.url && <a href={product.image.source.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={15} aria-hidden="true" /> Открыть источник фото
              </a>}
              <a href={product.image.url} target="_blank" rel="noreferrer noopener">Открыть изображение</a>
              {product.image.original_url && <a href={product.image.original_url} target="_blank" rel="noreferrer noopener">Оригинал у производителя <ExternalLink size={12} /></a>}
            </div>
          )}
        </div>
        <div className="phero__info card">
          {product.image?.is_illustration && <Notice tone="info"><strong>Иллюстрация похожего типа техники</strong><span>Внешний вид конкретной модели уточняется у производителя.</span></Notice>}
          <span className="phero__type">
            <span className="pcard__icon">
              <Icon size={16} aria-hidden="true" />
            </span>
            {product.solution_type?.category && product.solution_type.category.name !== product.solution_type.name && (
              <>{product.solution_type.category.name} · </>
            )}
            {product.solution_type?.name ?? "Тип не указан"}
          </span>
          <h1>{product.name}</h1>
          {product.image?.source && <section className="product-image-credit" aria-label="Происхождение изображения">
            <strong>Источник изображения</strong>
            <p>{product.image.source.url ? <a href={product.image.source.url} target="_blank" rel="noreferrer noopener">{product.image.source.title} <ExternalLink size={12} aria-hidden="true" /></a> : product.image.source.title}</p>
            {product.image.caption && <p>{product.image.caption}</p>}
            <p>Получено: {formatDate(product.image.source.retrieved_at)}</p>
            {product.image.attribution && <details><summary>Сведения об источнике</summary><p>{product.image.attribution}</p></details>}
          </section>}
          {product.manufacturer && (
            <Link className="phero__maker" to={`/manufacturers/${product.manufacturer.id}`}>
              <CompanyLogo name={product.manufacturer.name} url={product.manufacturer_logo_url} size={30} />
              {companyShortName(product.manufacturer.name)}
            </Link>
          )}
          <div className="phero__badges">
            <Badge>{product.product_class === "brs" ? "БРС" : product.product_class === "bas" ? "БАС" : "ПО"}</Badge>
            <ReadinessBadge status={product.readiness_status} />
            {product.trl && <Badge>УГТ {product.trl}</Badge>}
            {product.country_of_origin && <Badge>{product.country_of_origin}</Badge>}
            {product.is_published ? <Badge tone="success">Опубликован</Badge> : <Badge tone="warning">На проверке</Badge>}
          </div>
          {product.purpose && <p className="phero__purpose">{product.purpose}</p>}
          {facts.length > 0 && (
            <dl className="phero__facts">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="phero__completeness">
            <span>Полнота карточки</span>
            <CompletenessMeter percent={product.completeness.percent} />
          </div>
          <div className="phero__actions">
            <CompareToggle product={product} className="phero__compare" />
              {product.can_edit && (
                <Link className="btn btn--primary" to={`/products/${product.id}/edit`}>
                  <Pencil size={16} aria-hidden="true" />
                  Редактировать
                </Link>
              )}
              {product.can_publish && (
                <button type="button" className="btn btn--ghost" disabled={publishing} onClick={() => setPublished(!product.is_published)}>
                  {product.is_published ? <EyeOff size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                  {product.is_published ? "Снять с публикации" : "Опубликовать"}
                </button>
              )}
          </div>
        </div>
      </section>

      <div className="pdetails">
        <section className="pblock card">
          <h2>
            <Gauge size={18} aria-hidden="true" />
            Характеристики
          </h2>
          {product.specs.length === 0 ? (
            <p className="pblock__empty">Характеристики не заполнены.</p>
          ) : (
            <div className="spec-tables">
              <SpecTable title="Технические" specs={technical} />
              <SpecTable title="Инфраструктура" specs={infrastructure} />
            </div>
          )}
          {product.description && <p className="pblock__text">{product.description}</p>}
        </section>

        <section className="pblock card">
          <h2>
            <Coins size={18} aria-hidden="true" />
            Экономика
          </h2>
          {product.offers.length === 0 ? (
            <p className="pblock__empty">Цены не указаны.</p>
          ) : (
            <div className="offer-views">
              {product.offers.map((offer) => (
                <OfferView key={offer.id} offer={offer} modelLabel={optionLabel(reference?.options.acquisition_models, offer.acquisition_model)} />
              ))}
            </div>
          )}
        </section>

        <section className="pblock card">
          <h2>
            <Target size={18} aria-hidden="true" />
            Применимость
          </h2>
          {facilities.size === 0 && !product.limitations && product.applications.length === 0 && (
            <p className="pblock__empty">Процессы и ограничения не указаны.</p>
          )}
          {[...facilities].map(([facility, processes]) => (
            <div key={facility} className="pblock__group">
              <h3>{facility}</h3>
              <div className="chips">
                {processes.map((name) => (
                  <span key={name} className="chip chip--static">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {product.limitations && (
            <div className="pblock__group">
              <h3>Ограничения</h3>
              <p className="pblock__text">{product.limitations}</p>
              {product.field_sources?.limitations && <small className="spec-table__source">
                <a href={product.field_sources.limitations.url || undefined} target="_blank" rel="noreferrer noopener">{product.field_sources.limitations.title}</a>
                <span>Получено: {formatDate(product.field_sources.limitations.retrieved_at)}</span>
              </small>}
            </div>
          )}
          {product.applications.length > 0 && (
            <div className="pblock__group">
              <h3>Кейсы и сценарии</h3>
              <ul className="cases-view">
                {product.applications.map((a) => (
                  <li key={a.id}>
                    <span className="cases-view__meta">{[a.industry?.name, a.scenario].filter(Boolean).join(" · ") || "Сценарий не указан"}</span>
                    {a.case_description && <p>{a.case_description}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="pblock card">
          <h2>
            <FileText size={18} aria-hidden="true" />
            Происхождение данных
          </h2>
          <dl className="quality">
            <div>
              <dt>Актуализация</dt>
              <dd>
                <Clock size={14} aria-hidden="true" />
                {formatDate(product.last_verified_at ?? product.updated_at)}
              </dd>
            </div>
            <div>
              <dt>Подтверждено значений</dt>
              <dd>
                {confirmed} из {product.specs.length}
              </dd>
            </div>
            <div>
              <dt>Полнота</dt>
              <dd>
                {product.completeness.filled} из {product.completeness.total}
              </dd>
            </div>
          </dl>
          {product.sources.length > 0 && (
            <ul className="sources-view">
              {product.sources.map((s) => (
                <li key={s.id}>
                  <span>{optionLabel(reference?.options.source_types, s.source_type)}</span>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.title}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : (
                    <strong>{s.title}</strong>
                  )}
                  <span>Получено: {formatDate(s.retrieved_at)}{s.publisher ? ` · ${s.publisher}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          {product.completeness.missing.length > 0 && (
            <div className="pblock__group">
              <h3>{product.research_checked_at ? "Не удалось подтвердить" : "Не заполнено"}</h3>
              <p className="pblock__muted">{product.completeness.missing.join(", ")}</p>
              {product.research_checked_at && <p className="pblock__muted">Проверено: {formatDate(product.research_checked_at)}. {product.research_note || "В проверенных источниках не найдено достаточных данных. Требуется спецификация производителя."}</p>}
            </div>
          )}
          {!!product.specification_alternatives?.length && <details className="pblock__group">
            <summary>Другие опубликованные значения ({product.specification_alternatives.length})</summary>
            <p className="pblock__muted">В источниках отличаются значения или условия измерения. Эти сведения требуют уточнения у производителя и не заменяют характеристики в расчёте.</p>
            <ul className="sources-view">{product.specification_alternatives.map((entry, index) => <li key={index}>
              <strong>{product.specs.find(spec => spec.code === entry.code)?.name || entry.code}: {entry.text || `${entry.value ?? "—"}${entry.value_max != null ? `–${entry.value_max}` : ""} ${entry.unit || ""}`}</strong>
              <a href={entry.source_url} target="_blank" rel="noreferrer noopener">Публикация производителя <ExternalLink size={12} /></a>
              <span>Получено: {formatDate(entry.retrieved_at)}{entry.note ? ` · ${entry.note}` : ""}</span>
            </li>)}</ul>
          </details>}
          {!!product.completeness.not_applicable?.length && <div className="pblock__group">
            <h3>Не применяется к этому типу изделия</h3>
            <p className="pblock__muted">{product.completeness.not_applicable.join(", ")}</p>
            <p className="pblock__muted">Исключено из оценки полноты по типу решения. Это правило каталога, а не подтверждённая производителем характеристика.</p>
          </div>}
        </section>
      </div>
    </div>
  );
}

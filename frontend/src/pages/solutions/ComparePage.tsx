import { BadgeCheck, Copy, Info, Plus, Scale, Trophy, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { useApi } from "../../api/hooks";
import type { CompareCell, CompareRow, Comparison, ProductSummary } from "../../api/types";
import { COMPARE_LIMIT, compareLink, useCompare } from "../../compare/CompareContext";
import { companyShortName, formatDate, formatMoney, formatNumber } from "../../format";
import { resolveKind, resolveSize } from "../../scene/robots/kinds";
import type { LineupItem } from "../../scene/robots/Lineup";
import { SceneBoundary, supportsWebGL, usePrefersReducedMotion } from "../../scene/support";
import { EmptyState, ErrorState, Notice, Spinner, Switch } from "../../ui/Controls";
import { cx } from "../../ui/Field";
import { KIND_ICON } from "../catalog/ProductCard";
import "./Compare.css";
import EconomicsPanel from "./EconomicsPanel";

const Lineup = lazy(() => import("../../scene/robots/Lineup"));

function isEmpty(cell: CompareCell): boolean {
  return cell.value == null && !cell.text && !(cell.items && cell.items.length) && cell.flag == null;
}

function formatCell(cell: CompareCell, row: CompareRow): ReactNode {
  if (isEmpty(cell)) return <span className="ctable__none">нет данных</span>;
  if (cell.value == null) {
    if (cell.items) return <ul className="ctable__list">{cell.items.map((item) => <li key={item}>{item}</li>)}</ul>;
    if (cell.flag != null) return cell.flag ? "Да" : "Нет";
    return row.kind === "date" ? formatDate(cell.text) : <span className="ctable__text">{cell.text}</span>;
  }
  const unit = cell.unit ?? row.unit;
  switch (row.kind) {
    case "money":
      return `${formatMoney(cell.value)}${row.unit?.startsWith("₽/") ? row.unit.slice(1) : ""}`;
    case "percent":
      return `${formatNumber(Math.round(cell.value))} %`;
    default: {
      const value = cell.value_max != null ? `${formatNumber(cell.value)} – ${formatNumber(cell.value_max)}` : formatNumber(cell.value);
      return unit ? `${value} ${unit}` : value;
    }
  }
}

function ProductHead({ product, onRemove, onHover }: { product: ProductSummary; onRemove: () => void; onHover: (on: boolean) => void }) {
  const Icon = KIND_ICON[resolveKind(product.solution_type, product.product_class)];
  return (
    <div className="chead" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <button type="button" className="chead__remove" onClick={onRemove} aria-label={`Убрать «${product.name}» из сравнения`}>
        <X size={15} aria-hidden="true" />
      </button>
      <div className="chead__media">
        {product.image_url ? <img src={product.image_url} alt="" /> : <Icon size={30} strokeWidth={1.5} aria-hidden="true" />}
      </div>
      <Link to={`/products/${product.id}`} className="chead__name">
        {product.name}
      </Link>
      <span className="chead__meta">
        {[product.manufacturer ? companyShortName(product.manufacturer.name) : null, product.solution_type?.name].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const compare = useCompare();
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const reduced = usePrefersReducedMotion();
  const [webgl] = useState(supportsWebGL);

  const urlIds = useMemo(
    () => (params.get("ids") ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, COMPARE_LIMIT),
    [params],
  );
  const ids = urlIds.length ? urlIds : compare.items.map((i) => i.id);

  // Открыли страницу без ссылки — берём выбор из каталога, чтобы адрес можно было скопировать.
  useEffect(() => {
    if (!urlIds.length && compare.items.length) setParams({ ids: compare.items.map((i) => i.id).join(",") }, { replace: true });
  }, [urlIds.length, compare.items, setParams]);

  const data = useApi<Comparison>(ids.length ? `/catalog/compare?${ids.map((id) => `ids=${id}`).join("&")}` : null);

  // Выбор в каталоге совпадает с открытым сравнением (в том числе по чужой ссылке).
  useEffect(() => {
    if (data.data) compare.replace(data.data.products.map((p) => ({ id: p.id, name: p.name, image: p.image_url })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data]);

  const remove = (id: number) => {
    compare.remove(id);
    const rest = ids.filter((i) => i !== id);
    setParams(rest.length ? { ids: rest.join(",") } : {}, { replace: true });
  };

  const lineup = useMemo<LineupItem[]>(
    () =>
      (data.data?.products ?? []).map((p) => {
        const kind = resolveKind(p.solution_type, p.product_class);
        return { id: p.id, kind, size: resolveSize(kind, p.dimensions).size };
      }),
    [data.data],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${compareLink(ids)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (!ids.length) {
    return (
      <div className="page">
        <EmptyState
          icon={<Scale size={24} />}
          title="Выберите решения для сравнения"
          action={<Link className="btn btn--primary" to="/robots">Перейти в каталог роботов</Link>}
        >
          Отметьте кнопкой «Сравнить» до {COMPARE_LIMIT} решений в каталоге или на странице производителя.
        </EmptyState>
      </div>
    );
  }
  if (data.error) return <div className="page"><ErrorState message={data.error.message} onRetry={data.reload} /></div>;
  if (!data.data) return <div className="page page--center"><Spinner label="Собираем таблицу сравнения…" /></div>;

  const { products, groups, missing } = data.data;
  const count = products.length;
  const visible = (row: CompareRow) =>
    (!hideEmpty || row.cells.some((c) => !isEmpty(c))) && (!onlyDiff || row.differs);

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header__text">
          <h1>Сравнение решений</h1>
        </div>
        <div className="page-header__actions">
          {count < COMPARE_LIMIT && (
            <Link className="btn btn--ghost" to="/robots">
              <Plus size={16} aria-hidden="true" />
              Добавить решение
            </Link>
          )}
          <button type="button" className="btn btn--ghost" onClick={copy}>
            <Copy size={16} aria-hidden="true" />
            {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
          </button>
        </div>
      </header>

      {missing.length > 0 && (
        <div className="compare__notice">
          <Notice tone="warning">Часть решений недоступна: они удалены или ещё не опубликованы.</Notice>
        </div>
      )}
      {count === 1 && (
        <div className="compare__notice">
          <Notice tone="info">Добавьте ещё хотя бы одно решение, чтобы увидеть лучшие значения в строках.</Notice>
        </div>
      )}

      <div className="compare__toolbar card">
        <Switch checked={onlyDiff} onChange={setOnlyDiff} label="Только различия" />
        <Switch checked={hideEmpty} onChange={setHideEmpty} label="Скрыть строки без данных" />
      </div>

      {webgl && count > 0 && (
        <section className="compare__lineup card" aria-label="Решения в масштабе">
          <div className="compare__lineup-head">
            <h2>В масштабе</h2>
            <span>Модели по габаритам карточек рядом с человеком ростом 1,8 м. Наведите на столбец таблицы.</span>
          </div>
          <div className="compare__stage">
            <SceneBoundary>
              <Suspense fallback={<div className="lineup__loading"><Spinner label="Загружаем 3D…" /></div>}>
                <Lineup
                  items={lineup}
                  highlighted={hovered !== null ? (products[hovered]?.id ?? null) : null}
                  onHover={(id) => setHovered(id === null ? null : products.findIndex((p) => p.id === id))}
                  onSelect={(id) => navigate(`/products/${id}`)}
                  animate={!reduced}
                />
              </Suspense>
            </SceneBoundary>
          </div>
        </section>
      )}

      {count > 0 && <EconomicsPanel key={products.map(p => p.id).join(",")} data={data.data} />}

      <div className="ctable-wrap">
        <table className="ctable" style={{ ["--cols" as string]: count }}>
          <colgroup>
            <col className="ctable__label-col" />
            {products.map((p) => (
              <col key={p.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="ctable__corner" scope="col">
                <span>Характеристика</span>
              </th>
              {products.map((product, index) => (
                <th key={product.id} scope="col" className={cx(hovered === index && "is-hover")}>
                  <ProductHead product={product} onRemove={() => remove(product.id)} onHover={(on) => setHovered(on ? index : null)} />
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => {
            const rows = group.rows.filter(visible);
            if (!rows.length) return null;
            return (
              <tbody key={group.key}>
                <tr className="ctable__group">
                  <th colSpan={count + 1} scope="colgroup">
                    {group.title}
                    {group.description && <small>{group.description}</small>}
                  </th>
                </tr>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className="ctable__label">
                      <span className="ctable__label-text">
                        {row.label}
                        {row.mandatory && <span className="mandatory-mark" title="Обязательная характеристика по п. 3.3.7 ТЗ" />}
                      </span>
                      {row.hint && (
                        <span className="ctable__hint" title={row.hint}>
                          <Info size={13} aria-hidden="true" />
                          {row.hint}
                        </span>
                      )}
                    </th>
                    {row.cells.map((cell, index) => (
                      <td
                        key={index}
                        className={cx(row.best.includes(index) && "is-best", hovered === index && "is-hover")}
                        onMouseEnter={() => setHovered(index)}
                        onMouseLeave={() => setHovered(null)}
                        title={cell.note ?? undefined}
                      >
                        <span className="ctable__value">
                          {formatCell(cell, row)}
                          {cell.confirmed && <BadgeCheck size={14} className="ctable__ok" aria-label="Подтверждено" />}
                        </span>
                        {row.best.includes(index) && (
                          <span className="ctable__best">
                            <Trophy size={12} aria-hidden="true" /> лучшее
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

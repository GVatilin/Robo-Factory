import { ChevronRight, PackageSearch, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { useApi, useDebounced } from "../../api/hooks";
import type { CatalogFilterInfo, CatalogPage, FacetValue, TreeNode } from "../../api/types";
import { formatMoney, formatNumber, plural } from "../../format";
import { EmptyState, ErrorState, Spinner } from "../../ui/Controls";
import { Input } from "../../ui/Field";
import { ProductCard } from "../catalog/ProductCard";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogTree } from "./CatalogTree";
import { apiQuery, hasHierarchy, PAGE_SIZE, selectedPath, toggleValue, withHierarchy, withSpec, withValue } from "./params";
import "../catalog/Catalog.css";
import "./Solutions.css";

const SORTS = [
  { value: "name", label: "По названию" },
  { value: "price", label: "Сначала дешевле" },
  { value: "price_desc", label: "Сначала дороже" },
  { value: "payload", label: "По грузоподъёмности" },
  { value: "completeness", label: "По полноте карточки" },
  { value: "updated", label: "Недавно обновлённые" },
];

const OPERATOR_TEXT: Record<string, string> = { ">=": "≥", "<=": "≤", "~": "содержит", "=": "" };

interface Chip {
  key: string;
  label: string;
  next: URLSearchParams;
}

function facetLabel(values: FacetValue[] | undefined, value: string): string {
  return values?.find((f) => f.value === value)?.label ?? value;
}

export default function SolutionsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = useDebounced(search.trim(), 300);

  const tree = useApi<TreeNode[]>("/catalog/tree");
  const info = useApi<CatalogFilterInfo>("/catalog/filters");
  const page = useApi<CatalogPage>(`/products${apiQuery(params, limit)}`);

  // Поиск в адресе страницы — после паузы в наборе.
  useEffect(() => {
    if (query !== (params.get("q") ?? "")) setParams(withValue(params, "q", query || null), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => setSearch(params.get("q") ?? ""), [params]);

  const change = (next: URLSearchParams, push = false) => {
    setLimit(PAGE_SIZE);
    setParams(next, { replace: !push });
  };

  const path = useMemo(() => selectedPath(tree.data ?? [], params), [tree.data, params]);
  const facets = page.data?.facets ?? null;
  const specs = info.data?.specs ?? [];

  const chips: Chip[] = [];
  if (params.get("q")) chips.push({ key: "q", label: `Поиск: «${params.get("q")}»`, next: withValue(params, "q", null) });
  if (hasHierarchy(params)) {
    const label = path.length ? path.map((n) => n.name).join(" › ") : "Раздел каталога";
    chips.push({ key: "tree", label, next: withHierarchy(params, null) });
  }
  const multi: [string, FacetValue[] | undefined][] = [
    ["product_class", facets?.product_classes],
    ["readiness_status", facets?.readiness_statuses],
    ["country", facets?.countries],
    ["acquisition_model", facets?.acquisition_models],
  ];
  for (const [key, values] of multi) {
    for (const value of params.getAll(key)) chips.push({ key: `${key}:${value}`, label: facetLabel(values, value), next: toggleValue(params, key, value) });
  }
  for (const raw of params.getAll("spec")) {
    const match = raw.match(/^([a-z0-9_]+)(>=|<=|~|=)(.+)$/);
    if (!match) continue;
    const [, code, op, value] = match;
    const spec = specs.find((s) => s.code === code);
    const shown = op === "~" || op === "=" ? (op === "=" ? "да" : `«${value}»`) : `${formatNumber(Number(value))}${spec?.unit ? ` ${spec.unit}` : ""}`;
    chips.push({ key: `spec:${raw}`, label: `${spec?.name ?? code} ${OPERATOR_TEXT[op]} ${shown}`.replace(/\s+/g, " "), next: withSpec(params, code, op as ">=", null) });
  }
  if (params.get("price_max")) chips.push({ key: "price", label: `Цена до ${formatMoney(Number(params.get("price_max")))}`, next: withValue(params, "price_max", null) });
  const flags: [string, string][] = [
    ["has_image", "С фотографией"],
    ["has_cases", "Есть кейсы"],
    ["confirmed_only", "Только подтверждённые"],
    ["with_unknown", "С решениями без данных"],
  ];
  for (const [key, label] of flags) if (params.get(key) === "true") chips.push({ key, label, next: withValue(params, key, null) });
  if (params.get("min_completeness")) chips.push({ key: "completeness", label: `Полнота от ${params.get("min_completeness")}%`, next: withValue(params, "min_completeness", null) });

  const sort = params.get("sort") ?? "name";
  const total = page.data?.total ?? 0;
  const reset = () => {
    const next = new URLSearchParams();
    if (params.get("sort")) next.set("sort", params.get("sort")!);
    change(next, true);
  };

  return (
    <div className="page page--wide">
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">Каталог</p>
          <h1>Каталог решений</h1>
          <p className="page-header__lead">
            Роботизированные решения по отраслям, объектам и процессам. Фильтруйте по характеристикам, отмечайте
            решения кнопкой «Сравнить» и сопоставляйте их в одной таблице.
          </p>
        </div>
      </header>

      <div className="solutions">
        <aside className="solutions__side">
          <section className="side-card card">
            <h2 className="side-card__title">Иерархия каталога</h2>
            {tree.error && <ErrorState message={tree.error.message} onRetry={tree.reload} />}
            {!tree.data && !tree.error && <Spinner />}
            {tree.data && (
              <CatalogTree nodes={tree.data} params={params} total={info.data?.total ?? null} onSelect={(node) => change(withHierarchy(params, node), true)} />
            )}
          </section>
          <section className="side-card card">
            <h2 className="side-card__title">Фильтры</h2>
            <CatalogFilters params={params} facets={facets} info={info.data} onChange={(next) => change(next)} />
          </section>
        </aside>

        <section className="solutions__main" aria-busy={page.loading}>
          <div className="solutions__toolbar card">
            <Input
              className="solutions__search"
              icon={<Search size={17} />}
              type="search"
              placeholder="Название, производитель, тип или описание"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Поиск решений"
            />
            <label className="toolbar__sort">
              <span>Сортировка</span>
              <select className="select select--sm" value={sort} onChange={(e) => change(withValue(params, "sort", e.target.value === "name" ? null : e.target.value))}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {path.length > 0 && (
            <ol className="solutions__path" aria-label="Выбранный раздел">
              {path.map((node, index) => (
                <li key={node.key}>
                  {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
                  <button type="button" onClick={() => change(withHierarchy(params, node), true)} disabled={index === path.length - 1}>
                    {node.name}
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div className="solutions__summary">
            <strong>
              {page.data ? `${total} ${plural(total, ["решение", "решения", "решений"])}` : "Загружаем…"}
            </strong>
            {chips.length > 0 && (
              <div className="fchips">
                {chips.map((chip) => (
                  <button key={chip.key} type="button" className="fchip" onClick={() => change(chip.next)} title="Убрать фильтр">
                    {chip.label}
                    <X size={13} aria-hidden="true" />
                  </button>
                ))}
                <button type="button" className="link-button" onClick={reset}>
                  <RotateCcw size={13} aria-hidden="true" /> Сбросить всё
                </button>
              </div>
            )}
          </div>

          {page.error && <ErrorState message={page.error.message} onRetry={page.reload} />}
          {!page.data && page.loading && (
            <div className="pgrid">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton pcard--skeleton" />
              ))}
            </div>
          )}
          {page.data && page.data.items.length === 0 && (
            <EmptyState
              icon={<PackageSearch size={24} />}
              title="Решения не найдены"
              action={
                <div className="empty__actions">
                  {params.getAll("spec").length > 0 && params.get("with_unknown") !== "true" && (
                    <button type="button" className="btn btn--subtle" onClick={() => change(withValue(params, "with_unknown", "true"))}>
                      Показать решения без данных
                    </button>
                  )}
                  <button type="button" className="btn btn--ghost" onClick={reset}>
                    Сбросить фильтры
                  </button>
                </div>
              }
            >
              Ни одно решение не подходит под все условия. Ослабьте фильтры или включите решения без данных по
              характеристикам — они будут отмечены как требующие проверки.
            </EmptyState>
          )}
          {page.data && page.data.items.length > 0 && (
            <>
              <div className="pgrid pgrid--catalog">
                {page.data.items.map((item) => (
                  <ProductCard key={item.id} product={item} comparable unknown={item.unknown} />
                ))}
              </div>
              {page.data.items.length < total && (
                <div className="solutions__more">
                  <button type="button" className="btn btn--ghost" onClick={() => setLimit((l) => l + PAGE_SIZE)} disabled={page.loading}>
                    {page.loading ? "Загружаем…" : `Показать ещё ${Math.min(PAGE_SIZE, total - page.data.items.length)}`}
                  </button>
                  <span>
                    Показано {page.data.items.length} из {total}
                  </span>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

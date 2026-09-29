import { Building2, MapPin, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { query } from "../../api/client";
import { useApi, useDebounced } from "../../api/hooks";
import type { ManufacturerSummary, Page } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { companyShortName, plural } from "../../format";
import { Badge, EmptyState, ErrorState } from "../../ui/Controls";
import { CompanyLogo } from "../../ui/CompanyLogo";
import { Input } from "../../ui/Field";
import "./Catalog.css";

type Sort = "products" | "name" | "updated";

function ManufacturerCard({ item }: { item: ManufacturerSummary }) {
  const types = item.solution_types.slice(0, 3);
  const location = [item.region, item.country].filter(Boolean).join(", ");
  return (
    <Link to={`/manufacturers/${item.id}`} className="mcard">
      <div className="mcard__head">
        <CompanyLogo name={item.name} url={item.logo_url} size={52} />
        <div className="mcard__title">
          <h3>{companyShortName(item.name)}</h3>
          <span className="mcard__legal">{item.name}</span>
        </div>
      </div>
      {location && (
        <span className="mcard__meta">
          <MapPin size={14} aria-hidden="true" />
          {location}
        </span>
      )}
      <div className="mcard__types">
        {types.map((type) => (
          <Badge key={type}>{type}</Badge>
        ))}
        {item.solution_types.length > types.length && <Badge>+{item.solution_types.length - types.length}</Badge>}
      </div>
      <div className="mcard__foot">
        <span className="mcard__count">
          <strong>{item.product_count}</strong> {plural(item.product_count, ["решение", "решения", "решений"])}
        </span>
        {item.pending_count > 0 && <Badge tone="warning">{item.pending_count} на проверке</Badge>}
      </div>
    </Link>
  );
}

export default function ManufacturersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("products");
  const deferred = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<Page<ManufacturerSummary>>(
    `/manufacturers${query({ q: deferred, sort, limit: 500 })}`,
  );

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header__text">
          <h1>Производители</h1>
        </div>
        {can("manufacturers:create") && (
          <div className="page-header__actions">
            <Link to="/manufacturers/new" className="btn btn--primary">
              <Plus size={17} aria-hidden="true" />
              Добавить производителя
            </Link>
          </div>
        )}
      </header>

      <div className="toolbar card">
        <Input
          className="toolbar__search"
          icon={<Search size={17} />}
          placeholder="Поиск по названию или региону"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Поиск производителей"
          type="search"
        />
        <label className="toolbar__sort">
          <span>Сортировка</span>
          <select className="select select--sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="products">По числу решений</option>
            <option value="name">По названию</option>
            <option value="updated">Недавно обновлённые</option>
          </select>
        </label>
        {data && (
          <span className="toolbar__total">
            {data.total} {plural(data.total, ["производитель", "производителя", "производителей"])}
          </span>
        )}
      </div>

      {error && <ErrorState message={error.message} onRetry={reload} />}
      {!data && loading && (
        <div className="mgrid">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="skeleton mcard--skeleton" />
          ))}
        </div>
      )}
      {data && data.items.length === 0 && (
        <EmptyState icon={<Building2 size={24} />} title="Производители не найдены">
          {deferred ? "Измените запрос поиска." : "Каталог пуст: загрузите датасеты или добавьте производителя."}
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <div className="mgrid" aria-busy={loading}>
          {data.items.map((item) => (
            <ManufacturerCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

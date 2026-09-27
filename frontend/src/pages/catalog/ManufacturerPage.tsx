import { Globe, Mail, MapPin, Package, Pencil, Phone, Plus, Rotate3d, Trash2 } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { api, ApiError } from "../../api/client";
import { useApi } from "../../api/hooks";
import type { Manufacturer } from "../../api/types";
import { companyShortName, plural } from "../../format";
import { resolveKind, resolveSize } from "../../scene/robots/kinds";
import type { LineupItem } from "../../scene/robots/Lineup";
import { SceneBoundary, supportsWebGL, usePrefersReducedMotion } from "../../scene/support";
import { Avatar, Badge, ConfirmDialog, EmptyState, ErrorState, Notice, Spinner } from "../../ui/Controls";
import { ProductCard } from "./ProductCard";
import "./Catalog.css";

const Lineup = lazy(() => import("../../scene/robots/Lineup"));
const LINEUP_LIMIT = 12;

export default function ManufacturerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<Manufacturer>(`/manufacturers/${id}`);
  const [hovered, setHovered] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const reduced = usePrefersReducedMotion();
  const [webgl] = useState(supportsWebGL);

  const lineup = useMemo<LineupItem[]>(() => {
    if (!data) return [];
    return data.products
      .filter((p) => p.product_class !== "software")
      .slice(0, LINEUP_LIMIT)
      .map((p) => {
        const kind = resolveKind(p.solution_type, p.product_class);
        return { id: p.id, kind, size: resolveSize(kind, p.dimensions).size };
      })
      .sort((a, b) => a.size.h - b.size.h);
  }, [data]);

  if (error) {
    return (
      <div className="page">
        {error.status === 404 ? (
          <EmptyState title="Производитель не найден" action={<Link className="btn btn--ghost" to="/manufacturers">К списку производителей</Link>}>
            Возможно, карточка была удалена.
          </EmptyState>
        ) : (
          <ErrorState message={error.message} onRetry={reload} />
        )}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page page--center">
        <Spinner />
      </div>
    );
  }

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api(`/manufacturers/${data.id}`, { method: "DELETE" });
      navigate("/manufacturers", { replace: true });
    } catch (reason) {
      setDeleteError(reason instanceof ApiError ? reason.message : "Не удалось удалить производителя.");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const shortName = companyShortName(data.name);
  const location = [data.region, data.country].filter(Boolean).join(", ");
  const addLink = `/products/new?manufacturer=${data.id}`;

  return (
    <div className="page" aria-busy={loading}>
      <ol className="crumbs">
        <li>
          <Link to="/manufacturers">Производители</Link>
        </li>
        <li aria-current="page">{shortName}</li>
      </ol>

      <section className="mhero card">
        <div className="mhero__main">
          <Avatar name={data.name} size={76} />
          <div className="mhero__text">
            <h1>{shortName}</h1>
            {shortName !== data.name && <p className="mhero__legal">{data.name}</p>}
            <ul className="mhero__meta">
              {location && (
                <li>
                  <MapPin size={15} aria-hidden="true" />
                  {location}
                </li>
              )}
              {data.website && (
                <li>
                  <Globe size={15} aria-hidden="true" />
                  <a href={data.website} target="_blank" rel="noreferrer noopener">
                    {data.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                </li>
              )}
              {data.contact_email && (
                <li>
                  <Mail size={15} aria-hidden="true" />
                  <a href={`mailto:${data.contact_email}`}>{data.contact_email}</a>
                </li>
              )}
              {data.phone && (
                <li>
                  <Phone size={15} aria-hidden="true" />
                  <a href={`tel:${data.phone.replace(/[^\d+]/g, "")}`}>{data.phone}</a>
                </li>
              )}
            </ul>
            {data.description && <p className="mhero__description">{data.description}</p>}
          </div>
        </div>
        <aside className="mhero__side">
          <div className="mhero__stats">
            <div>
              <strong>{data.product_count}</strong>
              <span>{plural(data.product_count, ["решение", "решения", "решений"])}</span>
            </div>
            <div>
              <strong>{data.solution_types.length}</strong>
              <span>{plural(data.solution_types.length, ["тип", "типа", "типов"])} решений</span>
            </div>
          </div>
          {data.pending_count > 0 && <Badge tone="warning">{data.pending_count} на проверке у администратора</Badge>}
          <div className="mhero__actions">
            {data.can_add_products && (
              <Link className="btn btn--primary" to={addLink}>
                <Plus size={17} aria-hidden="true" />
                Добавить товар
              </Link>
            )}
            {data.can_edit && (
              <Link className="btn btn--ghost" to={`/manufacturers/${data.id}/edit`}>
                <Pencil size={16} aria-hidden="true" />
                Редактировать
              </Link>
            )}
            {data.can_delete && (
              <button
                type="button"
                className="btn btn--danger-ghost btn--icon"
                onClick={() => setConfirmDelete(true)}
                aria-label="Удалить производителя"
                title={data.product_count ? "Сначала удалите или перенесите товары" : "Удалить производителя"}
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        </aside>
      </section>

      {deleteError && (
        <div className="page-notice">
          <Notice tone="danger">{deleteError}</Notice>
        </div>
      )}

      {webgl && lineup.length > 0 && (
        <section className="lineup card" aria-label="Линейка решений в масштабе">
          <div className="lineup__head">
            <div>
              <h2>Линейка в масштабе</h2>
              <p>
                Модели построены по габаритам из карточек, рядом — человек ростом 1,8 м. Наведите на товар в списке,
                чтобы подсветить его.
                {data.products.length > LINEUP_LIMIT && ` Показаны первые ${LINEUP_LIMIT}.`}
              </p>
            </div>
            <Rotate3d size={22} aria-hidden="true" className="lineup__icon" />
          </div>
          <div className="lineup__stage">
            <SceneBoundary>
              <Suspense fallback={<div className="lineup__loading"><Spinner label="Загружаем 3D-сцену…" /></div>}>
                <Lineup
                  items={lineup}
                  highlighted={hovered}
                  onHover={setHovered}
                  onSelect={(productId) => navigate(`/products/${productId}`)}
                  animate={!reduced}
                />
              </Suspense>
            </SceneBoundary>
          </div>
        </section>
      )}

      <section className="msection">
        <div className="msection__head">
          <h2>
            Решения <span className="msection__count">{data.products.length}</span>
          </h2>
        </div>
        {data.products.length === 0 ? (
          <EmptyState
            icon={<Package size={24} />}
            title="У производителя пока нет решений"
            action={
              data.can_add_products && (
                <Link className="btn btn--primary" to={addLink}>
                  <Plus size={17} aria-hidden="true" />
                  Добавить первый товар
                </Link>
              )
            }
          >
            {data.can_add_products
              ? "Добавьте товар: он появится в каталоге и будет участвовать в подборе решений."
              : "Товары появятся здесь после добавления в каталог."}
          </EmptyState>
        ) : (
          <div className="pgrid">
            {data.products.map((product) => (
              <ProductCard key={product.id} product={product} active={hovered === product.id} onHover={setHovered} comparable />
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить производителя?"
        confirmLabel="Удалить"
        danger
        busy={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      >
        {data.product_count > 0
          ? `У производителя ${data.product_count} ${plural(data.product_count, ["товар", "товара", "товаров"])}. Удаление возможно только без товаров.`
          : `Карточка «${shortName}» будет удалена без возможности восстановления.`}
      </ConfirmDialog>
    </div>
  );
}

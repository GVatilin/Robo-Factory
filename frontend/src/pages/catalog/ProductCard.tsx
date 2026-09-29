import {
  Bot,
  Boxes,
  BrushCleaning,
  Check,
  CircleAlert,
  Container,
  Drone,
  ExternalLink,
  Forklift,
  HandGrab,
  MonitorCog,
  Package,
  PersonStanding,
  Plane,
  Scale,
  ScanBarcode,
  Shield,
  Ship,
  Tractor,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import type { ProductSummary, ReadinessStatus } from "../../api/types";
import { COMPARE_LIMIT, useCompare } from "../../compare/CompareContext";
import { companyShortName, formatDimensions, formatMoneyCompact, formatNumber } from "../../format";
import { resolveKind, type RobotKind } from "../../scene/robots/kinds";
import { Badge } from "../../ui/Controls";
import { CompanyLogo } from "../../ui/CompanyLogo";
import { cx } from "../../ui/Field";

export const KIND_ICON: Record<RobotKind, LucideIcon> = {
  platform: Bot,
  forklift: Forklift,
  tug: Container,
  cleaner: BrushCleaning,
  delivery: Package,
  security: Shield,
  inventory: ScanBarcode,
  truck: Truck,
  tractor: Tractor,
  storage: Warehouse,
  arm: HandGrab,
  mobileArm: HandGrab,
  humanoid: PersonStanding,
  drone: Drone,
  plane: Plane,
  marine: Ship,
  software: MonitorCog,
  generic: Boxes,
};

const READINESS: Record<ReadinessStatus, { label: string; tone: "success" | "accent" | "neutral" }> = {
  operation: { label: "Серийно", tone: "success" },
  piloting: { label: "Пилот", tone: "accent" },
  rnd: { label: "НИОКР", tone: "neutral" },
};

export function ReadinessBadge({ status }: { status: ReadinessStatus | null }) {
  if (!status) return null;
  const { label, tone } = READINESS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function CompletenessMeter({ percent, label = true }: { percent: number; label?: boolean }) {
  const tone = percent >= 75 ? "good" : percent >= 40 ? "mid" : "low";
  return (
    <span className={`meter meter--${tone}`} title={`Полнота карточки: ${percent}%`}>
      <span className="meter__track">
        <span className="meter__fill" style={{ width: `${percent}%` }} />
      </span>
      {label && <span className="meter__value">{percent}%</span>}
    </span>
  );
}

interface ProductCardProps {
  product: ProductSummary;
  active?: boolean;
  onHover?: (id: number | null) => void;
  /** Показать переключатель «Сравнить». */
  comparable?: boolean;
  /** Характеристики фильтра без данных: решение требует проверки. */
  unknown?: string[];
}

export function CompareToggle({ product, className }: { product: ProductSummary; className?: string }) {
  const compare = useCompare();
  const selected = compare.has(product.id);
  const blocked = !selected && compare.full;
  return (
    <button
      type="button"
      className={cx("compare-toggle", selected && "is-on", className)}
      aria-pressed={selected}
      disabled={blocked}
      title={blocked ? `В сравнении уже ${COMPARE_LIMIT} решения — уберите одно, чтобы добавить новое` : undefined}
      onClick={() => compare.toggle({ id: product.id, name: product.name, image: product.image_url })}
    >
      {selected ? <Check size={15} aria-hidden="true" /> : <Scale size={15} aria-hidden="true" />}
      {selected ? "В сравнении" : "Сравнить"}
    </button>
  );
}

export function ProductCard({ product, active, onHover, comparable, unknown }: ProductCardProps) {
  const Icon = KIND_ICON[resolveKind(product.solution_type, product.product_class)];
  const dimensions = formatDimensions(product.dimensions);
  const specs = [
    product.payload_kg !== null && { label: "Грузоподъёмность", value: `${formatNumber(product.payload_kg)} кг` },
    dimensions && { label: "Габариты", value: dimensions },
    product.max_speed_mps !== null && { label: "Скорость", value: `${formatNumber(product.max_speed_mps)} м/с` },
  ].filter(Boolean) as { label: string; value: string }[];
  const price =
    product.price_from !== null
      ? `от ${formatMoneyCompact(product.price_from)}`
      : product.monthly_fee_from !== null
        ? `${formatMoneyCompact(product.monthly_fee_from)} / мес`
        : "Цена по запросу";

  // Ссылка растянута на всю карточку, кнопка сравнения лежит поверх неё: кнопка внутри ссылки недопустима.
  return (
    <article
      className={cx("pcard", active && "is-active", !product.is_published && "pcard--pending")}
      onMouseEnter={() => onHover?.(product.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(product.id)}
      onBlur={() => onHover?.(null)}
    >
      <div className="pcard__media">
        {product.image_url ? (
          <img src={product.image_url} alt={product.image_caption || product.name} loading="lazy" decoding="async" />
        ) : (
          <span className="pcard__placeholder" title="Фото не загружено">
            <Icon size={34} strokeWidth={1.5} aria-hidden="true" />
          </span>
        )}
        {comparable && <CompareToggle product={product} className="pcard__compare" />}
        {product.image_is_illustration && <span className="pcard__illustration" title={product.image_caption || "Иллюстрация похожего типа техники"}>Иллюстрация типа</span>}
      </div>
      <div className="pcard__top">
        <span className="pcard__type">
          <span className="pcard__icon">
            <Icon size={16} aria-hidden="true" />
          </span>
          {product.solution_type?.name ?? "Тип не указан"}
        </span>
        {!product.is_published ? <Badge tone="warning">На проверке</Badge> : <ReadinessBadge status={product.readiness_status} />}
      </div>
      {product.image_source_url && (
        <a className="pcard__image-source" href={product.image_source_url} target="_blank" rel="noreferrer noopener" aria-label={`Источник изображения: ${product.name}`}>
          <ExternalLink size={13} aria-hidden="true" /> Источник изображения
        </a>
      )}
      <h3 className="pcard__name">
        <Link to={`/products/${product.id}`} className="pcard__link">
          {product.name}
        </Link>
      </h3>
      {product.manufacturer && <span className="pcard__maker" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {product.manufacturer_logo_url && <CompanyLogo name={product.manufacturer.name} url={product.manufacturer_logo_url} size={28} />}
        {companyShortName(product.manufacturer.name)}</span>}
      {product.purpose && <p className="pcard__purpose">{product.purpose}</p>}
      {specs.length > 0 ? (
        <dl className="pcard__specs">
          {specs.map((spec) => (
            <div key={spec.label}>
              <dt>{spec.label}</dt>
              <dd>{spec.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="pcard__nospecs">Технические характеристики ещё не заполнены</p>
      )}
      {unknown && unknown.length > 0 && (
        <p className="pcard__unknown">
          <CircleAlert size={14} aria-hidden="true" />
          Требует проверки: нет данных — {unknown.join(", ").toLowerCase()}
        </p>
      )}
      <div className="pcard__bottom">
        <span className="pcard__price">{price}</span>
        <CompletenessMeter percent={product.completeness_percent} />
      </div>
    </article>
  );
}

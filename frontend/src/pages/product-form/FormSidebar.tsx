import { ChevronRight, CircleCheck, Rotate3d } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import type { ChecklistItem } from "../../api/types";
import { formatNumber } from "../../format";
import type { RobotKind, Size } from "../../scene/robots/kinds";
import { SceneBoundary, supportsWebGL } from "../../scene/support";
import { Badge, Spinner } from "../../ui/Controls";
import { KIND_ICON } from "../catalog/ProductCard";
import { checklistField } from "./draft";

const RobotPreview = lazy(() => import("../../scene/robots/RobotPreview"));

function Ring({ percent }: { percent: number }) {
  const radius = 26;
  const length = 2 * Math.PI * radius;
  const tone = percent >= 75 ? "var(--success)" : percent >= 40 ? "var(--accent)" : "#e0a23b";
  return (
    <svg className="ring" viewBox="0 0 64 64" role="img" aria-label={`Полнота карточки ${percent}%`}>
      <circle cx="32" cy="32" r={radius} className="ring__track" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        className="ring__value"
        style={{ stroke: tone, strokeDasharray: length, strokeDashoffset: length * (1 - percent / 100) }}
      />
      <text x="32" y="36.5" textAnchor="middle" className="ring__text">
        {percent}%
      </text>
    </svg>
  );
}

interface FormSidebarProps {
  kind: RobotKind;
  size: Size;
  estimated: boolean;
  typeName: string | null;
  entered: { l: number | null; w: number | null; h: number | null };
  checklist: ChecklistItem[];
  done: Set<string>;
  onJump: (field: string) => void;
  animate: boolean;
}

const MISSING_SHOWN = 4;

export function FormSidebar({ kind, size, estimated, typeName, entered, checklist, done, onJump, animate }: FormSidebarProps) {
  const [webgl] = useState(supportsWebGL);
  const Icon = KIND_ICON[kind];
  const percent = checklist.length ? Math.round((done.size * 100) / checklist.length) : 100;
  const missing = checklist.filter((item) => !done.has(item.key));
  const dims = [entered.l, entered.w, entered.h];

  return (
    <div className="fside">
      <section className="preview card" aria-label="3D-превью товара">
        <header className="preview__head">
          <span className="preview__icon">
            <Icon size={17} aria-hidden="true" />
          </span>
          <div className="preview__titles">
            <strong>{typeName ?? "Тип решения не выбран"}</strong>
            <span>{typeName ? "Модель в масштабе по габаритам карточки" : "Выберите тип — модель изменится"}</span>
          </div>
        </header>
        <div className="preview__stage">
          {webgl ? (
            <SceneBoundary fallback={<p className="preview__fallback">3D-превью недоступно в этом браузере</p>}>
              <Suspense fallback={<div className="preview__fallback"><Spinner label="Загружаем 3D…" /></div>}>
                <RobotPreview kind={kind} size={size} animate={animate} />
              </Suspense>
            </SceneBoundary>
          ) : (
            <p className="preview__fallback">3D-превью недоступно: браузер не поддерживает WebGL</p>
          )}
          {estimated && kind !== "software" && (
            <span className="preview__badge">
              <Badge tone="warning">Габариты условные</Badge>
            </span>
          )}
        </div>
        <footer className="preview__foot">
          <div className="preview__dims" aria-label="Габариты">
            {(["Д", "Ш", "В"] as const).map((label, i) => (
              <span key={label} className={dims[i] === null ? "is-empty" : undefined}>
                <small>{label}</small>
                {dims[i] === null ? "—" : formatNumber(dims[i])}
              </span>
            ))}
            <em>мм</em>
          </div>
          <p className="preview__hint">
            <Rotate3d size={14} aria-hidden="true" />
            Потяните, чтобы повернуть. Сетка — 1 м, рядом человек ростом 1,8 м.
          </p>
        </footer>
      </section>

      <section className="completeness card" aria-labelledby="completeness-title">
        <div className="completeness__head">
          <Ring percent={percent} />
          <div>
            <h2 id="completeness-title">Полнота карточки</h2>
            <p>
              {done.size} из {checklist.length} обязательных характеристик по п. 3.3.7 ТЗ
            </p>
          </div>
        </div>
        {missing.length === 0 ? (
          <p className="completeness__done">
            <CircleCheck size={16} aria-hidden="true" />
            Все обязательные характеристики заполнены
          </p>
        ) : (
          <ul className="completeness__list">
            {missing.slice(0, MISSING_SHOWN).map((item) => (
              <li key={item.key}>
                <button type="button" onClick={() => onJump(checklistField(item.key))}>
                  {item.label}
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
            {missing.length > MISSING_SHOWN && <li className="completeness__more">и ещё {missing.length - MISSING_SHOWN}</li>}
          </ul>
        )}
      </section>
    </div>
  );
}

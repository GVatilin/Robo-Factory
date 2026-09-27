import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { hue, initials } from "../format";
import { cx } from "./Field";

export interface SegmentOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface SegmentedProps<T> {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  id?: string;
  invalid?: boolean;
}

/** Переключатель из нескольких вариантов (radiogroup). */
export function Segmented<T extends string | number | boolean>({
  options,
  value,
  onChange,
  label,
  size = "md",
  id,
  invalid,
}: SegmentedProps<T>) {
  return (
    <div
      id={id}
      className={cx("segmented", size === "sm" && "segmented--sm", invalid && "segmented--invalid")}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          className={cx("segmented__item", option.value === value && "is-active")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, description, disabled, id }: SwitchProps) {
  return (
    <label className={cx("switch", disabled && "switch--disabled")} htmlFor={id}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={cx("switch__track", checked && "is-on")}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {description && <span className="switch__description">{description}</span>}
      </span>
    </label>
  );
}

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "violet" | "ink";

export function Badge({ tone = "neutral", icon, children }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon}
      {children}
    </span>
  );
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const h = hue(name);
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${h} 78% 62%), hsl(${h + 18} 70% 44%))`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ label = "Загрузка…" }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <Loader2 size={18} className="spinner__icon" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <h3 className="empty__title">{title}</h3>
      {children && <p className="empty__text">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice--danger" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="notice__body">
        <strong>Не удалось загрузить данные</strong>
        <span>{message}</span>
      </div>
      {onRetry && (
        <button type="button" className="btn btn--subtle btn--sm" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", icon, children }: { tone?: "info" | "warning" | "success" | "danger"; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`}>
      {icon}
      <div className="notice__body">{children}</div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Модальное подтверждение на нативном <dialog>: фокус и Esc работают из коробки. */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onClose }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dialog-title">
      <h2 id="dialog-title" className="dialog__title">
        {title}
      </h2>
      <div className="dialog__body">{children}</div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
          Отмена
        </button>
        <button type="button" className={cx("btn", danger ? "btn--danger" : "btn--primary")} onClick={onConfirm} disabled={busy}>
          {busy ? <Loader2 size={16} className="spinner__icon" aria-hidden="true" /> : null}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

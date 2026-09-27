import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "./Field";

export interface ComboOption {
  value: number;
  label: string;
  group?: string;
  description?: string;
  /** Короткая пометка справа: «рекомендуется», число товаров и т. п. */
  meta?: ReactNode;
}

interface ComboboxProps {
  id?: string;
  options: ComboOption[];
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  emptyText?: string;
  footer?: ReactNode;
}

function matches(option: ComboOption, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${option.label} ${option.group ?? ""} ${option.description ?? ""}`.toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** Выпадающий список с поиском и группами, управляется с клавиатуры (ARIA combobox). */
export function Combobox({ id, options, value, onChange, placeholder, disabled, invalid, emptyText, footer }: ComboboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => options.filter((o) => matches(o, text)), [options, text]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openList = () => {
    if (disabled) return;
    setText("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const choose = (option: ComboOption) => {
    onChange(option.value);
    setOpen(false);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  let lastGroup: string | undefined;

  return (
    <div ref={root} className={cx("combo", open && "is-open", invalid && "combo--invalid", disabled && "combo--disabled")}>
      <div className="combo__control" onClick={() => (open ? null : openList())}>
        <Search size={16} className="combo__search" aria-hidden="true" />
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={selected ? selected.label : placeholder}
          value={open ? text : (selected?.label ?? "")}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => !open && openList()}
          onKeyDown={onKeyDown}
        />
        <ChevronDown size={16} className="combo__chevron" aria-hidden="true" />
      </div>
      {open && (
        <div className="combo__popover">
          <ul ref={list} id={listId} role="listbox" className="combo__list">
            {filtered.length === 0 && <li className="combo__empty">{emptyText ?? "Ничего не найдено"}</li>}
            {filtered.map((option, index) => {
              const header = option.group && option.group !== lastGroup ? option.group : null;
              lastGroup = option.group;
              return (
                <li key={option.value} role="presentation">
                  {header && <div className="combo__group">{header}</div>}
                  <div
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={option.value === value}
                    className={cx("combo__option", index === active && "is-active", option.value === value && "is-selected")}
                    onPointerEnter={() => setActive(index)}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      choose(option);
                    }}
                  >
                    <span className="combo__option-text">
                      <span className="combo__option-label">{option.label}</span>
                      {option.description && <span className="combo__option-description">{option.description}</span>}
                    </span>
                    {option.meta && <span className="combo__meta">{option.meta}</span>}
                    {option.value === value && <Check size={16} className="combo__check" aria-hidden="true" />}
                  </div>
                </li>
              );
            })}
          </ul>
          {footer && <div className="combo__footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}

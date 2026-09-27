import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** Сколько решений помещается в таблицу сравнения на экране 1366 px. */
export const COMPARE_LIMIT = 4;
const STORAGE_KEY = "robo-factory.compare";

export interface CompareEntry {
  id: number;
  name: string;
  image: string | null;
}

interface CompareState {
  items: CompareEntry[];
  has: (id: number) => boolean;
  full: boolean;
  toggle: (entry: CompareEntry) => void;
  remove: (id: number) => void;
  replace: (entries: CompareEntry[]) => void;
  clear: () => void;
}

const CompareContext = createContext<CompareState | null>(null);

function load(): CompareEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e?.id === "number").slice(0, COMPARE_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Выбранные для сравнения решения: переживают переход между страницами и перезагрузку. */
export function CompareProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CompareEntry[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Хранилище недоступно: выбор живёт до перезагрузки страницы.
    }
  }, [items]);

  const toggle = useCallback((entry: CompareEntry) => {
    setItems((current) =>
      current.some((e) => e.id === entry.id)
        ? current.filter((e) => e.id !== entry.id)
        : current.length >= COMPARE_LIMIT
          ? current
          : [...current, entry],
    );
  }, []);
  const remove = useCallback((id: number) => setItems((current) => current.filter((e) => e.id !== id)), []);
  const replace = useCallback((entries: CompareEntry[]) => setItems(entries.slice(0, COMPARE_LIMIT)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CompareState>(
    () => ({
      items,
      has: (id) => items.some((e) => e.id === id),
      full: items.length >= COMPARE_LIMIT,
      toggle,
      remove,
      replace,
      clear,
    }),
    [items, toggle, remove, replace, clear],
  );
  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare(): CompareState {
  const context = useContext(CompareContext);
  if (!context) throw new Error("useCompare вызывается вне CompareProvider");
  return context;
}

export function compareLink(ids: number[]): string {
  return `/compare?ids=${ids.join(",")}`;
}

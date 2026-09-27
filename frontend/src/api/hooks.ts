import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { api, ApiError } from "./client";
import type {
  CatalogOptions,
  ChecklistItem,
  FacilityType,
  Ref,
  SolutionTypeNode,
  SpecDefinition,
} from "./types";

interface ApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

/** GET-запрос с отменой при смене пути. Повторяется при входе и выходе: видимость данных зависит от роли. */
export function useApi<T>(path: string | null) {
  const { user } = useAuth();
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: path !== null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    api<T>(path, { signal: controller.signal }).then(
      (data) => setState({ data, error: null, loading: false }),
      (error: Error) => {
        if (error.name === "AbortError") return;
        setState({ data: null, error: error as ApiError, loading: false });
      },
    );
    return () => controller.abort();
  }, [path, version, user?.id]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

export interface ReferenceData {
  solutionTypes: SolutionTypeNode[];
  specs: SpecDefinition[];
  facilities: FacilityType[];
  industries: Ref[];
  checklist: ChecklistItem[];
  options: CatalogOptions;
}

let referenceCache: Promise<ReferenceData> | null = null;

function loadReference(): Promise<ReferenceData> {
  referenceCache ??= Promise.all([
    api<SolutionTypeNode[]>("/reference/solution-types"),
    api<SpecDefinition[]>("/reference/spec-definitions"),
    api<FacilityType[]>("/reference/facility-types"),
    api<Ref[]>("/reference/industries"),
    api<ChecklistItem[]>("/reference/product-checklist"),
    api<CatalogOptions>("/reference/catalog-options"),
  ]).then(
    ([solutionTypes, specs, facilities, industries, checklist, options]) => ({
      solutionTypes,
      specs,
      facilities,
      industries,
      checklist,
      options,
    }),
    (error) => {
      referenceCache = null;
      throw error;
    },
  );
  return referenceCache;
}

/** Справочники каталога: загружаются один раз за сессию. */
export function useReference() {
  const [data, setData] = useState<ReferenceData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    let alive = true;
    loadReference().then(
      (value) => alive && setData(value),
      (reason: ApiError) => alive && setError(reason),
    );
    return () => {
      alive = false;
    };
  }, []);
  return { data, error };
}

/** Название значения перечисления по справочнику. */
export function optionLabel(options: { value: string; label: string }[] | undefined, value: string | null): string {
  if (!value) return "—";
  return options?.find((o) => o.value === value)?.label ?? value;
}

/** Значение с задержкой: поиск не отправляет запрос на каждое нажатие клавиши. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

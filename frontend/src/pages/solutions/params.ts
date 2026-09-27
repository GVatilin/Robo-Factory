/**
 * Состояние каталога в адресе страницы: имена параметров совпадают с GET /api/v1/products,
 * поэтому ссылка на подборку воспроизводит её целиком, а «назад» в браузере отменяет фильтр.
 */

import type { TreeNode } from "../../api/types";

export const HIERARCHY_KEYS = ["industry_id", "facility_type_id", "process_id", "other_in_industry", "solution_type_id"] as const;
export const PAGE_SIZE = 24;

export type SpecOperator = ">=" | "<=" | "~" | "=";

export function apiQuery(params: URLSearchParams, limit: number): string {
  const query = new URLSearchParams(params);
  query.set("limit", String(limit));
  query.set("facets", "true");
  return `?${query.toString()}`;
}

export function specValue(params: URLSearchParams, code: string, op: SpecOperator): string {
  const prefix = `${code}${op}`;
  return params.getAll("spec").find((v) => v.startsWith(prefix))?.slice(prefix.length) ?? "";
}

export function withSpec(params: URLSearchParams, code: string, op: SpecOperator, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  const prefix = `${code}${op}`;
  const others = next.getAll("spec").filter((v) => !v.startsWith(prefix));
  next.delete("spec");
  for (const v of others) next.append("spec", v);
  if (value !== null && value.trim() !== "") next.append("spec", `${prefix}${value.trim()}`);
  return next;
}

export function withValue(params: URLSearchParams, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === null || value === "") next.delete(key);
  else next.set(key, value);
  return next;
}

export function toggleValue(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  const values = next.getAll(key);
  next.delete(key);
  for (const v of values.includes(value) ? values.filter((v) => v !== value) : [...values, value]) next.append(key, v);
  return next;
}

export function withHierarchy(params: URLSearchParams, node: Pick<TreeNode, "params"> | null): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of HIERARCHY_KEYS) next.delete(key);
  for (const [key, value] of Object.entries(node?.params ?? {})) next.set(key, String(value));
  return next;
}

export function isNodeSelected(node: TreeNode, params: URLSearchParams): boolean {
  return HIERARCHY_KEYS.every((key) => String(node.params[key] ?? "") === (params.get(key) ?? ""));
}

/** Путь от корня до выбранного узла — для хлебных крошек и раскрытия дерева. */
export function selectedPath(nodes: TreeNode[], params: URLSearchParams): TreeNode[] {
  for (const node of nodes) {
    if (isNodeSelected(node, params)) return [node];
    const inner = selectedPath(node.children, params);
    if (inner.length) return [node, ...inner];
  }
  return [];
}

export function hasHierarchy(params: URLSearchParams): boolean {
  return HIERARCHY_KEYS.some((key) => params.has(key));
}

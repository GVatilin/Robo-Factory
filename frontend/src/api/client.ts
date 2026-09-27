/** HTTP-клиент API: токен, JSON и ошибки проверки данных в одном формате. */

const BASE = "/api/v1";
const TOKEN_KEY = "robo-factory.token";

export class ApiError extends Error {
  readonly status: number;
  /** Ошибки по полям: путь в теле запроса → сообщение («specs.payload_kg.value»). */
  readonly fields: Record<string, string>;

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Хранилище недоступно (приватный режим): сессия живёт до перезагрузки страницы.
  }
}

/** Вызывается, когда сервер отклонил токен: контекст авторизации сбрасывает пользователя. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: Record<string, string>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, { method = "GET", body, form, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (form) {
    payload = new URLSearchParams(form);
  } else if (body instanceof FormData) {
    // Content-Type с границей multipart браузер проставит сам.
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { method, headers, body: payload, signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "Сервер недоступен. Проверьте подключение и повторите попытку.");
  }

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized?.();
    const fields: Record<string, string> = {};
    for (const error of data?.errors ?? []) fields[error.field] = error.message;
    const message = typeof data?.detail === "string" ? data.detail : `Ошибка сервера (${response.status})`;
    throw new ApiError(response.status, message, fields);
  }
  return data as T;
}

/** Строка запроса из непустых параметров. */
export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

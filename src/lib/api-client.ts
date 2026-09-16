"use client";

/**
 * Browser API client.
 *
 * Adds the double-submit CSRF header to every mutation and turns the API's
 * error envelope into a typed error the UI can render — including field-level
 * validation messages.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)okun_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

type RequestOptions = { signal?: AbortSignal };

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const isMutation = method !== "GET";
  const isFormData = body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(isFormData || body === undefined ? {} : { "content-type": "application/json" }),
        ...(isMutation ? { "x-okun-csrf": csrfToken() } : {}),
      },
      body: isFormData ? body : body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Keine Verbindung zum Server. Bitte Internetverbindung prüfen.");
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new ApiError(response.status, "INTERNAL_ERROR", "Es ist ein unerwarteter Fehler aufgetreten.");
    }
    return undefined as T;
  }

  const payload = (await response.json()) as
    | { data: T }
    | { error: { code: string; message: string; details?: { fields?: Record<string, string> } } };

  if (!response.ok || "error" in payload) {
    const error = "error" in payload ? payload.error : undefined;
    throw new ApiError(
      response.status,
      error?.code ?? "INTERNAL_ERROR",
      error?.message ?? "Es ist ein unerwarteter Fehler aufgetreten.",
      error?.details?.fields ?? {},
    );
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body, options),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/** Serialises list state into the query string the API expects. */
export function listQueryString(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  filter?: unknown;
}): string {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.search) search.set("search", params.search);
  if (params.sortField) search.set("sortField", params.sortField);
  if (params.sortDirection) search.set("sortDirection", params.sortDirection);
  if (params.filter) search.set("filter", JSON.stringify(params.filter));
  const value = search.toString();
  return value ? `?${value}` : "";
}

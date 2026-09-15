/**
 * Application error taxonomy. Every error that reaches the API boundary is
 * converted into one of these; unknown errors become a generic 500 so no
 * stack trace or driver detail ever reaches a client.
 */
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTEGRATION_NOT_CONNECTED"
  | "INTERNAL_ERROR";

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTEGRATION_NOT_CONNECTED: 409,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const Unauthenticated = (message = "Nicht angemeldet.") => new AppError("UNAUTHENTICATED", message);
export const Forbidden = (message = "Keine Berechtigung für diese Aktion.") => new AppError("FORBIDDEN", message);
export const NotFound = (message = "Der Datensatz wurde nicht gefunden.") => new AppError("NOT_FOUND", message);
export const Conflict = (message: string, details?: unknown) => new AppError("CONFLICT", message, details);
export const ValidationError = (message: string, details?: unknown) =>
  new AppError("VALIDATION_ERROR", message, details);
export const RateLimited = (message = "Zu viele Anfragen. Bitte später erneut versuchen.") =>
  new AppError("RATE_LIMITED", message);
export const IntegrationNotConnected = (message: string) => new AppError("INTEGRATION_NOT_CONNECTED", message);

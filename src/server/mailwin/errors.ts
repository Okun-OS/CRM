import { z } from "zod";
import { AppError } from "@/lib/api/errors";

/**
 * Fehlervertrag der Mailwin Connect API.
 *
 * Die Hülle ist `{ "error": { "code", "message" } }`, bei Validierungsfehlern
 * zusätzlich `details.fields`. Die Codes sind stabil und englisch (Mailwin
 * verzweigt darauf), die Meldungen deutsch und für Menschen gedacht.
 */
export type MailwinErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "idempotency_key_in_use"
  | "idempotency_key_reused"
  | "validation_failed"
  | "payload_too_large"
  | "rate_limited"
  | "internal_error";

export class MailwinError extends Error {
  constructor(
    readonly status: number,
    readonly code: MailwinErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "MailwinError";
  }
}

export const invalidRequest = (message: string) => new MailwinError(400, "invalid_request", message);
export const notFound = (message: string) => new MailwinError(404, "not_found", message);
export const validationFailed = (message: string, fields: Record<string, string>) =>
  new MailwinError(422, "validation_failed", message, { fields });

const APP_ERROR_MAP: Record<string, { status: number; code: MailwinErrorCode }> = {
  UNAUTHENTICATED: { status: 401, code: "unauthorized" },
  FORBIDDEN: { status: 403, code: "forbidden" },
  NOT_FOUND: { status: 404, code: "not_found" },
  VALIDATION_ERROR: { status: 422, code: "validation_failed" },
  CONFLICT: { status: 409, code: "conflict" },
  RATE_LIMITED: { status: 429, code: "rate_limited" },
  PAYLOAD_TOO_LARGE: { status: 413, code: "payload_too_large" },
  INTEGRATION_NOT_CONNECTED: { status: 409, code: "conflict" },
};

/** Bildet jeden Fehler auf den Mailwin-Vertrag ab. Unbekanntes wird zu 500 ohne Details. */
export function toMailwinError(error: unknown): MailwinError {
  if (error instanceof MailwinError) return error;

  if (error instanceof z.ZodError) {
    return validationFailed("Die übermittelten Daten sind ungültig.", fieldErrors(error));
  }

  if (error instanceof AppError) {
    const mapped = APP_ERROR_MAP[error.code] ?? { status: 500, code: "internal_error" as const };
    const fields = extractFields(error.details);
    return new MailwinError(mapped.status, mapped.code, error.message, fields ? { fields } : undefined);
  }

  return new MailwinError(500, "internal_error", "Unerwarteter Fehler. Bitte später erneut versuchen.");
}

/** Feldpfade in Punktschreibweise, z. B. `contact.email` oder `sourceRef.url`. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}

function extractFields(details: unknown): Record<string, string> | null {
  if (!details || typeof details !== "object") return null;
  const record = details as Record<string, unknown>;
  const source = (record.fields && typeof record.fields === "object" ? record.fields : record) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") fields[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") fields[key] = value[0];
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

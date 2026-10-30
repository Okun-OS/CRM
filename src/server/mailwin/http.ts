import "server-only";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serialize } from "@/lib/api/json";
import { takeRateLimit, type RateLimitState } from "@/lib/api/rate-limit";
import type { ActorContext } from "@/lib/context";
import { logError, logWarn } from "@/lib/logger";
import { MAILWIN_SCOPE } from "@/lib/crm/mailwin";
import { authenticateApiKey, contextForApiKey, type ApiKeyPrincipal } from "@/server/services/api-keys";
import { MailwinError, invalidRequest, toMailwinError } from "./errors";
import { beginIdempotent, completeIdempotent, releaseIdempotent } from "./idempotency";

/**
 * Rahmen jedes Aufrufs der Mailwin Connect API.
 *
 * Reihenfolge mit Absicht: Erst wer ruft (401), dann ob er das darf (403),
 * dann ob er zu oft ruft (429) — erst danach wird der Body gelesen und eine
 * Idempotenz-Sperre gesetzt. So kann ein ungültiger Schlüssel nichts belegen.
 *
 * Der Mandant kommt ausschließlich aus dem Schlüssel. Kein Feld im Body oder in
 * der Adresse kann auf einen anderen Arbeitsbereich zeigen.
 *
 * Vorbereitet für OAuth 2.0: Der Handler sieht nur `MailwinPrincipal`. Ein
 * späteres Access-Token wird in `authenticate` zu demselben Prinzipal
 * aufgelöst, die Endpunkte bleiben unverändert.
 */
export const MAILWIN_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
const MAX_BODY_BYTES = 256 * 1024;

export type MailwinPrincipal = {
  kind: "api_key";
  credentialId: string;
  credentialName: string;
  organizationId: string;
  organizationName: string;
  /** Wer den Schlüssel erzeugt hat — in dessen Namen laufen die Aufrufe. */
  createdById: string | null;
};

export type MailwinRequest = {
  req: NextRequest;
  url: URL;
  ctx: ActorContext;
  principal: MailwinPrincipal;
  /** Geparster JSON-Body (nur bei POST). */
  body: unknown;
};

export type MailwinResult = { status: number; body: unknown };

export function mailwinRoute(handler: (request: MailwinRequest) => Promise<MailwinResult>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const started = Date.now();
    const requestId = randomUUID();
    const url = new URL(req.url);
    const idempotencyKey = req.method === "POST" ? req.headers.get("idempotency-key") : null;

    let principal: MailwinPrincipal | null = null;
    let rate: RateLimitState | null = null;
    let recordId: string | null = null;
    let replayed = false;

    const respond = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      const headers: Record<string, string> = { "X-Request-Id": requestId, ...extra };
      if (rate) {
        headers["RateLimit-Limit"] = String(rate.limit);
        headers["RateLimit-Remaining"] = String(rate.remaining);
        headers["RateLimit-Reset"] = String(rate.resetSeconds);
      }
      if (replayed) headers["Idempotent-Replayed"] = "true";
      return NextResponse.json(serialize(body) as object, { status, headers });
    };

    let response: NextResponse;
    let errorCode: string | null = null;

    try {
      principal = await authenticate(req.headers.get("authorization"));

      rate = takeRateLimit({ key: `mailwin:${principal.credentialId}`, ...MAILWIN_RATE_LIMIT });
      if (!rate.allowed) {
        throw new MailwinError(
          429,
          "rate_limited",
          `Zu viele Anfragen: höchstens ${MAILWIN_RATE_LIMIT.limit} pro Minute und Schlüssel.`,
          undefined,
          { "Retry-After": String(rate.resetSeconds) },
        );
      }

      let body: unknown = undefined;
      let rawBody = "";
      if (req.method === "POST") {
        rawBody = await readRawBody(req);
        try {
          body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
        } catch {
          throw invalidRequest("Der Request-Body ist kein gültiges JSON.");
        }
      }

      if (idempotencyKey !== null) {
        const begin = await beginIdempotent({
          organizationId: principal.organizationId,
          credentialId: principal.credentialId,
          key: idempotencyKey,
          method: req.method,
          path: url.pathname,
          rawBody,
        });
        if (begin.kind === "replay") {
          replayed = true;
          response = respond(begin.status, begin.body);
          await logRequest(principal, req.method, url.pathname, begin.status, started, null, idempotencyKey, true);
          return response;
        }
        recordId = begin.recordId;
      }

      const ctx = await contextFor(principal);
      const result = await handler({ req, url, ctx, principal, body });
      const serialized = serialize(result.body);
      if (recordId) await completeIdempotent(recordId, result.status, serialized);
      response = respond(result.status, serialized);
    } catch (error) {
      if (recordId) await releaseIdempotent(recordId);
      const mapped = toMailwinError(error);
      if (mapped.status >= 500) logError("mailwin.request_failed", error, { path: url.pathname, requestId });
      if (mapped.status === 401) logWarn("mailwin.unauthorized", { path: url.pathname, requestId });
      errorCode = mapped.code;
      response = respond(
        mapped.status,
        { error: { code: mapped.code, message: mapped.message, ...(mapped.details ? { details: mapped.details } : {}) } },
        mapped.headers,
      );
    }

    // Ohne gültigen Schlüssel gibt es keinen Arbeitsbereich, in dessen
    // Protokoll der Aufruf gehörte — er landet nur im Anwendungslog (oben).
    if (principal) {
      await logRequest(principal, req.method, url.pathname, response.status, started, errorCode, idempotencyKey, false);
    }
    return response;
  };
}

async function authenticate(header: string | null): Promise<MailwinPrincipal> {
  let key: ApiKeyPrincipal;
  try {
    key = await authenticateApiKey(header);
  } catch {
    throw new MailwinError(401, "unauthorized", "Der API-Schlüssel fehlt, ist ungültig oder wurde widerrufen.");
  }
  if (!key.scopes.includes(MAILWIN_SCOPE)) {
    throw new MailwinError(403, "forbidden", "Dieser API-Schlüssel ist nicht für die Mailwin Connect API freigegeben.");
  }
  if (!key.organizationActive) {
    throw new MailwinError(403, "forbidden", "Der Arbeitsbereich ist gesperrt.");
  }
  return {
    kind: "api_key",
    credentialId: key.keyId,
    credentialName: key.keyName,
    organizationId: key.organizationId,
    organizationName: key.organizationName,
    createdById: key.createdById,
  };
}

/**
 * Für wen die Integration handelt: die Person, die den Schlüssel erzeugt hat
 * (solange sie Administrator ist). Die Rechte des Schlüssels begrenzt dabei
 * der Scope — er erreicht ausschließlich die Endpunkte dieser Schnittstelle.
 */
async function contextFor(principal: MailwinPrincipal): Promise<ActorContext> {
  const ctx = await contextForApiKey(
    {
      keyId: principal.credentialId,
      keyName: principal.credentialName,
      organizationId: principal.organizationId,
      organizationName: principal.organizationName,
      organizationActive: true,
      scopes: [MAILWIN_SCOPE],
      createdById: principal.createdById,
    },
    { preferCreator: true },
  ).catch(() => {
    throw new MailwinError(403, "forbidden", "Der Arbeitsbereich hat kein aktives Administratorkonto.");
  });
  return { ...ctx, origin: "mailwin", credentialId: principal.credentialId, userAgent: "OKUN Mailwin" };
}

async function readRawBody(req: NextRequest): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    throw new MailwinError(413, "payload_too_large", "Der Request-Body ist zu groß (höchstens 256 KB).");
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new MailwinError(413, "payload_too_large", "Der Request-Body ist zu groß (höchstens 256 KB).");
  }
  return text;
}

/**
 * Jeder Aufruf mit gültigem Schlüssel landet im Aufrufprotokoll des
 * Arbeitsbereichs (Einstellungen → Integrationen → Mailwin). Gespeichert wird
 * der Pfad ohne Query — `?email=` ist ein personenbezogenes Datum und gehört
 * nicht in ein Protokoll.
 */
async function logRequest(
  principal: MailwinPrincipal,
  method: string,
  path: string,
  status: number,
  started: number,
  errorCode: string | null,
  idempotencyKey: string | null,
  replayed: boolean,
): Promise<void> {
  try {
    await prisma.integrationRequestLog.create({
      data: {
        organizationId: principal.organizationId,
        integration: "mailwin",
        credentialId: principal.credentialId,
        method,
        path,
        status,
        durationMs: Date.now() - started,
        errorCode,
        idempotencyKey: idempotencyKey?.slice(0, 255) ?? null,
        replayed,
      },
    });
  } catch (error) {
    logError("mailwin.request_log_failed", error, { path });
  }
}

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { MailwinError, invalidRequest } from "./errors";

/**
 * `Idempotency-Key` für schreibende Aufrufe.
 *
 * Derselbe Schlüssel liefert innerhalb von 24 Stunden dieselbe Antwort und legt
 * nichts doppelt an. Gespeichert werden nur erfolgreiche Antworten: Ein
 * abgelehnter Aufruf (etwa 422) hat nichts angelegt, und Mailwin soll ihn mit
 * korrigierten Daten unter demselben Schlüssel wiederholen dürfen.
 *
 * Gleichzeitige Aufrufe mit demselben Schlüssel scheitern nicht an einem
 * Wettrennen: Der erste legt den Datensatz an, der zweite bekommt 409 und
 * versucht es kurz darauf erneut — dann mit der gespeicherten Antwort.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export type IdempotencyBegin =
  | { kind: "new"; recordId: string }
  | { kind: "replay"; status: number; body: unknown };

export function requestHash(method: string, path: string, rawBody: string): string {
  return createHash("sha256").update(`${method}\n${path}\n${rawBody}`).digest("hex");
}

export async function beginIdempotent(input: {
  organizationId: string;
  credentialId: string;
  key: string;
  method: string;
  path: string;
  rawBody: string;
}): Promise<IdempotencyBegin> {
  if (!KEY_PATTERN.test(input.key)) {
    throw invalidRequest("Idempotency-Key muss 1–255 sichtbare ASCII-Zeichen lang sein.");
  }
  const hash = requestHash(input.method, input.path, input.rawBody);
  const now = new Date();

  const existing = await prisma.idempotencyRecord.findUnique({
    where: { organizationId_key: { organizationId: input.organizationId, key: input.key } },
  });

  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== hash) {
      throw new MailwinError(
        422,
        "idempotency_key_reused",
        "Dieser Idempotency-Key wurde bereits für eine andere Anfrage verwendet.",
      );
    }
    if (existing.responseStatus === null) {
      throw new MailwinError(
        409,
        "idempotency_key_in_use",
        "Eine Anfrage mit diesem Idempotency-Key wird gerade verarbeitet. Bitte kurz darauf wiederholen.",
        undefined,
        { "Retry-After": "1" },
      );
    }
    return { kind: "replay", status: existing.responseStatus, body: existing.responseBody };
  }

  if (existing) {
    await prisma.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => undefined);
  }

  try {
    const record = await prisma.idempotencyRecord.create({
      data: {
        organizationId: input.organizationId,
        credentialId: input.credentialId,
        key: input.key,
        method: input.method,
        path: input.path,
        requestHash: hash,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
      select: { id: true },
    });
    return { kind: "new", recordId: record.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Eine zweite Anfrage war schneller — sie verarbeitet gerade.
      throw new MailwinError(
        409,
        "idempotency_key_in_use",
        "Eine Anfrage mit diesem Idempotency-Key wird gerade verarbeitet. Bitte kurz darauf wiederholen.",
        undefined,
        { "Retry-After": "1" },
      );
    }
    throw error;
  }
}

export async function completeIdempotent(recordId: string, status: number, body: unknown): Promise<void> {
  if (status >= 200 && status < 300) {
    await prisma.idempotencyRecord.update({
      where: { id: recordId },
      data: { responseStatus: status, responseBody: (body ?? null) as Prisma.InputJsonValue },
    });
    return;
  }
  await releaseIdempotent(recordId);
}

/** Gibt den Schlüssel wieder frei, wenn die Anfrage nichts angelegt hat. */
export async function releaseIdempotent(recordId: string): Promise<void> {
  await prisma.idempotencyRecord.delete({ where: { id: recordId } }).catch(() => undefined);
}

export async function purgeExpiredIdempotencyRecords(now = new Date()): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } });
  return result.count;
}

import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { emailField } from "@/lib/schemas/crm";

/**
 * Kontaktsperre.
 *
 * Sie überlebt den einzelnen Datensatz absichtlich: Wer sich abgemeldet hat,
 * soll auch nach einem erneuten Import nicht wieder angeschrieben werden.
 * Deshalb steht hier die Adresse, nicht der Prospect.
 *
 * Geprüft wird vor jedem Versand, serverseitig — nicht in der Oberfläche
 * versteckt.
 */
export const suppressionInputSchema = z.object({
  scope: z.enum(["EMAIL", "DOMAIN"]).default("EMAIL"),
  value: z.string().trim().min(3).max(254),
  reason: z.enum(["UNSUBSCRIBED", "BOUNCED", "COMPLAINT", "MANUAL", "DO_NOT_CONTACT"]).default("MANUAL"),
  note: z.string().trim().max(300).optional(),
});

/** Adressen und Domains immer klein — sonst greift die Sperre am Rand nicht. */
function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

export async function listSuppression(ctx: ActorContext, limit = 200) {
  assertPermission(ctx, "outreach.settings");
  const entries = await prisma.suppressionEntry.findMany({
    where: scope(ctx),
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 500),
    include: { createdBy: { select: { id: true, name: true } } },
  });
  return entries.map((entry) => ({
    id: entry.id,
    scope: entry.scope,
    value: entry.value,
    reason: entry.reason,
    note: entry.note,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt.toISOString(),
  }));
}

export async function addSuppression(
  ctx: ActorContext,
  input: z.input<typeof suppressionInputSchema>,
  options: { permission?: boolean } = {},
) {
  // Der Versandweg trägt Abmeldungen und Bounces selbst ein; dann ist kein
  // Mensch beteiligt, der ein Recht haben könnte.
  if (options.permission !== false) assertPermission(ctx, "outreach.settings");
  const data = suppressionInputSchema.parse(input);
  const value = normalise(data.value);

  if (data.scope === "EMAIL") emailField.parse(value);

  const entry = await prisma.suppressionEntry.upsert({
    where: { organizationId_scope_value: { organizationId: ctx.organizationId, scope: data.scope, value } },
    create: {
      organizationId: ctx.organizationId,
      scope: data.scope,
      value,
      reason: data.reason,
      note: data.note,
      createdById: ctx.userId,
    },
    update: { reason: data.reason, note: data.note },
  });

  await writeAudit(ctx, {
    action: "suppression.added",
    entityType: "SuppressionEntry",
    entityId: entry.id,
    after: { scope: entry.scope, value: entry.value, reason: entry.reason },
  });

  return entry;
}

export async function removeSuppression(ctx: ActorContext, id: string) {
  assertPermission(ctx, "outreach.settings");
  const existing = await prisma.suppressionEntry.findFirst({ where: { id, ...scope(ctx) } });
  if (!existing) return;

  await prisma.suppressionEntry.delete({ where: { id: existing.id } });
  await writeAudit(ctx, {
    action: "suppression.removed",
    entityType: "SuppressionEntry",
    entityId: id,
    before: { scope: existing.scope, value: existing.value, reason: existing.reason },
  });
}

export type SuppressionCheck = { blocked: false } | { blocked: true; reason: string; entryId: string };

/**
 * Darf an diese Adresse gesendet werden?
 *
 * Geprüft wird die Adresse **und** ihre Domain: Wer eine ganze Firma gesperrt
 * hat, meinte nicht nur die eine Adresse.
 */
export async function checkSuppression(
  organizationId: string,
  email: string | null | undefined,
): Promise<SuppressionCheck> {
  if (!email) return { blocked: false };
  const address = normalise(email);
  const domain = domainOf(address);

  const entry = await prisma.suppressionEntry.findFirst({
    where: {
      organizationId,
      OR: [
        { scope: "EMAIL", value: address },
        ...(domain ? [{ scope: "DOMAIN" as const, value: domain }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  if (!entry) return { blocked: false };

  const REASONS: Record<string, string> = {
    UNSUBSCRIBED: "Der Empfänger hat sich abgemeldet.",
    BOUNCED: "Die Adresse war nicht zustellbar.",
    COMPLAINT: "Es liegt eine Beschwerde vor.",
    MANUAL: "Die Adresse wurde von Hand gesperrt.",
    DO_NOT_CONTACT: "Für diesen Empfänger gilt eine Kontaktsperre.",
  };

  return {
    blocked: true,
    entryId: entry.id,
    reason:
      entry.scope === "DOMAIN"
        ? `Für die Domain ${entry.value} gilt eine Sperre. ${REASONS[entry.reason] ?? ""}`.trim()
        : REASONS[entry.reason] ?? "Für diese Adresse gilt eine Sperre.",
  };
}

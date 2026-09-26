import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { emitDomainEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { checkSuppression, domainOf } from "./suppression";
import { recordProvenance } from "./prospects";
import type { ProspectCandidate } from "@/server/acquisition/providers/types";

/**
 * Die Übernahme von Kandidaten in den Bestand.
 *
 * Gleich für jede Quelle — Tabelle, eigener Bestand oder später ein externer
 * Anbieter. Entscheidend sind drei Dinge, die hier einmal richtig stehen:
 * keine Dubletten, dokumentierte Herkunft je Feld, und eine bestehende
 * Kontaktsperre schlägt sofort durch.
 */
export type IntakeResult = {
  created: number;
  duplicates: number;
  suppressed: number;
  skipped: number;
  prospectIds: string[];
};

export async function intakeCandidates(
  ctx: ActorContext,
  sourceKey: string,
  candidates: ProspectCandidate[],
  options: { listId?: string | null; ownerId?: string | null } = {},
): Promise<IntakeResult> {
  assertPermission(ctx, "prospects.write");

  const result: IntakeResult = { created: 0, duplicates: 0, suppressed: 0, skipped: 0, prospectIds: [] };

  for (const candidate of candidates) {
    const companyName = candidate.companyName?.trim();
    if (!companyName) {
      result.skipped += 1;
      continue;
    }

    const email = candidate.email?.trim().toLowerCase() || null;
    const domain = candidate.domain?.trim().toLowerCase() || domainOf(email);

    // Dublettenprüfung innerhalb des Bestands: dieselbe Reihenfolge wie beim
    // Anlegen von Hand — Adresse identifiziert einen Menschen, Domain nur eine
    // Firma.
    const existing = email
      ? await prisma.prospect.findFirst({ where: { organizationId: ctx.organizationId, deletedAt: null, email } })
      : domain
        ? await prisma.prospect.findFirst({
            where: { organizationId: ctx.organizationId, deletedAt: null, domain, email: null },
          })
        : null;

    if (existing) {
      result.duplicates += 1;
      // Auch eine Dublette gehört in die Liste, für die jemand sie geholt hat.
      if (options.listId) await addToListQuietly(ctx, options.listId, existing.id);
      continue;
    }

    const suppression = await checkSuppression(ctx.organizationId, email);
    if (suppression.blocked) result.suppressed += 1;

    const prospect = await prisma.prospect.create({
      data: {
        organizationId: ctx.organizationId,
        companyName,
        domain,
        website: candidate.website ?? null,
        industry: candidate.industry ?? null,
        employeeCount: candidate.employeeCount ?? null,
        street: candidate.street ?? null,
        postalCode: candidate.postalCode ?? null,
        city: candidate.city ?? null,
        country: candidate.country ?? null,
        phone: candidate.phone ?? null,
        firstName: candidate.firstName ?? null,
        lastName: candidate.lastName ?? null,
        email,
        jobTitle: candidate.jobTitle ?? null,
        linkedinUrl: candidate.linkedinUrl ?? null,
        sourceKey,
        sourceRef: candidate.sourceRef ?? null,
        ownerId: options.ownerId ?? ctx.userId,
        createdById: ctx.userId,
        stage: suppression.blocked ? "DO_NOT_CONTACT" : "NEW",
      },
    });

    await recordProvenance(ctx.organizationId, prospect.id, sourceKey, candidate.provenance);
    if (options.listId) await addToListQuietly(ctx, options.listId, prospect.id);

    result.created += 1;
    result.prospectIds.push(prospect.id);

    await emitDomainEvent(ctx, {
      name: "prospect.created",
      entityType: "PROSPECT",
      entityId: prospect.id,
      payload: { companyName, sourceKey },
    });
  }

  await writeAudit(ctx, {
    action: "prospects.imported",
    entityType: "Prospect",
    entityId: options.listId ?? sourceKey,
    after: {
      source: sourceKey,
      created: result.created,
      duplicates: result.duplicates,
      suppressed: result.suppressed,
      skipped: result.skipped,
    },
  });

  return result;
}

/** Mitgliedschaft ohne Rechteprüfung — der Aufrufer hat sie bereits. */
async function addToListQuietly(ctx: ActorContext, listId: string, prospectId: string) {
  const list = await prisma.prospectList.findFirst({
    where: { id: listId, organizationId: ctx.organizationId, kind: "STATIC" },
    select: { id: true },
  });
  if (!list) return;

  await prisma.prospectListMembership.upsert({
    where: { listId_prospectId: { listId, prospectId } },
    create: { organizationId: ctx.organizationId, listId, prospectId, addedById: ctx.userId },
    update: {},
  });
}

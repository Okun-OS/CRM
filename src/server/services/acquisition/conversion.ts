import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { createActivity } from "@/server/services/activities";
import { getDefaultPipeline } from "@/server/services/pipelines";
import { domainOf } from "./suppression";

/**
 * Die Übernahme eines Prospects ins CRM.
 *
 * Der wichtigste Vorgang der ganzen Engine — und der, an dem sich entscheidet,
 * ob Outreach ein Datensilo bleibt. Drei Regeln:
 *
 * 1. **Nichts doppelt anlegen.** Vorhandene Unternehmen werden über die Domain
 *    erkannt, vorhandene Kontakte über die E-Mail-Adresse.
 * 2. **Nichts kopieren.** Die gesendeten Nachrichten werden umgehängt, nicht
 *    dupliziert — dieselbe Zeile trägt danach zusätzlich Kontakt und
 *    Unternehmen. Es gibt keine zweite Chronik.
 * 3. **Nichts verlieren.** Quelle, Liste, Sequenz und Zeitpunkte bleiben am
 *    Prospect stehen; er zeigt auf den entstandenen Kontakt. Das ist die
 *    Grundlage der Attribution.
 */
export const conversionInputSchema = z.object({
  /** Einen Deal mit anlegen — mit Name und Wert, falls schon bekannt. */
  createDeal: z.boolean().default(false),
  dealName: z.string().trim().max(160).optional(),
  dealAmount: z.coerce.number().min(0).max(1_000_000_000_000).optional(),
  pipelineId: z.string().max(30).optional(),
  stageId: z.string().max(30).optional(),
  ownerId: z.string().max(30).optional(),
});

export type ConversionResult = {
  prospectId: string;
  contactId: string | null;
  companyId: string;
  dealId: string | null;
  reusedCompany: boolean;
  reusedContact: boolean;
  movedMessages: number;
};

export async function convertProspect(
  ctx: ActorContext,
  prospectId: string,
  input: z.input<typeof conversionInputSchema>,
): Promise<ConversionResult> {
  assertPermission(ctx, "prospects.write");
  assertPermission(ctx, "companies.write");
  const data = conversionInputSchema.parse(input);

  const prospect = assertFound(
    await prisma.prospect.findFirst({ where: { id: prospectId, ...scope(ctx), deletedAt: null } }),
    "Der Prospect wurde nicht gefunden.",
  );

  if (prospect.convertedAt) {
    throw Conflict("Dieser Prospect wurde bereits übernommen.");
  }
  if (prospect.stage === "DO_NOT_CONTACT") {
    throw ValidationError(
      "Für diesen Prospect gilt eine Kontaktsperre. Eine Übernahme ins CRM widerspräche dem Wunsch des Gegenübers.",
    );
  }

  const ownerId = data.ownerId ?? prospect.ownerId ?? ctx.userId;
  const domain = prospect.domain ?? domainOf(prospect.email);

  const result = await prisma.$transaction(async (tx) => {
    /* ── Unternehmen: vorhandenes erkennen oder anlegen ────────────────── */
    const existingCompany = domain
      ? await tx.company.findFirst({ where: { organizationId: ctx.organizationId, deletedAt: null, domain } })
      : await tx.company.findFirst({
          where: { organizationId: ctx.organizationId, deletedAt: null, name: prospect.companyName },
        });

    const company =
      existingCompany ??
      (await tx.company.create({
        data: {
          organizationId: ctx.organizationId,
          name: prospect.companyName,
          domain,
          website: prospect.website,
          industry: prospect.industry,
          employeeCount: prospect.employeeCount,
          street: prospect.street,
          postalCode: prospect.postalCode,
          city: prospect.city,
          country: prospect.country,
          phone: prospect.phone,
          // Die Herkunft wandert mit — ohne sie wäre die Attribution später
          // eine Rekonstruktion aus Zeitstempeln.
          source: `acquisition:${prospect.sourceKey}`,
          ownerId,
          createdById: ctx.userId,
        },
      }));

    /* ── Kontakt: nur, wenn ein Mensch bekannt ist ─────────────────────── */
    let contactId: string | null = null;
    let reusedContact = false;

    if (prospect.email || prospect.lastName) {
      const existingContact = prospect.email
        ? await tx.contact.findFirst({
            where: { organizationId: ctx.organizationId, deletedAt: null, email: prospect.email },
          })
        : null;

      if (existingContact) {
        contactId = existingContact.id;
        reusedContact = true;
        // Nur ergänzen, nichts überschreiben: Was im CRM steht, wurde
        // wahrscheinlich von einem Menschen gepflegt.
        await tx.contact.update({
          where: { id: existingContact.id },
          data: {
            companyId: existingContact.companyId ?? company.id,
            jobTitle: existingContact.jobTitle ?? prospect.jobTitle,
            phone: existingContact.phone ?? prospect.phone,
          },
        });
      } else {
        const created = await tx.contact.create({
          data: {
            organizationId: ctx.organizationId,
            firstName: prospect.firstName?.trim() || "Unbekannt",
            lastName: prospect.lastName?.trim() || prospect.companyName,
            email: prospect.email,
            phone: prospect.phone,
            jobTitle: prospect.jobTitle,
            linkedinUrl: prospect.linkedinUrl,
            city: prospect.city,
            country: prospect.country,
            companyId: company.id,
            source: `acquisition:${prospect.sourceKey}`,
            ownerId,
            createdById: ctx.userId,
          },
        });
        contactId = created.id;
      }
    }

    /* ── Deal, falls gewünscht ─────────────────────────────────────────── */
    let dealId: string | null = null;
    if (data.createDeal) {
      const pipeline = data.pipelineId
        ? await tx.pipeline.findFirst({
            where: { id: data.pipelineId, organizationId: ctx.organizationId, isArchived: false },
            include: { stages: { orderBy: { position: "asc" } } },
          })
        : await tx.pipeline.findFirst({
            where: { organizationId: ctx.organizationId, isArchived: false },
            include: { stages: { orderBy: { position: "asc" } } },
            orderBy: [{ isDefault: "desc" }, { position: "asc" }],
          });

      if (!pipeline || pipeline.stages.length === 0) {
        throw ValidationError("Es ist keine Pipeline mit Stages vorhanden, in der ein Deal entstehen könnte.");
      }

      const stage =
        pipeline.stages.find((entry) => entry.id === data.stageId) ??
        pipeline.stages.find((entry) => entry.type === "OPEN") ??
        pipeline.stages[0];

      const deal = await tx.deal.create({
        data: {
          organizationId: ctx.organizationId,
          name: data.dealName?.trim() || `${prospect.companyName} — Erstgeschäft`,
          pipelineId: pipeline.id,
          stageId: stage.id,
          amount: data.dealAmount ?? 0,
          probability: stage.probability,
          companyId: company.id,
          source: `acquisition:${prospect.sourceKey}`,
          ownerId,
          ...(contactId ? { contacts: { create: [{ organizationId: ctx.organizationId, contactId }] } } : {}),
        },
      });
      dealId = deal.id;
    }

    /* ── Nachrichten umhängen statt kopieren ───────────────────────────── */
    const moved = await tx.emailMessage.updateMany({
      where: { organizationId: ctx.organizationId, prospectId: prospect.id },
      data: { contactId, companyId: company.id, ...(dealId ? { dealId } : {}) },
    });

    /* ── Der Prospect bleibt und zeigt auf das Ergebnis ────────────────── */
    await tx.prospect.update({
      where: { id: prospect.id },
      data: {
        stage: "CONVERTED",
        contactId,
        companyId: company.id,
        dealId,
        convertedAt: new Date(),
      },
    });

    return {
      companyId: company.id,
      contactId,
      dealId,
      reusedCompany: Boolean(existingCompany),
      reusedContact,
      movedMessages: moved.count,
    };
  });

  /* ── Chronik: der Übergang selbst ist ein Ereignis ───────────────────── */
  await createActivity(ctx, {
    type: "NOTE",
    subject: "Aus der Akquise übernommen",
    body: [
      `Quelle: ${prospect.sourceKey}`,
      prospect.firstContactedAt ? `Erstkontakt: ${prospect.firstContactedAt.toLocaleDateString("de-DE")}` : null,
      prospect.repliedAt ? `Antwort: ${prospect.repliedAt.toLocaleDateString("de-DE")}` : null,
      result.movedMessages > 0 ? `${result.movedMessages} Nachricht(en) aus dem Outreach übernommen.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    contactId: result.contactId ?? undefined,
    companyId: result.companyId,
    dealId: result.dealId ?? undefined,
  });

  await writeAudit(ctx, {
    action: "prospect.converted",
    entityType: "Prospect",
    entityId: prospect.id,
    before: { stage: prospect.stage },
    after: {
      contactId: result.contactId,
      companyId: result.companyId,
      dealId: result.dealId,
      reusedCompany: result.reusedCompany,
      reusedContact: result.reusedContact,
    },
  });

  await emitDomainEvent(ctx, {
    name: "prospect.converted",
    entityType: "PROSPECT",
    entityId: prospect.id,
    payload: {
      companyId: result.companyId,
      contactId: result.contactId,
      dealId: result.dealId,
      sourceKey: prospect.sourceKey,
    },
  });

  return { prospectId: prospect.id, ...result };
}

/** Nur zur Vorschau: Was würde die Übernahme tun? */
export async function previewConversion(ctx: ActorContext, prospectId: string) {
  assertPermission(ctx, "prospects.read");
  const prospect = assertFound(
    await prisma.prospect.findFirst({ where: { id: prospectId, ...scope(ctx), deletedAt: null } }),
    "Der Prospect wurde nicht gefunden.",
  );

  const domain = prospect.domain ?? domainOf(prospect.email);
  const [company, contact, messages, pipeline] = await Promise.all([
    domain
      ? prisma.company.findFirst({ where: { ...scope(ctx), deletedAt: null, domain }, select: { id: true, name: true } })
      : null,
    prospect.email
      ? prisma.contact.findFirst({
          where: { ...scope(ctx), deletedAt: null, email: prospect.email },
          select: { id: true, firstName: true, lastName: true },
        })
      : null,
    prisma.emailMessage.count({ where: { ...scope(ctx), prospectId: prospect.id } }),
    getDefaultPipeline(ctx),
  ]);

  return {
    alreadyConverted: Boolean(prospect.convertedAt),
    blocked: prospect.stage === "DO_NOT_CONTACT",
    existingCompany: company,
    existingContact: contact,
    messageCount: messages,
    hasPipeline: Boolean(pipeline && pipeline.stages.length > 0),
    willCreateContact: !contact && Boolean(prospect.email || prospect.lastName),
  };
}

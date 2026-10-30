import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope } from "@/lib/tenant";
import { createTask } from "@/server/services/tasks";
import { updateContact } from "@/server/services/contacts";
import { createSuggestion, listPendingSuggestions } from "@/server/services/suggestions";
import { recordReply } from "@/server/services/acquisition/replies";
import { notFound, validationFailed } from "./errors";
import { isoDateTime, linkUrl, occurredAt } from "./schemas";
import { appUrl, contactUrl, leadUrl, loadMailwinContact, MAILWIN_SOURCE, splitName, withLock } from "./service";

/**
 * Mailwin Connect API v1.2 — Kontext und Handlungen jenseits von Anlegen und
 * Protokollieren: Lead-Kontext für Antwortentwürfe, Aufgaben, Vorschläge zu
 * Kontaktdaten und die Einstufung von Antworten auf Akquise-Sequenzen.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : undefined));

/* ── GET /leads/{id} ──────────────────────────────────────────────────── */

/** Alles, was Mailwin für einen passenden Antwortentwurf wissen sollte. */
export async function getLeadContext(ctx: ActorContext, id: string) {
  assertPermission(ctx, "deals.read");
  const deal = await prisma.deal.findFirst({
    where: { id, ...liveScope(ctx) },
    include: {
      stage: { select: { id: true, name: true, type: true } },
      pipeline: { select: { id: true, name: true } },
      owner: { select: { name: true, email: true } },
      company: { select: { id: true, name: true, domain: true } },
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { isPrimary: true, contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, mobile: true } } },
      },
    },
  });
  if (!deal) throw notFound("Der Lead wurde nicht gefunden.");

  const [tasks, activities, suggestions] = await Promise.all([
    prisma.task.findMany({
      where: { ...scope(ctx), dealId: deal.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 10,
      select: { id: true, title: true, dueAt: true, priority: true },
    }),
    prisma.activity.findMany({
      where: { ...scope(ctx), dealId: deal.id, type: { not: "SYSTEM" } },
      orderBy: { occurredAt: "desc" },
      take: 5,
      select: { id: true, type: true, direction: true, subject: true, body: true, occurredAt: true, source: true },
    }),
    listPendingSuggestions(ctx, { dealId: deal.id }),
  ]);

  return {
    id: deal.id,
    title: deal.name,
    url: leadUrl(deal.id),
    status: deal.status.toLowerCase(),
    description: deal.description,
    pipeline: deal.pipeline,
    stage: { id: deal.stage.id, name: deal.stage.name, type: deal.stage.type.toLowerCase() },
    valueCents: Math.round(Number(deal.amount) * 100),
    currency: deal.currency,
    expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
    owner: deal.owner,
    company: deal.company,
    contacts: deal.contacts.map(({ contact, isPrimary }) => ({
      id: contact.id,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email,
      phone: contact.phone ?? contact.mobile ?? null,
      isPrimary,
      url: contactUrl(contact.id),
    })),
    operationalState: deal.operationalState.toLowerCase(),
    nextAction: deal.nextActionTitle
      ? { type: deal.nextActionType?.toLowerCase() ?? null, title: deal.nextActionTitle, dueAt: deal.nextActionAt?.toISOString() ?? null }
      : null,
    offerSentAt: deal.offerSentAt?.toISOString() ?? null,
    lastCustomerResponseAt: deal.lastCustomerResponseAt?.toISOString() ?? null,
    lastOutboundAt: deal.lastOutboundAt?.toISOString() ?? null,
    nextMeetingAt: deal.nextMeetingAt?.toISOString() ?? null,
    automationPausedUntil: deal.automationPausedUntil?.toISOString() ?? null,
    openTasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt?.toISOString() ?? null,
      priority: task.priority.toLowerCase(),
    })),
    recentActivities: activities.map((activity) => ({
      id: activity.id,
      type: activity.type.toLowerCase(),
      direction: activity.direction?.toLowerCase() ?? null,
      subject: activity.subject,
      summary: activity.body ? activity.body.slice(0, 500) : null,
      occurredAt: activity.occurredAt.toISOString(),
      viaMailwin: activity.source === "MAILWIN",
    })),
    pendingSuggestions: suggestions.map((suggestion) => ({ id: suggestion.id, kind: suggestion.kind, title: suggestion.title })),
    sourceRef: deal.sourceRef ?? null,
  };
}

/* ── POST /tasks ──────────────────────────────────────────────────────── */

export const taskCreateSchema = z
  .object({
    title: z.string({ error: "title ist erforderlich." }).trim().min(1, "title darf nicht leer sein.").max(200),
    description: optionalText(5000),
    dueAt: isoDateTime.optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    contactId: optionalText(30),
    leadId: optionalText(30),
    url: linkUrl.optional(),
    /** Mailwins Kennung, z. B. `task:<messageId>`. Dieselbe Kennung legt nie eine zweite Aufgabe an. */
    externalId: optionalText(200),
  })
  .refine((value) => Boolean(value.contactId || value.leadId), {
    message: "contactId oder leadId ist erforderlich.",
    path: ["contactId"],
  });

/**
 * „Bitte rufen Sie mich am Dienstag an“ → eine Aufgabe für die Person, die den
 * Lead (oder Kontakt) betreut. Mit `externalId` idempotent auf Dauer (nicht
 * nur 24 Stunden wie `Idempotency-Key`): Die vorhandene Aufgabe kommt zurück.
 */
export async function createMailwinTask(
  ctx: ActorContext,
  input: z.infer<typeof taskCreateSchema>,
): Promise<{ id: string; url: string; duplicate: boolean }> {
  assertPermission(ctx, "tasks.write");
  if (!input.externalId) return { ...(await insertMailwinTask(ctx, input)), duplicate: false };
  const externalId = input.externalId;
  return withLock(`mailwin:task:${ctx.organizationId}:${externalId}`, async () => {
    const existing = await prisma.task.findUnique({
      where: {
        organizationId_externalSource_externalId: { organizationId: ctx.organizationId, externalSource: MAILWIN_SOURCE, externalId },
      },
      select: { id: true, dealId: true, contactId: true },
    });
    if (existing) {
      const url = existing.dealId ? leadUrl(existing.dealId) : existing.contactId ? contactUrl(existing.contactId) : appUrl();
      return { id: existing.id, url, duplicate: true };
    }
    const created = await insertMailwinTask(ctx, input);
    await prisma.task.update({ where: { id: created.id }, data: { externalSource: MAILWIN_SOURCE, externalId } });
    return { ...created, duplicate: false };
  });
}

async function insertMailwinTask(ctx: ActorContext, input: z.infer<typeof taskCreateSchema>) {
  const deal = input.leadId
    ? await prisma.deal.findFirst({ where: { id: input.leadId, ...liveScope(ctx) }, select: { id: true, ownerId: true, companyId: true } })
    : null;
  if (input.leadId && !deal) throw notFound("Der Lead wurde nicht gefunden.");
  const contact = input.contactId
    ? await prisma.contact.findFirst({ where: { id: input.contactId, ...liveScope(ctx) }, select: { id: true, ownerId: true, companyId: true } })
    : null;
  if (input.contactId && !contact) throw notFound("Der Kontakt wurde nicht gefunden.");

  const description = [input.description, input.url ? `In Mailwin öffnen: ${input.url}` : null].filter(Boolean).join("\n\n");
  const task = await createTask(ctx, {
    title: input.title,
    description: description || undefined,
    dueAt: input.dueAt,
    priority: input.priority.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    ownerId: deal?.ownerId ?? contact?.ownerId ?? undefined,
    dealId: deal?.id,
    contactId: contact?.id,
    companyId: contact?.companyId ?? deal?.companyId ?? undefined,
  });
  return { id: task.id, url: deal ? leadUrl(deal.id) : contactUrl(contact!.id) };
}

/* ── POST /contacts/{id}/suggestions ──────────────────────────────────── */

export const contactSuggestionSchema = z.object({
  fields: z
    .object({
      name: optionalText(160),
      phone: optionalText(40),
      mobile: optionalText(40),
      jobTitle: optionalText(120),
      linkedinUrl: linkUrl.optional(),
      street: optionalText(200),
      postalCode: optionalText(20),
      city: optionalText(120),
      country: optionalText(80),
    })
    .refine((value) => Object.values(value).some(Boolean), "Mindestens ein Feld angeben."),
  evidence: z
    .object({ quote: optionalText(300), confidence: z.number().min(0).max(1).optional() })
    .optional(),
  url: linkUrl.optional(),
  /** Optional, z. B. `signature:<messageId>` — kommt in `signal.proposal_resolved` zurück. */
  externalId: optionalText(200),
});

/**
 * Kontaktdaten aus einer Signatur. Leere Felder werden direkt gefüllt; wo im
 * CRM schon etwas anderes steht, entsteht ein Vorschlag zur Übernahme — nie
 * ein stilles Überschreiben.
 */
export async function suggestContactChanges(
  ctx: ActorContext,
  contactId: string,
  input: z.infer<typeof contactSuggestionSchema>,
) {
  assertPermission(ctx, "contacts.write");
  return withLock(`mailwin:contact-id:${ctx.organizationId}:${contactId}`, async () => {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, ...liveScope(ctx) } });
    if (!contact) throw notFound("Der Kontakt wurde nicht gefunden.");

    const proposed: Record<string, string> = {};
    if (input.fields.name) {
      const parts = splitName(input.fields.name, contact.email ?? "");
      if (`${parts.firstName} ${parts.lastName}` !== `${contact.firstName} ${contact.lastName}`) {
        proposed.firstName = parts.firstName;
        proposed.lastName = parts.lastName;
      }
    }
    for (const key of ["phone", "mobile", "jobTitle", "linkedinUrl", "street", "postalCode", "city", "country"] as const) {
      const value = input.fields[key];
      if (value && value !== contact[key]) proposed[key] = value;
    }

    const fill: Record<string, string> = {};
    const suggest: Record<string, string> = {};
    const placeholderName = contact.firstName === "Unbekannt" || contact.lastName === "Unbekannt";
    for (const [key, value] of Object.entries(proposed)) {
      const current = (contact as unknown as Record<string, unknown>)[key];
      const empty = current === null || current === undefined || current === "";
      const nameIsPlaceholder = (key === "firstName" || key === "lastName") && placeholderName;
      if (empty || nameIsPlaceholder) fill[key] = value;
      else suggest[key] = value;
    }

    if (Object.keys(fill).length > 0) await updateContact(ctx, contact.id, fill);

    let suggestion: { id: string } | null = null;
    if (Object.keys(suggest).length > 0) {
      // Derselbe offene Vorschlag wird nicht ein zweites Mal angelegt.
      const pending = await prisma.recordSuggestion.findMany({
        where: { ...scope(ctx), contactId: contact.id, kind: "contact.update", status: "PENDING" },
        select: { id: true, payload: true },
      });
      const same = pending.find(
        (row) => JSON.stringify((row.payload as { fields?: unknown } | null)?.fields ?? {}) === JSON.stringify(suggest),
      );
      suggestion =
        same ??
        (await createSuggestion(ctx, {
          source: MAILWIN_SOURCE,
          kind: "contact.update",
          contactId: contact.id,
          title: "Kontaktdaten aktualisieren?",
          reason: `Mailwin hat neue Angaben gefunden: ${describe(suggest)}.`,
          payload: { fields: suggest, previous: Object.fromEntries(Object.keys(suggest).map((key) => [key, (contact as unknown as Record<string, unknown>)[key] ?? null])) },
          evidence: {
            quote: input.evidence?.quote,
            confidence: input.evidence?.confidence,
            url: input.url,
            signal: "contact_details",
            externalId: input.externalId,
          },
        }));
    }

    return {
      applied: Object.keys(fill),
      proposed: suggestion ? { id: suggestion.id, fields: Object.keys(suggest) } : null,
      contact: await loadMailwinContact(ctx, contact.id),
    };
  });
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "Vorname",
  lastName: "Nachname",
  phone: "Telefon",
  mobile: "Mobil",
  jobTitle: "Position",
  linkedinUrl: "LinkedIn",
  street: "Straße",
  postalCode: "PLZ",
  city: "Ort",
  country: "Land",
};

function describe(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${FIELD_LABELS[key] ?? key} „${value}“`)
    .join(", ");
}

/* ── POST /outreach/replies ───────────────────────────────────────────── */

const REPLY_CLASSES = [
  "interested", "question", "meeting_request", "later", "referral",
  "not_interested", "out_of_office", "unsubscribe", "unknown",
] as const;

export const outreachReplySchema = z.object({
  messageId: z.string({ error: "messageId ist erforderlich." }).trim().min(1).max(200),
  fromAddress: z.string({ error: "fromAddress ist erforderlich." }).trim().toLowerCase().email("Bitte eine gültige E-Mail-Adresse angeben.").max(254),
  prospectId: optionalText(30),
  subject: z.string().trim().max(500).default(""),
  body: z.string({ error: "body ist erforderlich." }).max(100_000),
  receivedAt: occurredAt,
  classification: z.enum(REPLY_CLASSES, { error: `classification muss einer der folgenden Werte sein: ${REPLY_CLASSES.join(", ")}.` }),
  confidence: z.number().min(0).max(1),
  /** RFC-Message-ID, auf die geantwortet wurde (Header `In-Reply-To`). */
  inReplyTo: optionalText(500),
  /** Header `References`: Liste oder ein durch Leerzeichen getrennter Text. */
  references: z
    .union([z.array(z.string().max(500)).max(100), z.string().max(20_000)])
    .optional()
    .transform((value) => (typeof value === "string" ? value.split(/\s+/) : (value ?? [])).filter(Boolean)),
});

/** `<abc@host>` und `abc@host` sind dieselbe Message-ID. */
function bareMessageId(value: string): string {
  return value.trim().replace(/^<|>$/g, "");
}

/**
 * Sucht die versendete Sequenz-Mail, auf die geantwortet wurde — zuerst über
 * `In-Reply-To`, dann über `References` von hinten (die jüngste zuerst).
 */
async function findRepliedSequenceMail(ctx: ActorContext, inReplyTo: string | undefined, references: string[]) {
  const ordered = [inReplyTo, ...references.slice().reverse()].filter((id): id is string => Boolean(id)).map(bareMessageId);
  const ids = Array.from(new Set(ordered)).filter(Boolean).slice(0, 50);
  if (ids.length === 0) return null;
  const candidates = await prisma.emailMessage.findMany({
    where: {
      ...scope(ctx),
      direction: "OUTBOUND",
      prospectId: { not: null },
      providerMessageId: { in: ids.flatMap((id) => [id, `<${id}>`]) },
    },
    select: { providerMessageId: true, prospectId: true, enrollmentId: true },
  });
  for (const id of ids) {
    const hit = candidates.find((row) => row.providerMessageId && bareMessageId(row.providerMessageId) === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Mailwin stuft eine Antwort auf eine Akquise-Sequenz ein; das CRM zieht die
 * Folgen (Sequenz anhalten, Prospect umstufen, Abmeldung sperren) — dieselben
 * wie bei seiner eigenen Einstufung, die damit ersetzt wird.
 */
export async function recordMailwinReply(ctx: ActorContext, input: z.infer<typeof outreachReplySchema>) {
  assertPermission(ctx, "outreach.replies");
  return withLock(`mailwin:reply:${ctx.organizationId}:${input.messageId}`, async () => {
    const existing = await prisma.emailMessage.findFirst({
      where: { ...scope(ctx), providerMessageId: input.messageId, direction: "INBOUND" },
      select: { id: true, prospectId: true, replyClassification: true },
    });
    if (existing) {
      return {
        messageId: existing.id,
        prospectId: existing.prospectId,
        classification: (existing.replyClassification ?? "UNKNOWN").toLowerCase(),
        duplicate: true,
      };
    }

    // Zuordnung: ausdrückliche prospectId, sonst die Message-IDs der Antwort
    // (genau die Sequenz-Mail), sonst die Absenderadresse.
    const replied = await findRepliedSequenceMail(ctx, input.inReplyTo, input.references);
    let matchedBy: "prospect_id" | "message_id" | "from_address" = "from_address";
    let prospect: { id: string } | null = null;
    if (input.prospectId) {
      prospect = await prisma.prospect.findFirst({ where: { id: input.prospectId, ...scope(ctx), deletedAt: null }, select: { id: true } });
      matchedBy = "prospect_id";
    } else if (replied?.prospectId) {
      prospect = await prisma.prospect.findFirst({ where: { id: replied.prospectId, ...scope(ctx), deletedAt: null }, select: { id: true } });
      if (prospect) matchedBy = "message_id";
    }
    if (!prospect && !input.prospectId) {
      prospect = await prisma.prospect.findFirst({ where: { ...scope(ctx), deletedAt: null, email: input.fromAddress }, select: { id: true } });
      matchedBy = "from_address";
    }
    if (!prospect) {
      throw input.prospectId
        ? notFound("Der Prospect wurde nicht gefunden.")
        : validationFailed("Zu dieser Absenderadresse gibt es keinen Prospect.", { fromAddress: "Kein Prospect mit dieser Adresse." });
    }

    const enrollmentId = replied?.prospectId === prospect.id ? (replied.enrollmentId ?? undefined) : undefined;
    const result = await recordReply(ctx, {
      enrollmentId,
      prospectId: prospect.id,
      fromAddress: input.fromAddress,
      subject: input.subject,
      body: input.body,
      receivedAt: input.receivedAt,
      providerMessageId: input.messageId,
      judged: {
        classification: input.classification.toUpperCase() as "UNKNOWN",
        confidence: input.confidence * 100,
      },
    });
    return {
      messageId: result.messageId,
      prospectId: result.prospectId,
      classification: result.classification.toLowerCase(),
      duplicate: false,
      matchedBy,
    };
  });
}

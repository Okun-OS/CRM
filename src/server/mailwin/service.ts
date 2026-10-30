import "server-only";
import type { ActivityDirection, ActivityType, CrmEventType } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope } from "@/lib/tenant";
import { createContact, updateContact } from "@/server/services/contacts";
import { createCompany, normaliseDomain } from "@/server/services/companies";
import { createDeal } from "@/server/services/deals";
import { notFound, validationFailed } from "./errors";
import type { ActivityCreateInput, ContactUpsertInput, LeadCreateInput } from "./schemas";

/**
 * Mailwin Connect API v1 — die Fachlogik.
 *
 * Zuordnung zum Datenmodell des CRM (ausführlich in docs/MAILWIN.md):
 *
 *   Mailwin            CRM
 *   ─────────────────  ────────────────────────────────────────────────
 *   workspace          Organization
 *   contact            Contact (Name → firstName/lastName)
 *   company            Company
 *   lead               Deal (Pipeline, Phase, Wert, gewonnen/verloren)
 *   pipeline / stage   Pipeline / PipelineStage (order = Position)
 *   activity           Activity (email → EMAIL, whatsapp → WHATSAPP, note → NOTE)
 *
 * Alles läuft über die bestehenden Services: Audit-Log, Zeitleiste,
 * Workflows, Webhooks und das aktive CRM reagieren auf Mailwin genauso wie auf
 * eine Eingabe in der Oberfläche.
 */
export const MAILWIN_SOURCE = "mailwin";
const PLACEHOLDER = "Unbekannt";

/**
 * Domains großer E-Mail-Anbieter. Eine Adresse bei gmail.com sagt nichts über
 * eine Firma — daraus wird weder eine Firma angelegt noch eine zugeordnet.
 */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de",
  "msn.com", "yahoo.com", "yahoo.de", "icloud.com", "me.com", "mac.com", "aol.com", "aol.de", "gmx.de", "gmx.net",
  "gmx.at", "gmx.ch", "web.de", "t-online.de", "freenet.de", "posteo.de", "posteo.net", "mail.de", "mailbox.org",
  "protonmail.com", "proton.me", "arcor.de", "vodafone.de", "online.de", "1und1.de", "bluewin.ch", "yandex.com",
]);

/** Allgemeine Postfächer: Der lokale Teil ist kein Name. */
const ROLE_MAILBOXES = new Set([
  "info", "kontakt", "contact", "office", "mail", "hello", "hallo", "support", "service", "sales", "vertrieb",
  "team", "noreply", "no-reply", "admin", "buchhaltung", "rechnung", "invoice", "post", "anfrage", "anfragen",
]);

/* ── Links in die Oberfläche ──────────────────────────────────────────── */

export function appUrl(): string {
  return env().APP_URL.replace(/\/+$/, "");
}

export const contactUrl = (id: string) => `${appUrl()}/contacts/${id}`;
export const leadUrl = (id: string) => `${appUrl()}/deals/${id}`;

/* ── Ausgabeformate ───────────────────────────────────────────────────── */

export type MailwinContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: { id: string; name: string; domain: string | null } | null;
  openLeads: { id: string; title: string; stage: string; stageId: string; pipelineId: string; url: string }[];
  url: string;
};

const contactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  mobile: true,
  source: true,
  companyId: true,
  ownerId: true,
  company: { select: { id: true, name: true, domain: true, deletedAt: true } },
  dealContacts: {
    where: { deal: { status: "OPEN" as const, deletedAt: null } },
    orderBy: { createdAt: "asc" as const },
    take: 25,
    select: {
      deal: {
        select: { id: true, name: true, pipelineId: true, stage: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.ContactSelect;

type ContactRow = Prisma.ContactGetPayload<{ select: typeof contactSelect }>;

export function toMailwinContact(row: ContactRow): MailwinContact {
  const company = row.company && !row.company.deletedAt ? row.company : null;
  return {
    id: row.id,
    name: `${row.firstName} ${row.lastName}`.trim(),
    email: row.email,
    phone: row.phone ?? row.mobile ?? null,
    company: company ? { id: company.id, name: company.name, domain: company.domain } : null,
    openLeads: row.dealContacts.map(({ deal }) => ({
      id: deal.id,
      title: deal.name,
      stage: deal.stage.name,
      stageId: deal.stage.id,
      pipelineId: deal.pipelineId,
      url: leadUrl(deal.id),
    })),
    url: contactUrl(row.id),
  };
}

export async function loadMailwinContact(ctx: ActorContext, id: string): Promise<MailwinContact> {
  const row = await prisma.contact.findFirst({ where: { id, ...liveScope(ctx) }, select: contactSelect });
  if (!row) throw notFound("Der Kontakt wurde nicht gefunden.");
  return toMailwinContact(row);
}

/* ── GET /me ──────────────────────────────────────────────────────────── */

export async function getWorkspace(ctx: ActorContext) {
  return { workspaceId: ctx.organizationId, name: ctx.organizationName, appUrl: appUrl() };
}

/* ── GET /contacts?email= ─────────────────────────────────────────────── */

export async function findContactsByEmail(ctx: ActorContext, email: string): Promise<MailwinContact[]> {
  assertPermission(ctx, "contacts.read");
  const rows = await prisma.contact.findMany({
    where: { ...liveScope(ctx), email: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: contactSelect,
  });
  return rows.map(toMailwinContact);
}

/* ── POST /contacts ───────────────────────────────────────────────────── */

/**
 * Legt an oder ergänzt — Abgleich über die E-Mail-Adresse.
 *
 * Gibt es mehrere Kontakte mit derselben Adresse, gilt der älteste. Ein
 * bestehender Kontakt wird nur *ergänzt*: Mailwin füllt leere Felder (Telefon,
 * Firma) und ersetzt einen Platzhalternamen, überschreibt aber nie, was
 * jemand im CRM gepflegt hat. Das CRM bleibt die Quelle der Wahrheit.
 *
 * Gleichzeitige Aufrufe für dieselbe Adresse werden hintereinander
 * ausgeführt, damit kein Kontakt doppelt entsteht.
 */
export async function upsertContact(
  ctx: ActorContext,
  input: ContactUpsertInput,
): Promise<{ contact: MailwinContact; created: boolean }> {
  assertPermission(ctx, "contacts.write");

  return withLock(`mailwin:contact:${ctx.organizationId}:${input.email}`, async () => {
    const existing = await prisma.contact.findFirst({
      where: { ...liveScope(ctx), email: { equals: input.email, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
      select: contactSelect,
    });

    if (existing) {
      const patch: Record<string, string> = {};

      if (input.name && existing.source === MAILWIN_SOURCE && isPlaceholderName(existing)) {
        const parts = splitName(input.name, input.email);
        if (`${parts.firstName} ${parts.lastName}` !== `${existing.firstName} ${existing.lastName}`) {
          patch.firstName = parts.firstName;
          patch.lastName = parts.lastName;
        }
      }
      if (input.phone && !existing.phone && !existing.mobile) patch.phone = input.phone;
      if (!existing.companyId && (input.companyName || input.companyDomain)) {
        const companyId = await resolveCompany(ctx, input.companyName, input.companyDomain);
        if (companyId) patch.companyId = companyId;
      }

      if (Object.keys(patch).length > 0) await updateContact(ctx, existing.id, patch);
      return { contact: await loadMailwinContact(ctx, existing.id), created: false };
    }

    const companyId = await resolveCompany(ctx, input.companyName, input.companyDomain);
    const { firstName, lastName } = splitName(input.name, input.email);
    const created = await createContact(
      ctx,
      { firstName, lastName, email: input.email, phone: input.phone, companyId, source: MAILWIN_SOURCE },
      { skipRequiredProperties: true },
    );
    return { contact: await loadMailwinContact(ctx, created.id), created: true };
  });
}

/**
 * Firma über Domain, sonst über den Namen (Groß-/Kleinschreibung egal), sonst
 * neu. Freemail-Domains zählen nicht.
 */
async function resolveCompany(
  ctx: ActorContext,
  name: string | undefined,
  rawDomain: string | undefined,
): Promise<string | undefined> {
  const normalised = normaliseDomain(rawDomain);
  const domain = normalised && !FREEMAIL_DOMAINS.has(normalised) ? normalised : undefined;
  if (!domain && !name) return undefined;

  return withLock(`mailwin:company:${ctx.organizationId}:${(domain ?? name ?? "").toLowerCase()}`, async () => {
    if (domain) {
      const byDomain = await prisma.company.findFirst({
        where: { ...liveScope(ctx), domain: { equals: domain, mode: "insensitive" } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (byDomain) return byDomain.id;
    }
    if (name) {
      const byName = await prisma.company.findFirst({
        where: { ...liveScope(ctx), name: { equals: name, mode: "insensitive" } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (byName) return byName.id;
    }

    assertPermission(ctx, "companies.write");
    const company = await createCompany(
      ctx,
      { name: name ?? domain!, domain, source: MAILWIN_SOURCE },
      { skipRequiredProperties: true },
    );
    return company.id;
  });
}

/**
 * „Max Mustermann“ → Max / Mustermann, „Mustermann, Max“ → Max / Mustermann.
 * Ohne Namen wird er aus der Adresse abgeleitet (max.mustermann@…). Was sich
 * nicht ableiten lässt, heißt „Unbekannt“ — wie an anderen Stellen im CRM — und
 * wird ersetzt, sobald Mailwin einen echten Namen kennt.
 */
export function splitName(name: string | undefined, email: string): { firstName: string; lastName: string } {
  const cleaned = (name ?? "").replace(/["'<>]/g, " ").replace(/\s+/g, " ").trim();

  if (cleaned && !cleaned.includes("@")) {
    let tokens: string[];
    if (cleaned.includes(",")) {
      const [last, first] = cleaned.split(",", 2).map((part) => part.trim());
      tokens = [...(first ? first.split(" ") : []), ...(last ? [last] : [])];
    } else {
      tokens = cleaned.split(" ");
    }
    tokens = tokens.filter(Boolean);
    if (tokens.length >= 2) {
      return { firstName: clip(tokens.slice(0, -1).join(" ")), lastName: clip(tokens[tokens.length - 1]) };
    }
    if (tokens.length === 1) return { firstName: clip(tokens[0]), lastName: PLACEHOLDER };
  }

  const local = email.split("@")[0] ?? "";
  const parts = local
    .split(/[._\-+]+/)
    .filter((part) => /^[\p{L}]{2,}$/u.test(part))
    .map(capitalise);
  if (!ROLE_MAILBOXES.has(local.toLowerCase())) {
    if (parts.length >= 2) return { firstName: clip(parts.slice(0, -1).join(" ")), lastName: clip(parts[parts.length - 1]) };
    if (parts.length === 1) return { firstName: clip(parts[0]), lastName: PLACEHOLDER };
  }
  return { firstName: PLACEHOLDER, lastName: clip(email) };
}

function isPlaceholderName(contact: { firstName: string; lastName: string; email: string | null }): boolean {
  if (contact.firstName === PLACEHOLDER || contact.lastName === PLACEHOLDER) return true;
  if (!contact.email) return false;
  const derived = splitName(undefined, contact.email);
  return derived.firstName === contact.firstName && derived.lastName === contact.lastName;
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
const clip = (value: string) => value.slice(0, 80);

/* ── GET /pipelines ───────────────────────────────────────────────────── */

export async function listMailwinPipelines(ctx: ActorContext) {
  assertPermission(ctx, "deals.read");
  const pipelines = await prisma.pipeline.findMany({
    where: { ...scope(ctx), isArchived: false },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    include: { stages: { orderBy: { position: "asc" } } },
  });
  return pipelines.map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.isDefault,
    stages: pipeline.stages.map((stage, index) => ({
      id: stage.id,
      name: stage.name,
      order: index,
      type: stage.type.toLowerCase() as "open" | "won" | "lost",
    })),
  }));
}

/* ── POST /leads ──────────────────────────────────────────────────────── */

/**
 * Ein Mailwin-Lead ist im CRM ein Deal: Er hat Pipeline, Phase und Wert und
 * endet gewonnen oder verloren. Fehlende Kontakte (und Firmen) werden
 * angelegt; der Ursprung (`sourceRef`) bleibt am Deal und erscheint dort als
 * „In Mailwin öffnen“.
 */
export async function createLead(ctx: ActorContext, input: LeadCreateInput): Promise<{ id: string; url: string }> {
  assertPermission(ctx, "deals.write");

  const { pipelineId, stageId } = await resolvePipelineStage(ctx, input.pipelineId, input.stageId);

  const { contact } = await upsertContact(ctx, {
    email: input.contact.email,
    name: input.contact.name,
    companyName: input.companyName,
    phone: undefined,
    companyDomain: undefined,
  });
  const owner = await prisma.contact.findFirst({ where: { id: contact.id, ...scope(ctx) }, select: { ownerId: true } });
  const organization = await prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { currency: true } });

  const deal = await createDeal(
    ctx,
    {
      name: input.title,
      description: input.description || undefined,
      pipelineId,
      stageId,
      amount: (input.valueCents ?? 0) / 100,
      currency: organization?.currency ?? "EUR",
      companyId: contact.company?.id,
      contactIds: [contact.id],
      ownerId: owner?.ownerId ?? undefined,
      source: MAILWIN_SOURCE,
    },
    { skipRequiredProperties: true },
  );

  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      sourceRef: {
        system: MAILWIN_SOURCE,
        channel: input.sourceRef.channel,
        threadId: input.sourceRef.threadId,
        messageId: input.sourceRef.messageId,
        url: input.sourceRef.url,
      },
    },
  });

  return { id: deal.id, url: leadUrl(deal.id) };
}

async function resolvePipelineStage(
  ctx: ActorContext,
  pipelineId: string | undefined,
  stageId: string | undefined,
): Promise<{ pipelineId: string; stageId: string }> {
  if (stageId) {
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, ...scope(ctx) },
      include: { pipeline: { select: { id: true, isArchived: true } } },
    });
    if (!stage) throw validationFailed("Die Phase wurde nicht gefunden.", { stageId: "Unbekannte Phase." });
    if (pipelineId && stage.pipelineId !== pipelineId) {
      throw validationFailed("Die Phase gehört nicht zu dieser Pipeline.", { stageId: "Gehört nicht zur Pipeline." });
    }
    if (stage.pipeline.isArchived) {
      throw validationFailed("Die Pipeline ist archiviert.", { pipelineId: "Archivierte Pipeline." });
    }
    return { pipelineId: stage.pipelineId, stageId: stage.id };
  }

  const pipeline = pipelineId
    ? await prisma.pipeline.findFirst({ where: { id: pipelineId, ...scope(ctx), isArchived: false } })
    : await prisma.pipeline.findFirst({
        where: { ...scope(ctx), isArchived: false },
        orderBy: [{ isDefault: "desc" }, { position: "asc" }],
      });
  if (!pipeline) {
    throw pipelineId
      ? validationFailed("Die Pipeline wurde nicht gefunden.", { pipelineId: "Unbekannte oder archivierte Pipeline." })
      : validationFailed("Der Arbeitsbereich hat keine aktive Pipeline.", { pipelineId: "Keine Pipeline vorhanden." });
  }

  const first = await prisma.pipelineStage.findFirst({
    where: { pipelineId: pipeline.id, ...scope(ctx), type: "OPEN" },
    orderBy: { position: "asc" },
  });
  if (!first) throw validationFailed("Die Pipeline hat keine offene Phase.", { pipelineId: "Keine offene Phase." });
  return { pipelineId: pipeline.id, stageId: first.id };
}

/* ── POST /activities ─────────────────────────────────────────────────── */

const ACTIVITY_TYPE: Record<ActivityCreateInput["type"], ActivityType> = {
  email: "EMAIL",
  whatsapp: "WHATSAPP",
  note: "NOTE",
};

/**
 * Protokolliert eine Nachricht in der Zeitleiste von Kontakt und/oder Lead.
 * `externalId` ist eindeutig je Arbeitsbereich: Dieselbe Nachricht erscheint
 * nie zweimal, auch wenn Mailwin sie mehrfach meldet.
 */
export async function createMailwinActivity(
  ctx: ActorContext,
  input: ActivityCreateInput,
): Promise<{ id: string; created: boolean }> {
  assertPermission(ctx, "activities.write");

  const existing = await findActivityByExternalId(ctx, input.externalId);
  if (existing) return { id: existing, created: false };

  const contact = input.contactId
    ? await prisma.contact.findFirst({ where: { id: input.contactId, ...liveScope(ctx) }, select: { id: true, companyId: true } })
    : null;
  if (input.contactId && !contact) throw notFound("Der Kontakt wurde nicht gefunden.");

  const deal = input.leadId
    ? await prisma.deal.findFirst({ where: { id: input.leadId, ...liveScope(ctx) }, select: { id: true, companyId: true } })
    : null;
  if (input.leadId && !deal) throw notFound("Der Lead wurde nicht gefunden.");

  const links = {
    contactId: contact?.id ?? null,
    dealId: deal?.id ?? null,
    companyId: contact?.companyId ?? deal?.companyId ?? null,
  };
  const direction: ActivityDirection = input.direction === "inbound" ? "INBOUND" : "OUTBOUND";

  let id: string;
  try {
    const activity = await prisma.activity.create({
      data: {
        organizationId: ctx.organizationId,
        type: ACTIVITY_TYPE[input.type],
        source: "MAILWIN",
        subject: input.subject,
        body: input.summary,
        direction,
        occurredAt: input.occurredAt,
        // Keine Person: Die Nachricht hat Mailwin erfasst, nicht der Schlüsselinhaber.
        actorId: null,
        externalSource: MAILWIN_SOURCE,
        externalId: input.externalId,
        metadata: { source: MAILWIN_SOURCE, channel: input.type, url: input.url },
        ...links,
      },
      select: { id: true },
    });
    id = activity.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await findActivityByExternalId(ctx, input.externalId);
      if (raced) return { id: raced, created: false };
    }
    throw error;
  }

  await touchIfNewer(ctx, links, input.occurredAt);
  await reportToEngine(ctx, input, direction, links);
  return { id, created: true };
}

async function findActivityByExternalId(ctx: ActorContext, externalId: string): Promise<string | null> {
  const row = await prisma.activity.findUnique({
    where: {
      organizationId_externalSource_externalId: {
        organizationId: ctx.organizationId,
        externalSource: MAILWIN_SOURCE,
        externalId,
      },
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Mailwin meldet auch ältere Nachrichten nach. `lastActivityAt` darf dadurch
 * nicht zurückspringen — aktualisiert wird nur, wenn die Nachricht neuer ist.
 */
async function touchIfNewer(
  ctx: ActorContext,
  links: { contactId: string | null; dealId: string | null; companyId: string | null },
  occurredAt: Date,
): Promise<void> {
  const newer = { OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: occurredAt } }] };
  await Promise.all([
    links.contactId
      ? prisma.contact.updateMany({ where: { id: links.contactId, ...scope(ctx), ...newer }, data: { lastActivityAt: occurredAt } })
      : null,
    links.dealId
      ? prisma.deal.updateMany({ where: { id: links.dealId, ...scope(ctx), ...newer }, data: { lastActivityAt: occurredAt } })
      : null,
    links.companyId
      ? prisma.company.updateMany({ where: { id: links.companyId, ...scope(ctx), ...newer }, data: { lastActivityAt: occurredAt } })
      : null,
  ]);
}

/**
 * Das aktive CRM soll wissen, dass der Kunde geantwortet hat — egal ob per
 * E-Mail oder WhatsApp. Dieselbe Wirkung wie eine von Hand erfasste E-Mail:
 * Eine wartende Nachfass-Automation wird gestoppt.
 */
async function reportToEngine(
  ctx: ActorContext,
  input: ActivityCreateInput,
  direction: ActivityDirection,
  links: { contactId: string | null; dealId: string | null; companyId: string | null },
): Promise<void> {
  if (!links.dealId || input.type === "note") return;
  const type: CrmEventType =
    direction === "INBOUND" ? (input.type === "email" ? "EMAIL_RECEIVED" : "CUSTOMER_REPLIED") : "EMAIL_SENT";

  const { recordEvent } = await import("@/server/engine/events");
  await recordEvent(ctx, {
    type,
    source: "INTEGRATION",
    occurredAt: input.occurredAt,
    idempotencyKey: `mailwin:activity:${input.externalId}`,
    suppressActivity: true,
    contactId: links.contactId,
    companyId: links.companyId,
    dealId: links.dealId,
    payload: { subject: input.subject ?? null, channel: input.type },
  });
}

/* ── Hilfen ───────────────────────────────────────────────────────────── */

/**
 * Serialisiert Arbeit über einen Schlüssel innerhalb dieses Prozesses.
 *
 * Bewusst keine Datenbanksperre: Eine Advisory-Lock-Transaktion hielte für die
 * ganze Dauer eine Verbindung aus dem Pool, und viele gleichzeitige Aufrufe
 * könnten den Pool damit selbst blockieren. Das CRM läuft als eine Instanz
 * (railway.json, numReplicas 1) — wie der Rate-Limiter. Bei mehreren
 * Instanzen gehört diese Sperre in einen gemeinsamen Speicher (siehe
 * docs/MAILWIN.md).
 */
const locks = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

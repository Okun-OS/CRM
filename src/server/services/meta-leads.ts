import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptSecret } from "@/lib/crypto";
import { logError, logInfo, logWarn } from "@/lib/logger";
import type { ActorContext } from "@/lib/context";
import { emailField } from "@/lib/schemas/crm";
import { contextForApiKey } from "./api-keys";
import { createLead } from "./leads";
import { createNote } from "./notes";
import { notify } from "./notifications";
import { fetchMetaFormName, fetchMetaLead, MetaApiError, type MetaLead } from "@/server/integrations/meta";
import { leadNotificationMail, type LeadNotificationInput } from "@/server/integrations/lead-notification-mail";

/**
 * Meta Lead Ads → CRM.
 *
 * Meta meldet per Webhook nur, *dass* jemand ein Formular abgeschickt hat
 * (`leadgen_id`). Die Angaben holt das CRM danach mit dem Seiten-Token ab.
 * Deshalb zwei Schritte:
 *
 * 1. `recordMetaWebhook` hält jede Meldung genau einmal fest (MetaLeadEvent,
 *    eindeutig je leadgen_id) und antwortet Meta sofort.
 * 2. `processMetaLeadEvent` holt den Lead ab, legt ihn an (oder hängt eine
 *    erneute Anfrage an den offenen Lead derselben Person), schreibt die
 *    Antworten als Notiz dazu und benachrichtigt — im CRM und per E-Mail.
 *    Scheitert das, versucht es der Zustell-Worker erneut.
 */

const MAX_ATTEMPTS = 8;
/** Abstände der Wiederholungen in Minuten — zusammen deutlich unter 36 Stunden. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360, 720];
/** Reservierung während der Verarbeitung, damit Webhook und Worker nicht doppelt arbeiten. */
const LEASE_MS = 2 * 60_000;
/** So lange gilt ein offener Lead derselben Person als „dieselbe Anfrage“. */
const MERGE_WINDOW_DAYS = 90;

/* ── 1. Webhook festhalten ─────────────────────────────────────────────── */

const webhookSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).optional(),
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const id = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : null);

/**
 * Nimmt eine Meldung von Meta entgegen. Unbekannte Seiten und Wiederholungen
 * werden still übergangen — Meta soll immer 200 bekommen, sonst stellt es
 * 36 Stunden lang erneut zu.
 */
export async function recordMetaWebhook(payload: unknown): Promise<{ recorded: string[]; ignored: number }> {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== "page") return { recorded: [], ignored: 0 };

  const recorded: string[] = [];
  let ignored = 0;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "leadgen" || !change.value) continue;
      const leadgenId = id(change.value.leadgen_id);
      const pageId = id(change.value.page_id) ?? id(entry.id);
      if (!leadgenId || !pageId) {
        ignored++;
        continue;
      }
      const page = await prisma.metaLeadPage.findUnique({ where: { pageId }, select: { organizationId: true, isActive: true } });
      if (!page || !page.isActive) {
        logWarn("meta.lead_for_unknown_page", { pageId, leadgenId });
        ignored++;
        continue;
      }
      try {
        const event = await prisma.metaLeadEvent.create({
          data: {
            organizationId: page.organizationId,
            pageId,
            leadgenId,
            formId: id(change.value.form_id),
            adId: id(change.value.ad_id),
          },
          select: { id: true },
        });
        recorded.push(event.id);
      } catch (error) {
        // Schon bekannt: Meta hat dieselbe Einsendung erneut gemeldet.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ignored++;
        else throw error;
      }
    }
  }
  return { recorded, ignored };
}

/* ── 2. Abholen und anlegen ────────────────────────────────────────────── */

/** Bekannte Meta-Fragen → Lead-Felder. Alles andere landet als Antwort in der Notiz. */
const STANDARD_FIELDS: Record<string, "fullName" | "firstName" | "lastName" | "email" | "phone" | "companyName" | "jobTitle"> = {
  full_name: "fullName",
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  work_email: "email",
  phone_number: "phone",
  work_phone_number: "phone",
  company_name: "companyName",
  job_title: "jobTitle",
};

const ANSWER_LABELS: Record<string, string> = {
  city: "Ort",
  zip_code: "PLZ",
  post_code: "PLZ",
  street_address: "Straße",
  country: "Land",
  state: "Bundesland",
  province: "Bundesland",
  date_of_birth: "Geburtsdatum",
  gender: "Geschlecht",
  military_status: "Militärstatus",
  marital_status: "Familienstand",
  relationship_status: "Beziehungsstatus",
  work_email: "Geschäftliche E-Mail",
  work_phone_number: "Geschäftliche Telefonnummer",
};

export type MappedMetaLead = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  answers: { label: string; value: string }[];
};

const MAX_LENGTH = { firstName: 80, lastName: 80, phone: 40, companyName: 160, jobTitle: 120 } as const;

function humanizeQuestion(key: string): string {
  const text = key.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

/** Ordnet `field_data` den Lead-Feldern zu; unbekannte Fragen werden zu Antworten. */
export function mapMetaFields(fieldData: MetaLead["field_data"]): MappedMetaLead {
  const result: MappedMetaLead = {
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    companyName: null,
    jobTitle: null,
    answers: [],
  };
  let fullName: string | null = null;

  for (const field of fieldData ?? []) {
    const value = (field.values ?? []).map((item) => String(item).trim()).filter(Boolean).join(", ");
    if (!value) continue;
    const target = STANDARD_FIELDS[field.name];
    if (target === "fullName") fullName = value;
    else if (target === "email") {
      const email = emailField.safeParse(value);
      if (email.success && !result.email) result.email = email.data;
      else result.answers.push({ label: ANSWER_LABELS[field.name] ?? "E-Mail", value });
    } else if (target && !result[target]) result[target] = value.slice(0, MAX_LENGTH[target]);
    else result.answers.push({ label: ANSWER_LABELS[field.name] ?? humanizeQuestion(field.name), value });
  }

  if (fullName && !result.firstName && !result.lastName) {
    const parts = fullName.split(/\s+/);
    result.lastName = parts.length > 1 ? parts.pop()!.slice(0, 80) : parts[0].slice(0, 80);
    result.firstName = parts.length > 0 && parts.join(" ") !== result.lastName ? parts.join(" ").slice(0, 80) : null;
  }
  return result;
}

function platformLabel(platform: string | undefined): string {
  if (platform === "ig") return "Instagram";
  if (platform === "fb") return "Facebook";
  if (platform === "msg") return "Messenger";
  if (platform === "wa") return "WhatsApp";
  return "Meta";
}

function displayName(mapped: MappedMetaLead): string {
  return [mapped.firstName, mapped.lastName].filter(Boolean).join(" ") || mapped.companyName || mapped.email || mapped.phone || "Unbekannt";
}

function leadUrl(leadId: string): string {
  return new URL(`/leads/${leadId}`, env().APP_URL).toString();
}

async function systemContext(organizationId: string, preferUserId: string | null): Promise<ActorContext> {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
  return contextForApiKey(
    {
      keyId: "meta-lead-ads",
      keyName: "Meta Lead Ads",
      organizationId,
      organizationName: organization.name,
      organizationActive: true,
      scopes: [],
      createdById: preferUserId,
    },
    { preferCreator: true },
  );
}

/** Erster nicht abschließender Lead-Status („Neu“). */
async function initialLeadStatus(organizationId: string): Promise<{ initial: string; terminal: string[] }> {
  const statuses = await prisma.leadStatusOption.findMany({
    where: { organizationId },
    orderBy: { position: "asc" },
    select: { key: true, isTerminal: true },
  });
  return {
    initial: statuses.find((status) => !status.isTerminal)?.key ?? statuses[0]?.key ?? "new",
    terminal: statuses.filter((status) => status.isTerminal).map((status) => status.key),
  };
}

/** Aktives Mitglied oder null — ein ausgeschiedener Owner soll keine Leads mehr bekommen. */
async function activeMember(organizationId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const membership = await prisma.membership.findFirst({ where: { organizationId, userId, status: "ACTIVE" }, select: { userId: true } });
  return membership?.userId ?? null;
}

export type MetaLeadOutcome = { status: "CREATED" | "MERGED"; leadId: string; emailSent: boolean; emailReason: string | null };

/** Holt eine gemeldete Einsendung ab und legt sie im CRM an. Wirft bei Fehlern. */
async function importEvent(event: { id: string; organizationId: string; pageId: string; leadgenId: string; formId: string | null }) {
  const page = await prisma.metaLeadPage.findUnique({ where: { pageId: event.pageId } });
  if (!page || page.organizationId !== event.organizationId) throw new Error("Die Facebook-Seite ist nicht mehr verbunden.");
  const token = decryptSecret(page.tokenCipher);

  const raw = await fetchMetaLead(event.leadgenId, token);
  const formId = raw.form_id ?? event.formId;
  const formName = formId ? await fetchMetaFormName(formId, token) : null;
  const mapped = mapMetaFields(raw.field_data);
  const platform = platformLabel(raw.platform);

  const ownerId =
    (await activeMember(page.organizationId, page.ownerId)) ?? (await activeMember(page.organizationId, page.connectedById));
  const ctx = await systemContext(page.organizationId, ownerId);
  const owner = ownerId ?? ctx.userId;

  const origin = [
    { label: "Quelle", value: `${platform}-Formular${formName ? ` „${formName}“` : ""}` },
    raw.campaign_name ? { label: "Kampagne", value: raw.campaign_name } : null,
    raw.adset_name ? { label: "Anzeigengruppe", value: raw.adset_name } : null,
    raw.ad_name ? { label: "Anzeige", value: raw.ad_name } : null,
    raw.is_organic ? { label: "Art", value: "Organisch (ohne Anzeige)" } : null,
    { label: "Seite", value: page.pageName },
    raw.created_time ? { label: "Eingegangen", value: formatBerlin(raw.created_time) } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  // Dieselbe Person mit einem noch offenen Lead: kein zweiter Lead, sondern
  // die neue Anfrage an den vorhandenen.
  const { initial, terminal } = await initialLeadStatus(page.organizationId);
  const existing = mapped.email
    ? await prisma.lead.findFirst({
        where: {
          organizationId: page.organizationId,
          deletedAt: null,
          convertedAt: null,
          email: { equals: mapped.email, mode: "insensitive" },
          status: { notIn: terminal },
          createdAt: { gte: new Date(Date.now() - MERGE_WINDOW_DAYS * 86_400_000) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;

  let leadId: string;
  if (existing) {
    leadId = existing.id;
  } else {
    const contact = mapped.email
      ? await prisma.contact.findFirst({
          where: { organizationId: page.organizationId, deletedAt: null, email: { equals: mapped.email, mode: "insensitive" } },
          select: { id: true, companyId: true },
        })
      : null;
    // Ein Lead braucht Nachname, Firma, E-Mail oder Telefon. Fehlt alles, wird
    // ein Vorname zum Nachnamen, sonst steht „Unbekannt“ da.
    const identified = Boolean(mapped.lastName || mapped.companyName || mapped.email || mapped.phone);
    const created = await createLead(ctx, {
      firstName: identified ? mapped.firstName : null,
      lastName: identified ? mapped.lastName : (mapped.firstName ?? "Unbekannt"),
      email: mapped.email,
      phone: mapped.phone,
      companyName: mapped.companyName,
      jobTitle: mapped.jobTitle,
      source: `Meta Lead Ads (${platform})`,
      status: initial,
      ownerId: owner,
      contactId: contact?.id,
      companyId: contact?.companyId ?? undefined,
    });
    leadId = created.id;
  }

  const noteLines = [
    existing ? `Erneute Anfrage über ${origin[0].value}.` : `Eingegangen über ${origin[0].value}.`,
    ...(mapped.answers.length ? ["", "Antworten aus dem Formular:", ...mapped.answers.map((row) => `• ${row.label}: ${row.value}`)] : []),
    "",
    ...origin.slice(1).map((row) => `${row.label}: ${row.value}`),
  ];
  await createNote(ctx, { leadId, body: noteLines.join("\n") });

  const name = displayName(mapped);
  await notify(ctx, {
    userId: owner,
    type: "LEAD_RECEIVED",
    title: existing ? `Erneute Anfrage: ${name}` : `Neuer Lead: ${name}`,
    body: origin[0].value,
    link: `/leads/${leadId}`,
    entityType: "Lead",
    entityId: leadId,
  });

  const mail = await sendLeadNotification(ctx, page.notifyEmails, {
    leadName: name,
    leadUrl: leadUrl(leadId),
    email: mapped.email,
    phone: mapped.phone,
    companyName: mapped.companyName,
    jobTitle: mapped.jobTitle,
    answers: mapped.answers,
    origin,
    repeat: Boolean(existing),
  });

  return {
    outcome: { status: existing ? ("MERGED" as const) : ("CREATED" as const), leadId, emailSent: mail.sent, emailReason: mail.reason ?? null },
    summary: {
      name,
      email: mapped.email,
      phone: mapped.phone,
      platform,
      formName,
      campaignName: raw.campaign_name ?? null,
      adName: raw.ad_name ?? null,
      emailSent: mail.sent,
      emailReason: mail.reason ?? null,
    },
  };
}

function formatBerlin(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(date);
}

/**
 * Schickt die Benachrichtigung an die eingestellten Adressen — über den
 * Postausgang des Betriebs (Resend), sonst über den der Organisation.
 */
export async function sendLeadNotification(
  ctx: ActorContext,
  recipients: string[],
  input: LeadNotificationInput,
): Promise<{ sent: boolean; reason?: string }> {
  const to = Array.from(new Set(recipients.map((address) => address.trim().toLowerCase()).filter(Boolean)));
  if (to.length === 0) return { sent: false, reason: "Keine Empfänger für die Benachrichtigung eingestellt." };
  const mail = leadNotificationMail(input);

  const { platformMailIntended, sendPlatformEmail } = await import("@/server/integrations/platform-mail");
  if (platformMailIntended()) {
    let failure: string | undefined;
    for (const address of to) {
      const result = await sendPlatformEmail({ to: address, ...mail });
      if (!result.sent) failure = result.reason;
    }
    return failure ? { sent: false, reason: failure } : { sent: true };
  }

  try {
    const { resolveEmailTransport } = await import("@/server/integrations/email");
    const resolution = await resolveEmailTransport(ctx);
    if (!resolution.ok) return { sent: false, reason: resolution.reason };
    await resolution.transport.send({ from: resolution.fromAddress, to, ...mail });
    return { sent: true };
  } catch (error) {
    logError("meta.lead_mail_failed", error, { organizationId: ctx.organizationId });
    return { sent: false, reason: "Der Versand der Benachrichtigung ist fehlgeschlagen." };
  }
}

/**
 * Verarbeitet eine Meldung, wenn sie fällig und nicht gerade in Arbeit ist.
 * Gibt das Ergebnis zurück oder null, wenn nichts zu tun war.
 */
export async function processMetaLeadEvent(eventId: string, now = new Date()): Promise<MetaLeadOutcome | null> {
  const claimed = await prisma.metaLeadEvent.updateMany({
    where: {
      id: eventId,
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return null;
  const event = await prisma.metaLeadEvent.findUniqueOrThrow({ where: { id: eventId } });

  try {
    const { outcome, summary } = await importEvent(event);
    await prisma.$transaction([
      prisma.metaLeadEvent.update({
        where: { id: event.id },
        data: {
          status: outcome.status,
          leadId: outcome.leadId,
          summary: summary as Prisma.InputJsonValue,
          error: null,
          nextAttemptAt: null,
          processedAt: new Date(),
        },
      }),
      prisma.metaLeadPage.updateMany({
        where: { pageId: event.pageId },
        data: { lastLeadAt: new Date(), lastError: null, lastErrorAt: null },
      }),
    ]);
    logInfo("meta.lead_imported", { eventId: event.id, leadId: outcome.leadId, status: outcome.status });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unbekannter Fehler";
    const attempts = event.attempts;
    const delay = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
    const giveUp = attempts >= MAX_ATTEMPTS;
    await prisma.metaLeadEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        error: message,
        nextAttemptAt: giveUp ? null : new Date(Date.now() + delay * 60_000),
      },
    });
    await prisma.metaLeadPage.updateMany({
      where: { pageId: event.pageId },
      data: { lastError: message, lastErrorAt: new Date() },
    });
    logError("meta.lead_import_failed", error, { eventId: event.id, attempts, tokenInvalid: error instanceof MetaApiError && error.tokenInvalid });
    return null;
  }
}

/** Für den Zustell-Worker: alles Fällige abarbeiten. */
export async function processDueMetaLeads(limit = 20, now = new Date()): Promise<number> {
  const due = await prisma.metaLeadEvent.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let done = 0;
  for (const event of due) if (await processMetaLeadEvent(event.id, now)) done++;
  return done;
}

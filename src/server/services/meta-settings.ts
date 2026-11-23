import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { assertPermission, type ActorContext } from "@/lib/context";
import { assertFound, scope } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { emailField } from "@/lib/schemas/crm";
import { logWarn } from "@/lib/logger";
import {
  exchangeForLongLivedToken,
  listMetaPages,
  META_REQUIRED_PERMISSIONS,
  metaGraphVersion,
  metaMissingConfig,
  MetaApiError,
  subscribePage,
  unsubscribePage,
} from "@/server/integrations/meta";
import { processMetaLeadEvent, sendLeadNotification } from "./meta-leads";

/**
 * Einstellungen → Integrationen → Meta Lead Ads.
 *
 * Verbunden wird mit einem Zugriffstoken (z. B. aus dem Graph API Explorer).
 * Das CRM tauscht es gegen ein dauerhaftes, holt die Seiten-Tokens und
 * abonniert die gewählten Seiten für neue Leads. Gespeichert wird nur das
 * Seiten-Token, verschlüsselt; das Nutzer-Token wird nicht aufbewahrt.
 */

export function metaWebhookUrl(): string {
  return new URL("/api/integrations/meta/webhook", env().APP_URL).toString();
}

export async function getMetaOverview(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  const [pages, events] = await Promise.all([
    prisma.metaLeadPage.findMany({ where: scope(ctx), orderBy: { createdAt: "asc" } }),
    prisma.metaLeadEvent.findMany({ where: scope(ctx), orderBy: { receivedAt: "desc" }, take: 25 }),
  ]);
  return {
    missingConfig: metaMissingConfig(),
    webhookUrl: metaWebhookUrl(),
    graphVersion: metaGraphVersion(),
    permissions: [...META_REQUIRED_PERMISSIONS],
    pages: pages.map((page) => ({
      id: page.id,
      pageId: page.pageId,
      pageName: page.pageName,
      ownerId: page.ownerId,
      notifyEmails: page.notifyEmails,
      isActive: page.isActive,
      lastLeadAt: page.lastLeadAt?.toISOString() ?? null,
      lastError: page.lastError,
      lastErrorAt: page.lastErrorAt?.toISOString() ?? null,
      createdAt: page.createdAt.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      pageId: event.pageId,
      status: event.status,
      attempts: event.attempts,
      leadId: event.leadId,
      summary: (event.summary ?? null) as Record<string, unknown> | null,
      error: event.error,
      receivedAt: event.receivedAt.toISOString(),
      processedAt: event.processedAt?.toISOString() ?? null,
      nextAttemptAt: event.nextAttemptAt?.toISOString() ?? null,
    })),
  };
}

const tokenSchema = z.object({
  accessToken: z.string({ error: "Bitte das Zugriffstoken einfügen." }).trim().min(20, "Das sieht nicht nach einem Zugriffstoken aus.").max(2000),
});

async function pagesFor(accessToken: string) {
  try {
    return await listMetaPages(await exchangeForLongLivedToken(accessToken));
  } catch (error) {
    if (error instanceof MetaApiError && error.tokenInvalid) {
      throw ValidationError("Das eingefügte Token ist ungültig oder abgelaufen. Bitte im Graph API Explorer ein neues erzeugen.");
    }
    throw ValidationError(error instanceof Error ? error.message : "Meta hat die Seiten nicht geliefert.");
  }
}

/** Welche Seiten das Token sieht — ohne Seiten-Tokens an den Browser zu geben. */
export async function lookupMetaPages(ctx: ActorContext, input: z.input<typeof tokenSchema>) {
  assertPermission(ctx, "settings.manage");
  const { accessToken } = tokenSchema.parse(input);
  const pages = await pagesFor(accessToken);
  if (pages.length === 0) {
    throw ValidationError(
      "Mit diesem Token ist keine Facebook-Seite erreichbar. Wurde beim Erzeugen die Seite ausgewählt und „pages_show_list“ erlaubt?",
    );
  }
  const known = await prisma.metaLeadPage.findMany({
    where: { pageId: { in: pages.map((page) => page.id) } },
    select: { pageId: true, organizationId: true },
  });
  return pages.map((page) => {
    const match = known.find((entry) => entry.pageId === page.id);
    return {
      id: page.id,
      name: page.name,
      connected: match?.organizationId === ctx.organizationId,
      connectedElsewhere: Boolean(match && match.organizationId !== ctx.organizationId),
    };
  });
}

const connectSchema = tokenSchema.extend({
  pageIds: z.array(z.string().trim().min(1).max(40)).min(1, "Bitte mindestens eine Seite wählen.").max(20),
});

export async function connectMetaPages(ctx: ActorContext, input: z.input<typeof connectSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = connectSchema.parse(input);
  const available = await pagesFor(data.accessToken);

  const connected: string[] = [];
  for (const pageId of data.pageIds) {
    const page = available.find((entry) => entry.id === pageId);
    if (!page) throw ValidationError(`Die Seite ${pageId} ist mit diesem Token nicht erreichbar.`);
    const existing = await prisma.metaLeadPage.findUnique({ where: { pageId } });
    if (existing && existing.organizationId !== ctx.organizationId) {
      throw Conflict(`„${page.name}“ ist bereits mit einem anderen Arbeitsbereich verbunden.`);
    }

    try {
      await subscribePage(page.id, page.accessToken);
    } catch (error) {
      throw ValidationError(
        `„${page.name}“ ließ sich nicht abonnieren: ${error instanceof Error ? error.message : "unbekannter Fehler"}`,
      );
    }

    await prisma.metaLeadPage.upsert({
      where: { pageId },
      create: {
        organizationId: ctx.organizationId,
        pageId,
        pageName: page.name,
        tokenCipher: encryptSecret(page.accessToken),
        ownerId: ctx.userId,
        notifyEmails: [ctx.email],
        connectedById: ctx.userId,
      },
      update: {
        pageName: page.name,
        tokenCipher: encryptSecret(page.accessToken),
        isActive: true,
        lastError: null,
        lastErrorAt: null,
        connectedById: ctx.userId,
      },
    });
    connected.push(page.name);
    await writeAudit(ctx, {
      action: "integration.connected",
      entityType: "IntegrationConnection",
      entityId: pageId,
      after: { provider: "Meta Lead Ads", page: page.name },
    });
  }
  return { connected };
}

const pageUpdateSchema = z.object({
  ownerId: z.string().trim().max(30).nullable().optional(),
  notifyEmails: z
    .array(z.string())
    .max(10, "Höchstens zehn Empfänger.")
    .optional()
    .transform((list, issue) => {
      if (!list) return undefined;
      const cleaned: string[] = [];
      for (const raw of list) {
        if (!raw.trim()) continue;
        const parsed = emailField.safeParse(raw);
        if (!parsed.success) {
          issue.addIssue({ code: "custom", message: `„${raw.trim()}“ ist keine gültige E-Mail-Adresse.` });
          return z.NEVER;
        }
        cleaned.push(parsed.data);
      }
      return Array.from(new Set(cleaned));
    }),
  isActive: z.boolean().optional(),
});

export async function updateMetaPage(ctx: ActorContext, id: string, input: z.input<typeof pageUpdateSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = pageUpdateSchema.parse(input);
  const page = assertFound(await prisma.metaLeadPage.findFirst({ where: { id, ...scope(ctx) } }), "Die Seite wurde nicht gefunden.");
  if (data.ownerId) {
    const member = await prisma.membership.findFirst({
      where: { organizationId: ctx.organizationId, userId: data.ownerId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!member) throw ValidationError("Die gewählte Person gehört nicht zu dieser Organisation.");
  }
  const updated = await prisma.metaLeadPage.update({
    where: { id: page.id },
    data: {
      ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}),
      ...(data.notifyEmails !== undefined ? { notifyEmails: data.notifyEmails } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
  await writeAudit(ctx, {
    action: "integration.updated",
    entityType: "IntegrationConnection",
    entityId: page.pageId,
    before: { ownerId: page.ownerId, notifyEmails: page.notifyEmails, isActive: page.isActive },
    after: { ownerId: updated.ownerId, notifyEmails: updated.notifyEmails, isActive: updated.isActive },
  });
  return { ok: true };
}

export async function disconnectMetaPage(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const page = assertFound(await prisma.metaLeadPage.findFirst({ where: { id, ...scope(ctx) } }), "Die Seite wurde nicht gefunden.");
  try {
    await unsubscribePage(page.pageId, decryptSecret(page.tokenCipher));
  } catch (error) {
    // Ist das Token schon ungültig, ist das Abo ohnehin wirkungslos.
    logWarn("meta.unsubscribe_failed", { pageId: page.pageId, reason: error instanceof MetaApiError ? error.message : String(error) });
  }
  await prisma.metaLeadPage.delete({ where: { id: page.id } });
  await writeAudit(ctx, {
    action: "integration.disconnected",
    entityType: "IntegrationConnection",
    entityId: page.pageId,
    before: { provider: "Meta Lead Ads", page: page.pageName },
  });
  return { ok: true };
}

/** Probe der Benachrichtigung an die eingestellten Empfänger. */
export async function sendMetaTestNotification(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const page = assertFound(await prisma.metaLeadPage.findFirst({ where: { id, ...scope(ctx) } }), "Die Seite wurde nicht gefunden.");
  const result = await sendLeadNotification(ctx, page.notifyEmails, {
    test: true,
    leadName: "Erika Musterfrau",
    leadUrl: new URL("/leads", env().APP_URL).toString(),
    email: "erika@beispiel.de",
    phone: "+49 30 1234567",
    companyName: "Beispiel GmbH",
    answers: [{ label: "Wann dürfen wir anrufen?", value: "Vormittags" }],
    origin: [
      { label: "Quelle", value: "Facebook-Formular „Rückruf anfordern“" },
      { label: "Kampagne", value: "Beispielkampagne" },
      { label: "Seite", value: page.pageName },
    ],
  });
  return { sent: result.sent, reason: result.reason ?? null, recipients: page.notifyEmails };
}

/** Eine gescheiterte Meldung sofort erneut versuchen. */
export async function retryMetaLeadEvent(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const event = assertFound(await prisma.metaLeadEvent.findFirst({ where: { id, ...scope(ctx) } }), "Der Eintrag wurde nicht gefunden.");
  if (event.status !== "FAILED" && event.status !== "PENDING") throw ValidationError("Dieser Lead ist bereits angelegt.");
  // Ein neuer Anlauf mit frischem Zähler — jemand hat bewusst geklickt.
  await prisma.metaLeadEvent.update({ where: { id: event.id }, data: { attempts: 0, nextAttemptAt: null } });
  const outcome = await processMetaLeadEvent(event.id);
  const after = await prisma.metaLeadEvent.findUniqueOrThrow({ where: { id: event.id }, select: { status: true, error: true, leadId: true } });
  return { ok: Boolean(outcome), status: after.status, error: after.error, leadId: after.leadId };
}

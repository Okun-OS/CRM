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
import { logError, logWarn } from "@/lib/logger";
import {
  exchangeForLongLivedToken,
  fetchMetaFormLeads,
  fetchMetaFormName,
  listMetaLeadForms,
  listMetaPages,
  META_BUSINESS_PERMISSION,
  META_REQUIRED_PERMISSIONS,
  metaGraphVersion,
  metaMissingConfig,
  MetaApiError,
  type MetaPageSearch,
  subscribePage,
  unsubscribePage,
} from "@/server/integrations/meta";
import { Prisma } from "@/generated/prisma/client";
import { processImportedMetaLeads, processMetaLeadEvent, sendLeadNotification, type ImportedMetaLead } from "./meta-leads";

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
    permissions: [...META_REQUIRED_PERMISSIONS, META_BUSINESS_PERMISSION],
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
      origin: event.origin,
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

async function pagesFor(accessToken: string): Promise<MetaPageSearch> {
  try {
    return await listMetaPages(await exchangeForLongLivedToken(accessToken));
  } catch (error) {
    if (error instanceof MetaApiError && error.tokenInvalid) {
      throw ValidationError("Das eingefügte Token ist ungültig oder abgelaufen. Bitte im Graph API Explorer ein neues erzeugen.");
    }
    throw ValidationError(error instanceof Error ? error.message : "Meta hat die Seiten nicht geliefert.");
  }
}

/**
 * Warum das Token keine Seite liefert — so genau, wie Meta es verrät. Die
 * häufigsten Gründe: Seite beim Bestätigen nicht gewählt (Meta merkt sich die
 * erste Auswahl), Seite im Business-Portfolio ohne `business_management`,
 * oder die Person hat auf der Seite keinen vollen Zugriff.
 */
export function noPagesMessage({ grant, withoutToken }: Pick<MetaPageSearch, "grant" | "withoutToken">): string {
  const lead = "Mit diesem Token ist keine Facebook-Seite erreichbar.";
  if (withoutToken.length > 0) {
    const names = withoutToken.slice(0, 3).map((page) => `„${page.name}“`).join(", ");
    return `Das Token sieht ${names}, aber Meta gibt dafür kein Seiten-Token heraus. Die Person, die das Token erzeugt, braucht auf der Seite vollen Zugriff (im Business-Portfolio unter Seiten → Personen: volle Kontrolle).`;
  }
  const declined = grant?.declined.filter((permission) => permission === "pages_show_list" || permission === META_BUSINESS_PERMISSION) ?? [];
  if (declined.length > 0) {
    return `${lead} Beim Bestätigen ${declined.length === 1 ? "wurde" : "wurden"} ${declined.join(" und ")} abgelehnt. Bei Facebook unter Einstellungen → Unternehmensintegrationen die App entfernen, dann im Graph API Explorer ein neues Token erzeugen und alles erlauben.`;
  }
  if (grant && !grant.granted.includes("pages_show_list")) {
    return `${lead} Dem Token fehlt pages_show_list. Im Graph API Explorer anhaken und ein neues Token erzeugen.`;
  }
  if (grant && !grant.granted.includes(META_BUSINESS_PERMISSION)) {
    return `${lead} Gehört die Seite zu einem Business-Portfolio, braucht das Token zusätzlich business_management. Im Graph API Explorer anhaken, ein neues Token erzeugen und beim Bestätigen Portfolio und Seite auswählen.`;
  }
  return `${lead} Meta merkt sich die Auswahl vom ersten Bestätigen: Bei Facebook unter Einstellungen → Unternehmensintegrationen die App entfernen, dann im Graph API Explorer ein neues Token erzeugen und im Fenster Portfolio und Seite auswählen.`;
}

/** Welche Seiten das Token sieht — ohne Seiten-Tokens an den Browser zu geben. */
export async function lookupMetaPages(ctx: ActorContext, input: z.input<typeof tokenSchema>) {
  assertPermission(ctx, "settings.manage");
  const { accessToken } = tokenSchema.parse(input);
  const search = await pagesFor(accessToken);
  if (search.pages.length === 0) throw ValidationError(noPagesMessage(search));
  const known = await prisma.metaLeadPage.findMany({
    where: { pageId: { in: search.pages.map((page) => page.id) } },
    select: { pageId: true, organizationId: true },
  });
  return {
    pages: search.pages.map((page) => {
      const match = known.find((entry) => entry.pageId === page.id);
      return {
        id: page.id,
        name: page.name,
        connected: match?.organizationId === ctx.organizationId,
        connectedElsewhere: Boolean(match && match.organizationId !== ctx.organizationId),
      };
    }),
    /** Ohne diese Berechtigungen kann das CRM die Leads später nicht abholen. */
    missingPermissions: search.grant ? META_REQUIRED_PERMISSIONS.filter((permission) => !search.grant!.granted.includes(permission)) : [],
  };
}

const connectSchema = tokenSchema.extend({
  pageIds: z.array(z.string().trim().min(1).max(40)).min(1, "Bitte mindestens eine Seite wählen.").max(20),
});

export async function connectMetaPages(ctx: ActorContext, input: z.input<typeof connectSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = connectSchema.parse(input);
  const available = (await pagesFor(data.accessToken)).pages;

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

/* ── Bestehende Leads übernehmen ───────────────────────────────────────── */

/** Höchstens so viele Einsendungen je Import — reicht für Jahre an Formularen. */
const IMPORT_LIMIT = 5000;

const importSchema = z.object({
  /** Nur Einsendungen ab diesem Tag; ohne Angabe alle, die Meta noch liefert. */
  since: z.coerce.date().nullable().optional(),
  /** Formular-IDs, falls Meta die Liste der Formulare nicht herausgibt. */
  formIds: z
    .array(z.string().trim().regex(/^\d{5,30}$/, "Eine Formular-ID besteht nur aus Ziffern."))
    .max(20)
    .optional(),
});

/**
 * Holt alle Einsendungen der Formulare einer Seite und hält jede, die das CRM
 * noch nicht kennt, zur Übernahme fest. Angelegt wird danach im Hintergrund —
 * ohne Einzel-E-Mail, mit dem ursprünglichen Eingangszeitpunkt. Ein zweiter
 * Import übernimmt nur, was neu dazugekommen ist.
 */
export async function importExistingMetaLeads(ctx: ActorContext, id: string, input: z.input<typeof importSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = importSchema.parse(input);
  const page = assertFound(await prisma.metaLeadPage.findFirst({ where: { id, ...scope(ctx) } }), "Die Seite wurde nicht gefunden.");
  const token = decryptSecret(page.tokenCipher);

  let forms: { id: string; name: string }[];
  if (data.formIds?.length) {
    forms = [];
    for (const formId of Array.from(new Set(data.formIds))) forms.push({ id: formId, name: (await fetchMetaFormName(formId, token)) ?? formId });
  } else {
    try {
      forms = (await listMetaLeadForms(page.pageId, token)).map((form) => ({ id: form.id, name: form.name }));
    } catch (error) {
      // Ist das Token ungültig, hilft auch eine Formular-ID nicht weiter.
      if (error instanceof MetaApiError && error.tokenInvalid) throw ValidationError(error.message);
      throw ValidationError(
        `Meta hat die Liste der Formulare nicht herausgegeben (${error instanceof Error ? error.message : "unbekannter Grund"}). Bitte die Formular-ID angeben.`,
        { fields: { formIds: "Formular-ID aus dem Werbeanzeigenmanager → Formulare" } },
      );
    }
    if (forms.length === 0) throw ValidationError("Diese Seite hat keine Lead-Formulare.");
  }

  const startedAt = new Date();
  const perForm: { id: string; name: string; found: number; added: number }[] = [];
  let found = 0;
  let added = 0;
  for (const form of forms) {
    const entry = { id: form.id, name: form.name, found: 0, added: 0 };
    perForm.push(entry);
    try {
      for await (const batch of fetchMetaFormLeads(form.id, token, data.since ?? undefined)) {
        for (const lead of batch) {
          if (found >= IMPORT_LIMIT) break;
          found++;
          entry.found++;
          const raw: ImportedMetaLead = { ...lead, form_id: lead.form_id ?? form.id, _formName: form.name };
          try {
            await prisma.metaLeadEvent.create({
              data: {
                organizationId: ctx.organizationId,
                pageId: page.pageId,
                leadgenId: lead.id,
                formId: raw.form_id,
                adId: lead.ad_id ?? null,
                origin: "import",
                rawLead: raw as unknown as Prisma.InputJsonValue,
                importedById: ctx.userId,
              },
            });
            added++;
            entry.added++;
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
          }
        }
        if (found >= IMPORT_LIMIT) break;
      }
    } catch (error) {
      throw ValidationError(
        `Die Einsendungen von „${form.name}“ ließen sich nicht abrufen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`,
      );
    }
  }

  await writeAudit(ctx, {
    action: "meta_leads.imported",
    entityType: "IntegrationConnection",
    entityId: page.pageId,
    after: { page: page.pageName, forms: perForm.map((form) => form.name), found, added, since: data.since?.toISOString() ?? null },
  });

  if (added > 0) {
    void processImportedMetaLeads(ctx.organizationId, ctx.userId, startedAt).catch((error) =>
      logError("meta.import_processing_failed", error, { organizationId: ctx.organizationId }),
    );
  }
  return { forms: perForm, found, added, alreadyKnown: found - added, limited: found >= IMPORT_LIMIT };
}

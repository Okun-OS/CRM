import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { emailField } from "@/lib/schemas/crm";

/**
 * Versandkonten — und die Regeln, nach denen sie senden dürfen.
 *
 * Hier sitzt die Verantwortung der ganzen Engine. Ein Werkzeug, das
 * blind auf Menge optimiert, ist ein Spam-Werkzeug; eines, das Tageslimit,
 * Sendefenster und Abstände beachtet, ist ein Vertriebswerkzeug. Der
 * Unterschied ist genau dieser Dienst.
 */
export const sendingAccountInputSchema = z.object({
  label: z.string().trim().min(1, "Bezeichnung ist erforderlich.").max(80),
  fromName: z.string().trim().min(1, "Absendername ist erforderlich.").max(120),
  fromEmail: emailField,
  connectionId: z.string().max(30).optional(),
  userId: z.string().max(30).optional(),
  dailyLimit: z.coerce.number().int().min(1).max(500).default(50),
  sendWindowStart: z.coerce.number().int().min(0).max(23).default(8),
  sendWindowEnd: z.coerce.number().int().min(1).max(24).default(18),
  sendDays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
  timezone: z.string().trim().max(60).default("Europe/Berlin"),
  minGapSeconds: z.coerce.number().int().min(15).max(7200).default(90),
  maxGapSeconds: z.coerce.number().int().min(15).max(14400).default(600),
  signatureHtml: z.string().trim().max(5000).optional(),
});

function assertSane(data: z.infer<typeof sendingAccountInputSchema>) {
  if (data.sendWindowEnd <= data.sendWindowStart) {
    throw ValidationError("Das Sendefenster muss später enden, als es beginnt.");
  }
  if (data.maxGapSeconds < data.minGapSeconds) {
    throw ValidationError("Der größte Abstand darf nicht kleiner sein als der kleinste.");
  }
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: data.timezone });
  } catch {
    throw ValidationError(`„${data.timezone}" ist keine bekannte Zeitzone.`);
  }
}

export async function listSendingAccounts(ctx: ActorContext) {
  assertPermission(ctx, "outreach.settings");
  const accounts = await prisma.sendingAccount.findMany({
    where: scope(ctx),
    orderBy: { createdAt: "asc" },
    include: {
      connection: { select: { id: true, provider: true, status: true } },
      user: { select: { id: true, name: true } },
    },
  });

  const since = startOfDayFor(new Date());
  return Promise.all(
    accounts.map(async (account) => ({
      id: account.id,
      label: account.label,
      fromName: account.fromName,
      fromEmail: account.fromEmail,
      status: account.status,
      dailyLimit: account.dailyLimit,
      sendWindowStart: account.sendWindowStart,
      sendWindowEnd: account.sendWindowEnd,
      sendDays: account.sendDays,
      timezone: account.timezone,
      minGapSeconds: account.minGapSeconds,
      maxGapSeconds: account.maxGapSeconds,
      signatureHtml: account.signatureHtml,
      pausedReason: account.pausedReason,
      connection: account.connection,
      user: account.user,
      /// Wie viel des Tageskontingents heute schon verbraucht ist.
      sentToday: await prisma.emailMessage.count({
        where: {
          organizationId: ctx.organizationId,
          sendingAccountId: account.id,
          direction: "OUTBOUND",
          sentAt: { gte: since },
        },
      }),
      createdAt: account.createdAt.toISOString(),
    })),
  );
}

export async function createSendingAccount(ctx: ActorContext, input: z.input<typeof sendingAccountInputSchema>) {
  assertPermission(ctx, "outreach.settings");
  const data = sendingAccountInputSchema.parse(input);
  assertSane(data);

  const existing = await prisma.sendingAccount.findFirst({ where: { ...scope(ctx), fromEmail: data.fromEmail } });
  if (existing) throw Conflict("Für diese Absenderadresse existiert bereits ein Versandkonto.");

  if (data.connectionId) {
    const connection = await prisma.integrationConnection.findFirst({
      where: { id: data.connectionId, ...scope(ctx) },
    });
    if (!connection) throw ValidationError("Die angegebene Verbindung wurde nicht gefunden.");
  }

  const account = await prisma.sendingAccount.create({
    data: { organizationId: ctx.organizationId, ...data },
  });

  await writeAudit(ctx, {
    action: "sending_account.created",
    entityType: "SendingAccount",
    entityId: account.id,
    after: { label: account.label, fromEmail: account.fromEmail, dailyLimit: account.dailyLimit },
  });

  return account;
}

export async function updateSendingAccount(
  ctx: ActorContext,
  id: string,
  input: z.input<typeof sendingAccountInputSchema>,
) {
  assertPermission(ctx, "outreach.settings");
  const data = sendingAccountInputSchema.parse(input);
  assertSane(data);

  const existing = assertFound(
    await prisma.sendingAccount.findFirst({ where: { id, ...scope(ctx) } }),
    "Das Versandkonto wurde nicht gefunden.",
  );

  const account = await prisma.sendingAccount.update({ where: { id: existing.id }, data });
  await writeAudit(ctx, {
    action: "sending_account.updated",
    entityType: "SendingAccount",
    entityId: account.id,
    before: { dailyLimit: existing.dailyLimit, sendWindowStart: existing.sendWindowStart },
    after: { dailyLimit: account.dailyLimit, sendWindowStart: account.sendWindowStart },
  });
  return account;
}

/** Pausiert ein Konto — immer mit Grund, nie stillschweigend. */
export async function pauseSendingAccount(ctx: ActorContext, id: string, reason: string) {
  assertPermission(ctx, "outreach.settings");
  const existing = assertFound(
    await prisma.sendingAccount.findFirst({ where: { id, ...scope(ctx) } }),
    "Das Versandkonto wurde nicht gefunden.",
  );
  return pauseAccountInternal(existing.id, reason, ctx);
}

export async function pauseAccountInternal(id: string, reason: string, ctx?: ActorContext) {
  const account = await prisma.sendingAccount.update({
    where: { id },
    data: { status: "PAUSED", pausedReason: reason, pausedAt: new Date() },
  });
  if (ctx) {
    await writeAudit(ctx, {
      action: "sending_account.paused",
      entityType: "SendingAccount",
      entityId: id,
      after: { reason },
    });
  }
  return account;
}

export async function resumeSendingAccount(ctx: ActorContext, id: string) {
  assertPermission(ctx, "outreach.settings");
  const existing = assertFound(
    await prisma.sendingAccount.findFirst({ where: { id, ...scope(ctx) } }),
    "Das Versandkonto wurde nicht gefunden.",
  );
  const account = await prisma.sendingAccount.update({
    where: { id: existing.id },
    data: { status: "ACTIVE", pausedReason: null, pausedAt: null },
  });
  await writeAudit(ctx, { action: "sending_account.resumed", entityType: "SendingAccount", entityId: id });
  return account;
}

export async function deleteSendingAccount(ctx: ActorContext, id: string) {
  assertPermission(ctx, "outreach.settings");
  const existing = assertFound(
    await prisma.sendingAccount.findFirst({ where: { id, ...scope(ctx) } }),
    "Das Versandkonto wurde nicht gefunden.",
  );

  const inUse = await prisma.sequence.count({
    where: { organizationId: ctx.organizationId, sendingAccountId: existing.id, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  if (inUse > 0) {
    throw Conflict(`${inUse} Sequenz(en) senden über dieses Konto. Bitte dort zuerst ein anderes wählen.`);
  }

  await prisma.sendingAccount.delete({ where: { id: existing.id } });
  await writeAudit(ctx, {
    action: "sending_account.deleted",
    entityType: "SendingAccount",
    entityId: id,
    before: { label: existing.label, fromEmail: existing.fromEmail },
  });
}

/* ── Versandregeln ─────────────────────────────────────────────────────── */

type AccountRules = {
  id: string;
  status: string;
  dailyLimit: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  sendDays: number[];
  timezone: string;
  minGapSeconds: number;
  maxGapSeconds: number;
  pausedReason: string | null;
};

/** Stunde und Wochentag in der Zeitzone des Kontos. 1 = Montag. */
export function localParts(date: Date, timezone: string): { hour: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const shortDay = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const DAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { hour, weekday: DAYS[shortDay] ?? 1 };
}

function startOfDayFor(now: Date): Date {
  const copy = new Date(now);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export type SendDecision =
  | { ok: true; account: AccountRules }
  | { ok: false; reason: string; retryAt: Date | null };

/**
 * Darf dieses Konto **jetzt** senden?
 *
 * Vier Gründe, die dagegen sprechen können — jeder mit einer Auskunft, wann
 * es wieder geht. „Nein" ohne „wann" wäre für einen wartenden Sequenzschritt
 * wertlos.
 */
export async function canSendNow(
  organizationId: string,
  account: AccountRules,
  now = new Date(),
): Promise<SendDecision> {
  if (account.status !== "ACTIVE") {
    return {
      ok: false,
      reason: account.pausedReason ?? "Das Versandkonto ist pausiert.",
      retryAt: null,
    };
  }

  const { hour, weekday } = localParts(now, account.timezone);

  if (!account.sendDays.includes(weekday)) {
    return { ok: false, reason: "Heute ist kein Sendetag für dieses Konto.", retryAt: nextDay(now) };
  }
  if (hour < account.sendWindowStart) {
    return { ok: false, reason: "Das Sendefenster hat noch nicht begonnen.", retryAt: addHours(now, account.sendWindowStart - hour) };
  }
  if (hour >= account.sendWindowEnd) {
    return { ok: false, reason: "Das Sendefenster ist für heute vorbei.", retryAt: nextDay(now) };
  }

  const sentToday = await prisma.emailMessage.count({
    where: {
      organizationId,
      sendingAccountId: account.id,
      direction: "OUTBOUND",
      sentAt: { gte: startOfDayFor(now) },
    },
  });
  if (sentToday >= account.dailyLimit) {
    return {
      ok: false,
      reason: `Das Tageskontingent von ${account.dailyLimit} Nachrichten ist erreicht.`,
      retryAt: nextDay(now),
    };
  }

  const last = await prisma.emailMessage.findFirst({
    where: { organizationId, sendingAccountId: account.id, direction: "OUTBOUND", NOT: { sentAt: null } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (last?.sentAt) {
    const elapsed = (now.getTime() - last.sentAt.getTime()) / 1000;
    if (elapsed < account.minGapSeconds) {
      return {
        ok: false,
        reason: "Der Mindestabstand zur letzten Nachricht ist noch nicht verstrichen.",
        retryAt: new Date(last.sentAt.getTime() + account.minGapSeconds * 1000),
      };
    }
  }

  return { ok: true, account };
}

/**
 * Zufälliger Abstand bis zur nächsten Nachricht.
 *
 * Gleichmäßige Abstände sind das auffälligste Merkmal maschinellen Versands.
 * Der Zufall ist hier kein Schmuck, sondern Teil eines verantwortungsvollen
 * Versands.
 */
export function nextGapMs(account: Pick<AccountRules, "minGapSeconds" | "maxGapSeconds">): number {
  const span = Math.max(0, account.maxGapSeconds - account.minGapSeconds);
  return (account.minGapSeconds + Math.floor(Math.random() * (span + 1))) * 1000;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3600_000);
}

function nextDay(date: Date): Date {
  return new Date(date.getTime() + 12 * 3600_000);
}

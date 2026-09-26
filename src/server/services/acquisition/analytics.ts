import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";

/**
 * Auswertung der Akquise.
 *
 * Bewusst kein Zählwerk für verschickte Nachrichten. Die Frage ist nicht
 * „wie viele E-Mails?", sondern „was ist daraus geworden?" — deshalb steht am
 * Ende des Trichters Pipeline und Umsatz, nicht Versandvolumen.
 *
 * Jede Zahl stammt aus echten Datensätzen dieser Organisation. Wo nichts da
 * ist, steht null — nicht ein Platzhalter.
 */
const DAY = 24 * 60 * 60 * 1000;

export type AcquisitionFunnel = {
  from: string;
  prospects: number;
  qualified: number;
  contacted: number;
  replied: number;
  positive: number;
  meetings: number;
  opportunities: number;
  customers: number;
  pipelineValue: number;
  wonValue: number;
  currency: string;
};

export async function acquisitionFunnel(ctx: ActorContext, days = 90): Promise<AcquisitionFunnel> {
  assertPermission(ctx, "prospects.read");
  const from = new Date(Date.now() - days * DAY);
  const where = { ...scope(ctx), deletedAt: null, createdAt: { gte: from } };

  const [prospects, qualified, contacted, replied, positive, meetings, converted, organization] = await Promise.all([
    prisma.prospect.count({ where }),
    prisma.prospect.count({ where: { ...where, NOT: { qualifiedAt: null } } }),
    prisma.prospect.count({ where: { ...where, NOT: { firstContactedAt: null } } }),
    prisma.prospect.count({ where: { ...where, NOT: { repliedAt: null } } }),
    prisma.prospect.count({ where: { ...where, NOT: { interestedAt: null } } }),
    prisma.prospect.count({ where: { ...where, NOT: { meetingAt: null } } }),
    prisma.prospect.findMany({
      where: { ...where, NOT: { dealId: null } },
      select: { dealId: true },
    }),
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { currency: true } }),
  ]);

  const dealIds = converted.map((entry) => entry.dealId).filter((id): id is string => Boolean(id));

  // Pipeline und Umsatz kommen aus den echten Deals, nicht aus einer
  // Hochrechnung: Ein Deal, der aus der Akquise stammt, trägt seinen Wert.
  const [open, won] = await Promise.all([
    dealIds.length
      ? prisma.deal.aggregate({
          where: { id: { in: dealIds }, organizationId: ctx.organizationId, status: "OPEN", deletedAt: null },
          _sum: { amount: true },
        })
      : null,
    dealIds.length
      ? prisma.deal.aggregate({
          where: { id: { in: dealIds }, organizationId: ctx.organizationId, status: "WON", deletedAt: null },
          _sum: { amount: true },
        })
      : null,
  ]);

  const customers = dealIds.length
    ? await prisma.deal.count({
        where: { id: { in: dealIds }, organizationId: ctx.organizationId, status: "WON", deletedAt: null },
      })
    : 0;

  return {
    from: from.toISOString(),
    prospects,
    qualified,
    contacted,
    replied,
    positive,
    meetings,
    opportunities: dealIds.length,
    customers,
    pipelineValue: Number(open?._sum.amount ?? 0),
    wonValue: Number(won?._sum.amount ?? 0),
    currency: organization?.currency ?? "EUR",
  };
}

export type AttentionItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "neutral" | "warning" | "danger";
};

/**
 * Was jetzt eine Entscheidung braucht.
 *
 * Der Unterschied zwischen einem Bericht und einem Arbeitsmittel: Das hier
 * sagt nicht, was war, sondern was liegen geblieben ist.
 */
export async function needsAttention(ctx: ActorContext): Promise<AttentionItem[]> {
  assertPermission(ctx, "prospects.read");
  const twoDaysAgo = new Date(Date.now() - 2 * DAY);

  const [openReplies, interestedWithoutMeeting, pausedAccounts, withoutContact, staleInSequence] = await Promise.all([
    prisma.emailMessage.count({
      where: { ...scope(ctx), direction: "INBOUND", reviewedAt: null, NOT: { prospectId: null } },
    }),
    prisma.prospect.count({
      where: { ...scope(ctx), deletedAt: null, stage: "INTERESTED", meetingAt: null, interestedAt: { lte: twoDaysAgo } },
    }),
    prisma.sendingAccount.count({ where: { ...scope(ctx), status: { in: ["PAUSED", "ERROR"] } } }),
    prisma.prospect.count({
      where: { ...scope(ctx), deletedAt: null, stage: { in: ["QUALIFIED", "READY"] }, email: null },
    }),
    prisma.sequenceEnrollment.count({
      where: { ...scope(ctx), status: "ACTIVE", nextStepAt: { lte: new Date(Date.now() - 2 * DAY) } },
    }),
  ]);

  const items: AttentionItem[] = [
    {
      key: "replies",
      label: openReplies === 1 ? "Antwort wartet auf Sichtung" : "Antworten warten auf Sichtung",
      count: openReplies,
      href: "/outreach/inbox",
      tone: "warning",
    },
    {
      key: "interested",
      label: "Interessierte ohne Termin",
      count: interestedWithoutMeeting,
      href: "/outreach/prospects?stage=INTERESTED",
      tone: "warning",
    },
    {
      key: "accounts",
      label: pausedAccounts === 1 ? "Versandkonto pausiert" : "Versandkonten pausiert",
      count: pausedAccounts,
      href: "/outreach/settings",
      tone: "danger",
    },
    {
      key: "no-contact",
      label: "Prospects ohne Ansprechpartner",
      count: withoutContact,
      href: "/outreach/prospects",
      tone: "neutral",
    },
    {
      key: "stale",
      label: "Sequenzschritte überfällig",
      count: staleInSequence,
      href: "/outreach/sequences",
      tone: "danger",
    },
  ];

  return items.filter((item) => item.count > 0);
}

/**
 * Woher die Kunden kamen.
 *
 * Die Frage, die ein CRM beantworten können muss und die sonst in Tabellen
 * rekonstruiert wird.
 */
export async function attributionBySource(ctx: ActorContext, days = 365) {
  assertPermission(ctx, "prospects.read");
  const from = new Date(Date.now() - days * DAY);

  const rows = await prisma.prospect.groupBy({
    by: ["sourceKey"],
    where: { ...scope(ctx), deletedAt: null, createdAt: { gte: from } },
    _count: { _all: true },
  });

  return Promise.all(
    rows.map(async (row) => {
      const converted = await prisma.prospect.findMany({
        where: { ...scope(ctx), deletedAt: null, sourceKey: row.sourceKey, NOT: { dealId: null } },
        select: { dealId: true },
      });
      const dealIds = converted.map((entry) => entry.dealId).filter((id): id is string => Boolean(id));

      const won = dealIds.length
        ? await prisma.deal.aggregate({
            where: { id: { in: dealIds }, organizationId: ctx.organizationId, status: "WON", deletedAt: null },
            _sum: { amount: true },
            _count: { _all: true },
          })
        : null;

      return {
        sourceKey: row.sourceKey,
        prospects: row._count._all,
        opportunities: dealIds.length,
        customers: won?._count._all ?? 0,
        revenue: Number(won?._sum.amount ?? 0),
      };
    }),
  );
}

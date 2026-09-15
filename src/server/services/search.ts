import { z } from "zod";
import { prisma } from "@/lib/db";
import { can, type ActorContext } from "@/lib/context";
import { liveScope } from "@/lib/tenant";

/**
 * Global search across the four CRM objects. Each object is queried with a
 * small LIMIT and only when the actor may read it, so the palette stays fast
 * and never leaks records the user cannot open.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export type SearchResult = {
  type: "contact" | "company" | "lead" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

export async function globalSearch(ctx: ActorContext, input: z.infer<typeof searchQuerySchema>) {
  const term = input.q;
  const like = { contains: term, mode: "insensitive" as const };

  const [contacts, companies, leads, deals] = await Promise.all([
    can(ctx, "contacts.read")
      ? prisma.contact.findMany({
          where: {
            ...liveScope(ctx),
            OR: [{ firstName: like }, { lastName: like }, { email: like }, { phone: like }],
          },
          select: { id: true, firstName: true, lastName: true, email: true, company: { select: { name: true } } },
          take: input.limit,
          orderBy: { lastActivityAt: "desc" },
        })
      : [],
    can(ctx, "companies.read")
      ? prisma.company.findMany({
          where: { ...liveScope(ctx), OR: [{ name: like }, { domain: like }, { city: like }] },
          select: { id: true, name: true, domain: true, industry: true },
          take: input.limit,
          orderBy: { lastActivityAt: "desc" },
        })
      : [],
    can(ctx, "leads.read")
      ? prisma.lead.findMany({
          where: {
            ...liveScope(ctx),
            OR: [{ firstName: like }, { lastName: like }, { email: like }, { companyName: like }],
          },
          select: { id: true, firstName: true, lastName: true, companyName: true, status: true },
          take: input.limit,
          orderBy: { createdAt: "desc" },
        })
      : [],
    can(ctx, "deals.read")
      ? prisma.deal.findMany({
          where: { ...liveScope(ctx), name: like },
          select: {
            id: true,
            name: true,
            amount: true,
            currency: true,
            company: { select: { name: true } },
            stage: { select: { name: true } },
          },
          take: input.limit,
          orderBy: { updatedAt: "desc" },
        })
      : [],
  ]);

  const results: SearchResult[] = [
    ...contacts.map((contact) => ({
      type: "contact" as const,
      id: contact.id,
      title: `${contact.firstName} ${contact.lastName}`.trim(),
      subtitle: contact.company?.name ?? contact.email,
      href: `/contacts/${contact.id}`,
    })),
    ...companies.map((company) => ({
      type: "company" as const,
      id: company.id,
      title: company.name,
      subtitle: company.domain ?? company.industry,
      href: `/companies/${company.id}`,
    })),
    ...leads.map((lead) => ({
      type: "lead" as const,
      id: lead.id,
      title: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.companyName || "Lead",
      subtitle: lead.companyName,
      href: `/leads/${lead.id}`,
    })),
    ...deals.map((deal) => ({
      type: "deal" as const,
      id: deal.id,
      title: deal.name,
      subtitle: `${deal.stage.name} · ${Number(deal.amount).toLocaleString("de-DE")} ${deal.currency}`,
      href: `/deals/${deal.id}`,
    })),
  ];

  return results;
}

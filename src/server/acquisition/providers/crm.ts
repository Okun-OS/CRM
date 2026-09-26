import { prisma } from "@/lib/db";
import { scope } from "@/lib/tenant";
import type { ProspectCandidate, ProspectingProvider } from "./types";

/**
 * Der eigene Bestand als Quelle.
 *
 * Die unterschätzte Fundgrube: Unternehmen, die im CRM stehen, aber nie eine
 * Chance bekommen haben — Messekontakte, alte Anfragen, Importreste. Sie sind
 * bereits da, bereits geprüft und brauchen keinen externen Anbieter.
 */
export const crmProvider: ProspectingProvider = {
  key: "crm",
  label: "Eigener Bestand",
  description: "Unternehmen aus Ihrem CRM, zu denen es keinen offenen Deal gibt.",
  available: async () => true,
  capabilities: ["industry", "location", "employeeCount", "hasWebsite", "freeText"],

  async search(ctx, input) {
    const companies = await prisma.company.findMany({
      where: {
        ...scope(ctx),
        deletedAt: null,
        ...(input.industry ? { industry: { contains: input.industry, mode: "insensitive" } } : {}),
        ...(input.location ? { city: { contains: input.location, mode: "insensitive" } } : {}),
        ...(input.freeText ? { name: { contains: input.freeText, mode: "insensitive" } } : {}),
        ...(input.hasWebsite === true ? { NOT: { website: null } } : {}),
        ...(input.hasWebsite === false ? { website: null } : {}),
        ...(input.minEmployees !== undefined || input.maxEmployees !== undefined
          ? {
              employeeCount: {
                ...(input.minEmployees !== undefined ? { gte: input.minEmployees } : {}),
                ...(input.maxEmployees !== undefined ? { lte: input.maxEmployees } : {}),
              },
            }
          : {}),
        // Der Punkt der Quelle: nur ohne laufende Chance.
        deals: { none: { status: "OPEN", deletedAt: null } },
      },
      include: {
        contacts: {
          where: { deletedAt: null, NOT: { email: null } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { firstName: true, lastName: true, email: true, jobTitle: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(input.limit, 200),
    });

    const candidates: ProspectCandidate[] = companies.map((company) => {
      const contact = company.contacts[0];
      const fields = ["companyName", "domain", "website", "industry", "employeeCount", "city", "phone"]
        .filter((field) => Boolean((company as Record<string, unknown>)[field === "companyName" ? "name" : field]));

      return {
        companyName: company.name,
        domain: company.domain,
        website: company.website,
        industry: company.industry,
        employeeCount: company.employeeCount,
        street: company.street,
        postalCode: company.postalCode,
        city: company.city,
        country: company.country,
        phone: company.phone,
        firstName: contact?.firstName ?? null,
        lastName: contact?.lastName ?? null,
        email: contact?.email ?? null,
        jobTitle: contact?.jobTitle ?? null,
        sourceRef: company.id,
        provenance: [
          ...fields.map((field) => ({ field, reference: `company:${company.id}` })),
          ...(contact
            ? ["firstName", "lastName", "email", "jobTitle"].map((field) => ({
                field,
                reference: `company:${company.id}`,
              }))
            : []),
        ],
      };
    });

    return { candidates };
  },
};

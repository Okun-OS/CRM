/**
 * Fills in the Active CRM state for records that existed before the engine.
 *
 * Reconciles every open deal and lead of every organization, so each one gets
 * an operational state, a next action and a momentum value. It only
 * *reconciles* — no automation is executed and nothing is sent, which makes it
 * safe to run against production data and safe to run twice.
 *
 *   DATABASE_URL=… pnpm exec tsx --conditions=react-server scripts/backfill-active-crm.ts
 */
import "dotenv/config";

async function main() {
  const { prisma } = await import("@/lib/db");
  const { reconcileSubject } = await import("@/server/engine/next-actions");

  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });
  let total = 0;

  for (const organization of organizations) {
    const [deals, leads] = await Promise.all([
      prisma.deal.findMany({
        where: { organizationId: organization.id, deletedAt: null },
        select: { id: true },
      }),
      prisma.lead.findMany({
        where: { organizationId: organization.id, deletedAt: null },
        select: { id: true },
      }),
    ]);

    for (const deal of deals) {
      await reconcileSubject(organization.id, { kind: "DEAL", id: deal.id });
    }
    for (const lead of leads) {
      await reconcileSubject(organization.id, { kind: "LEAD", id: lead.id });
    }

    total += deals.length + leads.length;
    console.log(`${organization.name}: ${deals.length} Deals, ${leads.length} Leads abgeglichen.`);
  }

  console.log(`Fertig — ${total} Datensätze in ${organizations.length} Organisation(en).`);
  await prisma.$disconnect();
}

void main();

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { buildContext } from "../src/lib/context";
import { getCompany } from "../src/server/services/companies";

async function main() {
  const membership = await prisma.membership.findFirst({ include: { user: true, organization: true } });
  if (!membership) return console.log("keine Mitgliedschaft");
  const ctx = buildContext({
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    userId: membership.userId,
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role,
  });
  const company = await prisma.company.findFirst({ where: { organizationId: ctx.organizationId } });
  if (!company) return console.log("kein Unternehmen");
  const detail = await getCompany(ctx, company.id);
  console.log("OK", detail.name, detail.contacts.length, detail.deals.length);
}
main().catch((error) => { console.error("FEHLER:", error); process.exit(1); }).finally(() => prisma.$disconnect());

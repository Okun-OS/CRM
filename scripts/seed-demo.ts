/**
 * Development seed.
 *
 * Creates one organization with a small, clearly fictional data set so the UI
 * and the end-to-end tests have something to work with. It is NOT run
 * automatically and never runs against a database that already contains this
 * organization — production data is never seeded.
 *
 *   pnpm seed:demo
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/crypto";
import { provisionOrganization, createOrganizationSlug } from "../src/server/services/organizations";
import { buildContext } from "../src/lib/context";
import { createContact } from "../src/server/services/contacts";
import { createCompany } from "../src/server/services/companies";
import { createLead } from "../src/server/services/leads";
import { createDeal } from "../src/server/services/deals";
import { createTask } from "../src/server/services/tasks";
import { createActivity } from "../src/server/services/activities";

const ADMIN_EMAIL = "admin@okun-demo.de";
const ADMIN_PASSWORD = "OkunDemo2026!";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    console.log("Demo-Organisation existiert bereits — nichts zu tun.");
    return;
  }

  const slug = await createOrganizationSlug("OKUN Demo GmbH");
  const { organization, user } = await prisma.$transaction(async (tx) => {
    const organization = await provisionOrganization(tx, { name: "OKUN Demo GmbH", slug });
    const user = await tx.user.create({
      data: { email: ADMIN_EMAIL, name: "Anna Weber", passwordHash: await hashPassword(ADMIN_PASSWORD) },
    });
    await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE" },
    });
    return { organization, user };
  });

  const ctx = buildContext({
    organizationId: organization.id,
    organizationName: organization.name,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: "SUPER_ADMIN",
  });

  const companies = await Promise.all([
    createCompany(ctx, { name: "Nordlicht Technik GmbH", domain: "nordlicht-technik.de", industry: "Maschinenbau", employeeCount: 180, city: "Hamburg", lifecycleStage: "customer" }),
    createCompany(ctx, { name: "Auriga Systems AG", domain: "auriga-systems.de", industry: "Software", employeeCount: 90, city: "München", lifecycleStage: "opportunity" }),
    createCompany(ctx, { name: "Weser Logistik KG", domain: "weser-logistik.de", industry: "Logistik", employeeCount: 420, city: "Bremen", lifecycleStage: "lead" }),
  ]);

  const contacts = await Promise.all([
    createContact(ctx, { firstName: "Markus", lastName: "Hoffmann", email: "m.hoffmann@nordlicht-technik.de", phone: "+49 40 123456", jobTitle: "Einkaufsleiter", companyId: companies[0].id, lifecycleStage: "customer" }),
    createContact(ctx, { firstName: "Sabine", lastName: "Kröger", email: "s.kroeger@auriga-systems.de", phone: "+49 89 998877", jobTitle: "CTO", companyId: companies[1].id, lifecycleStage: "opportunity" }),
    createContact(ctx, { firstName: "Tobias", lastName: "Lehmann", email: "t.lehmann@weser-logistik.de", jobTitle: "Geschäftsführer", companyId: companies[2].id, lifecycleStage: "lead" }),
  ]);

  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId: organization.id },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline) throw new Error("Seed: keine Pipeline vorhanden");

  await createDeal(ctx, {
    name: "Nordlicht — Rahmenvertrag 2026",
    pipelineId: pipeline.id,
    stageId: pipeline.stages[3].id,
    amount: 48_000,
    companyId: companies[0].id,
    contactIds: [contacts[0].id],
    expectedCloseDate: new Date(Date.now() + 21 * 86_400_000),
    source: "Bestandskunde",
  });
  await createDeal(ctx, {
    name: "Auriga — Plattformlizenz",
    pipelineId: pipeline.id,
    stageId: pipeline.stages[1].id,
    amount: 22_500,
    companyId: companies[1].id,
    contactIds: [contacts[1].id],
    expectedCloseDate: new Date(Date.now() + 45 * 86_400_000),
    source: "Empfehlung",
  });

  await createLead(ctx, {
    firstName: "Julia",
    lastName: "Brandt",
    email: "j.brandt@example.de",
    companyName: "Brandt Elektro GmbH",
    status: "new",
    source: "Website",
    score: 60,
  });

  await createTask(ctx, {
    title: "Angebot für Nordlicht nachfassen",
    priority: "HIGH",
    dueAt: new Date(Date.now() + 2 * 86_400_000),
    contactId: contacts[0].id,
  });
  await createActivity(ctx, {
    type: "CALL",
    subject: "Erstgespräch Auriga Systems",
    body: "Bedarf an Plattformlizenz besprochen, Angebot angefragt.",
    direction: "OUTBOUND",
    durationMinutes: 25,
    contactId: contacts[1].id,
    companyId: companies[1].id,
  });

  console.log(`Demo-Organisation angelegt: ${organization.name}`);
  console.log(`Login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

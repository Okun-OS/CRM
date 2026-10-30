/**
 * Mailwin-Sandbox: ein eigener Test-Arbeitsbereich mit Beispieldaten und
 * einem Mailwin-Schlüssel — für die Entwicklung der Mailwin-Gegenseite.
 *
 * Der Arbeitsbereich ist eine eigene Organisation. Der Schlüssel sieht
 * ausschließlich deren Daten, nie die eines Kunden — das garantiert die
 * Mandantentrennung, nicht dieses Skript. Trotzdem gehört er auf eine
 * Testinstanz, nicht auf die Produktion.
 *
 *   pnpm mailwin:sandbox                 # legt an (oder verwendet wieder) und gibt einen neuen Schlüssel aus
 *   pnpm mailwin:sandbox -- --webhook-url=https://… --webhook-secret=…
 *
 * Jeder Aufruf erzeugt einen weiteren Schlüssel; alte bleiben gültig, bis sie
 * in der Oberfläche widerrufen werden.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { hashPassword, randomToken } from "../src/lib/crypto";
import { buildContext } from "../src/lib/context";
import { provisionOrganization } from "../src/server/services/organizations";
import { createCompany } from "../src/server/services/companies";
import { createContact } from "../src/server/services/contacts";
import { createDeal } from "../src/server/services/deals";
import { createMailwinKey, saveMailwinWebhook } from "../src/server/mailwin/settings";

const SLUG = "mailwin-sandbox";
const ADMIN_EMAIL = "mailwin-sandbox@okun.invalid";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  let organization = await prisma.organization.findUnique({ where: { slug: SLUG } });
  let password: string | null = null;

  if (!organization) {
    password = `Sandbox-${randomToken(9)}`;
    const created = await prisma.$transaction(async (tx) => {
      const org = await provisionOrganization(tx, { name: "Mailwin Sandbox", slug: SLUG });
      const user = await tx.user.create({
        data: { email: ADMIN_EMAIL, name: "Mailwin Sandbox", passwordHash: await hashPassword(password!) },
      });
      await tx.membership.create({ data: { organizationId: org.id, userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE" } });
      return org;
    });
    organization = created;
  }

  const membership = await prisma.membership.findFirstOrThrow({
    where: { organizationId: organization.id, role: { in: ["SUPER_ADMIN", "ADMIN"] }, status: "ACTIVE" },
    include: { user: true },
  });
  const ctx = buildContext({
    organizationId: organization.id,
    organizationName: organization.name,
    userId: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role,
  });

  if ((await prisma.contact.count({ where: { organizationId: organization.id } })) === 0) {
    const company = await createCompany(ctx, { name: "Beispiel AG", domain: "beispiel-ag.de", city: "Berlin" });
    const contact = await createContact(ctx, {
      firstName: "Erika",
      lastName: "Musterfrau",
      email: "erika@beispiel-ag.de",
      phone: "+49 30 1234567",
      companyId: company.id,
    });
    const pipeline = await prisma.pipeline.findFirstOrThrow({
      where: { organizationId: organization.id, isDefault: true },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    await createDeal(ctx, {
      name: "Rahmenvertrag 2027",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[1]?.id ?? pipeline.stages[0].id,
      amount: 12500,
      companyId: company.id,
      contactIds: [contact.id],
    });
  }

  const webhookUrl = argument("webhook-url");
  if (webhookUrl) {
    await saveMailwinWebhook(ctx, {
      url: webhookUrl,
      secret: argument("webhook-secret"),
      events: ["lead.stage_changed", "lead.won", "lead.lost", "contact.updated"],
      isActive: true,
    });
  }

  const issued = await createMailwinKey(ctx, { name: `Sandbox ${new Date().toISOString().slice(0, 10)}` });

  console.log("");
  console.log("Mailwin-Sandbox bereit");
  console.log("──────────────────────");
  console.log(`Arbeitsbereich : ${organization.name} (${organization.id})`);
  console.log(`Basis-URL      : ${issued.baseUrl}`);
  console.log(`API-Schlüssel  : ${issued.key}`);
  if (password) {
    console.log(`Anmeldung      : ${env().APP_URL}/login  ·  ${ADMIN_EMAIL}  ·  ${password}`);
  }
  console.log("");
  console.log("Testkontakt: erika@beispiel-ag.de (mit offenem Lead „Rahmenvertrag 2027“)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

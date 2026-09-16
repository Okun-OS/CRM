import { z } from "zod";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";
import { writeAudit } from "@/lib/audit";
import { IntegrationNotConnected, ValidationError } from "@/lib/api/errors";
import { findUnknownPlaceholders, renderTemplate, type TemplateVariables } from "@/lib/templates";
import { resolveEmailTransport } from "@/server/integrations/email";
import { touchLastActivity } from "./activities";
import { logError } from "@/lib/logger";

/**
 * CRM e-mail.
 *
 * Composing, templating, storing and linking messages to records is fully
 * implemented. Actual delivery requires a connected transport — until then
 * `sendEmail` refuses with an explicit reason instead of pretending to send.
 */
export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
  subject: z.string().trim().min(1, "Betreff ist erforderlich.").max(200),
  bodyHtml: z.string().trim().min(1, "Inhalt ist erforderlich.").max(100_000),
  bodyText: z.string().trim().max(50_000).optional(),
  category: z.string().trim().max(80).optional(),
  teamId: z.string().max(30).optional(),
  isActive: z.boolean().default(true),
});

export const emailComposeSchema = z.object({
  subject: z.string().trim().min(1, "Betreff ist erforderlich.").max(200),
  bodyHtml: z.string().trim().min(1, "Inhalt ist erforderlich.").max(100_000),
  to: z.array(z.string().email()).min(1, "Mindestens eine Empfängeradresse angeben.").max(25),
  cc: z.array(z.string().email()).max(25).optional(),
  bcc: z.array(z.string().email()).max(25).optional(),
  templateId: z.string().max(30).optional(),
  contactId: z.string().max(30).optional(),
  companyId: z.string().max(30).optional(),
  dealId: z.string().max(30).optional(),
});

export async function listTemplates(ctx: ActorContext, includeInactive = false) {
  assertPermission(ctx, "templates.read");
  const templates = await prisma.emailTemplate.findMany({
    where: { ...scope(ctx), ...(includeInactive ? {} : { isActive: true }) },
    include: { owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    subject: template.subject,
    bodyHtml: template.bodyHtml,
    bodyText: template.bodyText,
    category: template.category,
    owner: template.owner,
    team: template.team,
    isActive: template.isActive,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }));
}

export async function createTemplate(ctx: ActorContext, input: z.input<typeof templateInputSchema>) {
  assertPermission(ctx, "templates.write");
  const data = templateInputSchema.parse(input);
  assertPlaceholdersKnown(data.subject, data.bodyHtml, data.bodyText ?? "");

  const template = await prisma.emailTemplate.create({
    data: { organizationId: ctx.organizationId, ownerId: ctx.userId, ...data },
  });
  await writeAudit(ctx, {
    action: "email_template.created",
    entityType: "EmailTemplate",
    entityId: template.id,
    after: { name: template.name },
  });
  return template;
}

export async function updateTemplate(ctx: ActorContext, id: string, input: z.input<typeof templateInputSchema>) {
  assertPermission(ctx, "templates.write");
  const data = templateInputSchema.parse(input);
  assertPlaceholdersKnown(data.subject, data.bodyHtml, data.bodyText ?? "");

  const existing = assertFound(
    await prisma.emailTemplate.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Vorlage wurde nicht gefunden.",
  );
  const template = await prisma.emailTemplate.update({ where: { id: existing.id }, data });
  await writeAudit(ctx, {
    action: "email_template.updated",
    entityType: "EmailTemplate",
    entityId: id,
    before: { name: existing.name, subject: existing.subject },
    after: { name: template.name, subject: template.subject },
  });
  return template;
}

export async function deleteTemplate(ctx: ActorContext, id: string) {
  assertPermission(ctx, "templates.write");
  const existing = assertFound(
    await prisma.emailTemplate.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Vorlage wurde nicht gefunden.",
  );
  await prisma.emailTemplate.delete({ where: { id: existing.id } });
  await writeAudit(ctx, { action: "email_template.deleted", entityType: "EmailTemplate", entityId: id, before: { name: existing.name } });
}

function assertPlaceholdersKnown(...texts: string[]) {
  const unknown = findUnknownPlaceholders(...texts);
  if (unknown.length > 0) {
    throw ValidationError(`Unbekannte Platzhalter: ${unknown.map((token) => `{{${token}}}`).join(", ")}`);
  }
}

/** Collects the template variables available for one record. */
export async function templateVariablesFor(
  ctx: ActorContext,
  links: { contactId?: string | null; companyId?: string | null; dealId?: string | null },
): Promise<TemplateVariables> {
  const [contact, company, deal, organization] = await Promise.all([
    links.contactId
      ? prisma.contact.findFirst({
          where: { id: links.contactId, ...scope(ctx) },
          include: { owner: { select: { name: true, email: true } }, company: { select: { name: true, domain: true } } },
        })
      : null,
    links.companyId ? prisma.company.findFirst({ where: { id: links.companyId, ...scope(ctx) } }) : null,
    links.dealId
      ? prisma.deal.findFirst({ where: { id: links.dealId, ...scope(ctx) }, include: { owner: { select: { name: true, email: true } } } })
      : null,
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
  ]);

  return {
    "contact.firstName": contact?.firstName,
    "contact.lastName": contact?.lastName,
    "contact.fullName": contact ? `${contact.firstName} ${contact.lastName}`.trim() : undefined,
    "contact.email": contact?.email,
    "contact.jobTitle": contact?.jobTitle,
    "company.name": company?.name ?? contact?.company?.name,
    "company.domain": company?.domain ?? contact?.company?.domain,
    "deal.name": deal?.name,
    "deal.amount": deal ? `${Number(deal.amount).toLocaleString("de-DE")} ${deal.currency}` : undefined,
    "owner.name": deal?.owner?.name ?? contact?.owner?.name ?? ctx.name,
    "owner.email": deal?.owner?.email ?? contact?.owner?.email ?? ctx.email,
    "organization.name": organization?.name,
  };
}

/** Renders a template against a record without sending anything. */
export async function previewTemplate(
  ctx: ActorContext,
  templateId: string,
  links: { contactId?: string; companyId?: string; dealId?: string },
) {
  assertPermission(ctx, "templates.read");
  const template = assertFound(
    await prisma.emailTemplate.findFirst({ where: { id: templateId, ...scope(ctx) } }),
    "Die Vorlage wurde nicht gefunden.",
  );
  const variables = await templateVariablesFor(ctx, links);
  return {
    subject: renderTemplate(template.subject, variables),
    bodyHtml: renderTemplate(template.bodyHtml, variables),
  };
}

export const emailListQuerySchema = paginationSchema.extend({
  contactId: z.string().max(30).optional(),
  companyId: z.string().max(30).optional(),
  dealId: z.string().max(30).optional(),
});

export async function listEmails(ctx: ActorContext, query: z.infer<typeof emailListQuerySchema>) {
  assertPermission(ctx, "emails.read");
  const where = {
    ...scope(ctx),
    ...(query.contactId ? { contactId: query.contactId } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.dealId ? { dealId: query.dealId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...skipTake(query),
      include: { createdBy: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.emailMessage.count({ where }),
  ]);

  return paginate(
    rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      status: row.status,
      subject: row.subject,
      bodyHtml: row.bodyHtml,
      fromAddress: row.fromAddress,
      toAddresses: row.toAddresses,
      sentAt: row.sentAt?.toISOString() ?? null,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      contact: row.contact ? { id: row.contact.id, name: `${row.contact.firstName} ${row.contact.lastName}`.trim() } : null,
    })),
    total,
    query,
  );
}

export async function saveDraft(ctx: ActorContext, input: z.input<typeof emailComposeSchema>) {
  assertPermission(ctx, "emails.send");
  const data = emailComposeSchema.parse(input);

  const message = await prisma.emailMessage.create({
    data: {
      organizationId: ctx.organizationId,
      direction: "OUTBOUND",
      status: "DRAFT",
      subject: data.subject,
      bodyHtml: data.bodyHtml,
      fromAddress: ctx.email,
      toAddresses: data.to,
      ccAddresses: data.cc ?? [],
      bccAddresses: data.bcc ?? [],
      templateId: data.templateId,
      contactId: data.contactId,
      companyId: data.companyId,
      dealId: data.dealId,
      createdById: ctx.userId,
    },
  });
  return { id: message.id, status: message.status };
}

/**
 * Sends an e-mail through the connected transport and logs it on the record's
 * timeline. Without a transport the message is stored as a draft and the caller
 * gets an explicit "not connected" error.
 */
export async function sendEmail(ctx: ActorContext, input: z.input<typeof emailComposeSchema>) {
  assertPermission(ctx, "emails.send");
  const data = emailComposeSchema.parse(input);

  const resolution = await resolveEmailTransport(ctx);
  if (!resolution.ok) {
    await saveDraft(ctx, data);
    throw IntegrationNotConnected(`${resolution.reason} Die E-Mail wurde als Entwurf gespeichert.`);
  }

  const message = await prisma.emailMessage.create({
    data: {
      organizationId: ctx.organizationId,
      direction: "OUTBOUND",
      status: "QUEUED",
      subject: data.subject,
      bodyHtml: data.bodyHtml,
      fromAddress: resolution.fromAddress,
      toAddresses: data.to,
      ccAddresses: data.cc ?? [],
      bccAddresses: data.bcc ?? [],
      templateId: data.templateId,
      connectionId: resolution.connectionId,
      contactId: data.contactId,
      companyId: data.companyId,
      dealId: data.dealId,
      createdById: ctx.userId,
    },
  });

  try {
    const result = await resolution.transport.send({
      from: resolution.fromAddress,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      html: data.bodyHtml,
    });

    await prisma.emailMessage.update({
      where: { id: message.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId },
    });

    const links = { contactId: data.contactId ?? null, companyId: data.companyId ?? null, dealId: data.dealId ?? null };
    await prisma.activity.create({
      data: {
        organizationId: ctx.organizationId,
        type: "EMAIL",
        source: "MANUAL",
        direction: "OUTBOUND",
        subject: data.subject,
        body: data.bodyHtml.replace(/<[^>]+>/g, " ").slice(0, 500),
        actorId: ctx.userId,
        emailMessageId: message.id,
        ...links,
      },
    });
    await touchLastActivity(ctx, links);

    // The engine needs to know we are now waiting for the customer.
    const { recordEvent } = await import("@/server/engine/events");
    await recordEvent(ctx, {
      type: "EMAIL_SENT",
      source: "USER",
      suppressActivity: true,
      contactId: data.contactId ?? null,
      companyId: data.companyId ?? null,
      dealId: data.dealId ?? null,
      payload: { subject: data.subject, messageId: message.id },
    });

    return { id: message.id, status: "SENT" as const };
  } catch (error) {
    logError("email.send_failed", error, { messageId: message.id });
    await prisma.emailMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Unbekannter Fehler" },
    });
    throw error;
  }
}

/**
 * Workflow action entry point. Returns a reason instead of throwing so a
 * missing transport shows up as a skipped step rather than a failed workflow.
 */
export async function sendTemplatedEmailForAutomation(
  ctx: ActorContext,
  input: { templateId: string; objectType: CrmObjectType; entityId: string; toField: string },
): Promise<{ sent: boolean; reason?: string }> {
  const template = await prisma.emailTemplate.findFirst({
    where: { id: input.templateId, ...scope(ctx), isActive: true },
  });
  if (!template) return { sent: false, reason: "Vorlage nicht gefunden oder inaktiv." };

  const links =
    input.objectType === "CONTACT"
      ? { contactId: input.entityId }
      : input.objectType === "COMPANY"
        ? { companyId: input.entityId }
        : input.objectType === "DEAL"
          ? { dealId: input.entityId }
          : {};

  const recipient = await resolveRecipient(ctx, input.objectType, input.entityId, input.toField);
  if (!recipient) return { sent: false, reason: "Keine Empfängeradresse am Datensatz gefunden." };

  const resolution = await resolveEmailTransport(ctx);
  if (!resolution.ok) return { sent: false, reason: resolution.reason };

  const variables = await templateVariablesFor(ctx, links);
  await sendEmail(ctx, {
    subject: renderTemplate(template.subject, variables),
    bodyHtml: renderTemplate(template.bodyHtml, variables),
    to: [recipient],
    templateId: template.id,
    ...links,
  });
  return { sent: true };
}

async function resolveRecipient(
  ctx: ActorContext,
  objectType: CrmObjectType,
  entityId: string,
  toField: string,
): Promise<string | null> {
  if (toField === "company.email" || objectType === "COMPANY") {
    const company = await prisma.company.findFirst({ where: { id: entityId, ...scope(ctx) }, select: { email: true } });
    return company?.email ?? null;
  }
  if (toField === "lead.email" || objectType === "LEAD") {
    const lead = await prisma.lead.findFirst({ where: { id: entityId, ...scope(ctx) }, select: { email: true } });
    return lead?.email ?? null;
  }
  if (objectType === "DEAL") {
    const link = await prisma.dealContact.findFirst({
      where: { dealId: entityId, organizationId: ctx.organizationId },
      orderBy: { isPrimary: "desc" },
      select: { contact: { select: { email: true } } },
    });
    return link?.contact.email ?? null;
  }
  const contact = await prisma.contact.findFirst({ where: { id: entityId, ...scope(ctx) }, select: { email: true } });
  return contact?.email ?? null;
}

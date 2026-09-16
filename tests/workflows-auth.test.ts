import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOrganization, defaultPipeline } from "./setup/factories";
import { createWorkflow } from "@/server/services/workflows";
import { createContact, getContact, updateContact } from "@/server/services/contacts";
import { createDeal, changeDealStage } from "@/server/services/deals";
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, signPayload, hashToken } from "@/lib/crypto";
import { login, register, changePassword } from "@/server/services/auth";
import { acceptInvitation, inviteMember, readInvitation } from "@/server/services/users";
import { renderTemplate, findUnknownPlaceholders, escapeHtml } from "@/lib/templates";
import { createTemplate } from "@/server/services/emails";
import { sendEmail } from "@/server/services/emails";
import { consumeRateLimit, resetRateLimits } from "@/lib/api/rate-limit";

describe("Workflow-Engine", () => {
  it("führt Aktionen aus, wenn Trigger und Bedingungen passen", async () => {
    const { ctx } = await createTestOrganization();

    await createWorkflow(ctx, {
      name: "Lifecycle bei Neuanlage setzen",
      objectType: "CONTACT",
      triggerType: "RECORD_CREATED",
      triggerConfig: {},
      conditions: { combinator: "AND", conditions: [] },
      actions: [
        { type: "set_property", field: "lifecycleStage", value: "marketing_qualified" },
        { type: "create_task", title: "Neuen Kontakt qualifizieren", dueInDays: 2, priority: "HIGH", assignToOwner: true },
      ],
      isActive: true,
    });

    const contact = await createContact(ctx, { firstName: "Workflow", lastName: "Ziel" });

    // The engine runs inline with the request; re-read the record afterwards.
    const updated = await getContact(ctx, contact.id);
    expect(updated.lifecycleStage).toBe("marketing_qualified");

    const task = await prisma.task.findFirst({ where: { contactId: contact.id } });
    expect(task?.title).toBe("Neuen Kontakt qualifizieren");

    const execution = await prisma.workflowExecution.findFirst({ where: { entityId: contact.id } });
    expect(execution?.status).toBe("SUCCEEDED");
  });

  it("überspringt den Workflow, wenn Bedingungen nicht erfüllt sind", async () => {
    const { ctx } = await createTestOrganization();

    await createWorkflow(ctx, {
      name: "Nur Hamburger Kontakte",
      objectType: "CONTACT",
      triggerType: "RECORD_CREATED",
      triggerConfig: {},
      conditions: { combinator: "AND", conditions: [{ field: "city", operator: "eq", value: "Hamburg" }] },
      actions: [{ type: "create_note", body: "Aus Hamburg" }],
      isActive: true,
    });

    const contact = await createContact(ctx, { firstName: "Nicht", lastName: "Hamburg", city: "Berlin" });

    const execution = await prisma.workflowExecution.findFirst({ where: { entityId: contact.id } });
    expect(execution?.status).toBe("SKIPPED");
    expect(await prisma.note.count({ where: { contactId: contact.id } })).toBe(0);
  });

  it("löst nur bei der konfigurierten Stage aus", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);
    const proposalStage = pipeline.stages[3];

    await createWorkflow(ctx, {
      name: "Angebot nachfassen",
      objectType: "DEAL",
      triggerType: "DEAL_STAGE_CHANGED",
      triggerConfig: { stageId: proposalStage.id },
      conditions: { combinator: "AND", conditions: [] },
      actions: [{ type: "create_task", title: "Angebot nachfassen", dueInDays: 5, priority: "MEDIUM", assignToOwner: true }],
      isActive: true,
    });

    const deal = await createDeal(ctx, {
      name: "Workflow-Deal",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 1000,
      currency: "EUR",
    });

    await changeDealStage(ctx, deal.id, { stageId: pipeline.stages[1].id });
    expect(await prisma.task.count({ where: { dealId: deal.id } })).toBe(0);

    await changeDealStage(ctx, deal.id, { stageId: proposalStage.id });
    expect(await prisma.task.count({ where: { dealId: deal.id, title: "Angebot nachfassen" } })).toBe(1);
  });

  it("führt inaktive Workflows nicht aus", async () => {
    const { ctx } = await createTestOrganization();
    await createWorkflow(ctx, {
      name: "Inaktiv",
      objectType: "CONTACT",
      triggerType: "RECORD_CREATED",
      triggerConfig: {},
      conditions: { combinator: "AND", conditions: [] },
      actions: [{ type: "create_note", body: "Sollte nicht entstehen" }],
      isActive: false,
    });

    const contact = await createContact(ctx, { firstName: "Kein", lastName: "Workflow" });
    expect(await prisma.workflowExecution.count({ where: { entityId: contact.id } })).toBe(0);
  });

  it("begrenzt Rekursion bei sich selbst auslösenden Workflows", async () => {
    const { ctx } = await createTestOrganization();

    // This workflow reacts to its own change; the depth guard must stop it.
    await createWorkflow(ctx, {
      name: "Selbstauslöser",
      objectType: "CONTACT",
      triggerType: "PROPERTY_CHANGED",
      triggerConfig: { propertyKey: "jobTitle" },
      conditions: { combinator: "AND", conditions: [] },
      actions: [{ type: "set_property", field: "jobTitle", value: "Wiederholung" }],
      isActive: true,
    });

    const contact = await createContact(ctx, { firstName: "Schleife", lastName: "Test" });
    await updateContact(ctx, contact.id, { jobTitle: "Start" });

    const executions = await prisma.workflowExecution.count({ where: { entityId: contact.id } });
    expect(executions).toBeGreaterThan(0);
    expect(executions).toBeLessThanOrEqual(4);
  });

  it("markiert fehlgeschlagene Aktionen als Fehler", async () => {
    const { ctx } = await createTestOrganization();
    await createWorkflow(ctx, {
      name: "Ungültige Eigenschaft",
      objectType: "CONTACT",
      triggerType: "RECORD_CREATED",
      triggerConfig: {},
      conditions: { combinator: "AND", conditions: [] },
      actions: [{ type: "set_property", field: "property:gibt_es_nicht", value: "x" }],
      isActive: true,
    });

    const contact = await createContact(ctx, { firstName: "Fehler", lastName: "Workflow" });
    const execution = await prisma.workflowExecution.findFirst({ where: { entityId: contact.id } });
    expect(execution?.status).toBe("FAILED");
  });
});

describe("Authentifizierung", () => {
  it("hasht Passwörter und prüft sie konstant", async () => {
    const hash = await hashPassword("EinSicheresPasswort1");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("EinSicheresPasswort1");
    expect(await verifyPassword("EinSicheresPasswort1", hash)).toBe(true);
    expect(await verifyPassword("falsch", hash)).toBe(false);
    expect(await verifyPassword("beliebig", "kaputt")).toBe(false);
  });

  it("registriert eine Organisation mit Standardkonfiguration", async () => {
    const email = `gruender-${Date.now()}@example.test`;
    const user = await register({
      name: "Gründerin",
      email,
      password: "EinSicheresPasswort1",
      organizationName: "Registrierte GmbH",
    });

    expect(user.organizationId).not.toBeNull();

    const [pipelines, stages, leadStatuses] = await Promise.all([
      prisma.pipeline.count({ where: { organizationId: user.organizationId! } }),
      prisma.pipelineStage.count({ where: { organizationId: user.organizationId! } }),
      prisma.leadStatusOption.count({ where: { organizationId: user.organizationId! } }),
    ]);

    expect(pipelines).toBe(1);
    expect(stages).toBeGreaterThan(4);
    expect(leadStatuses).toBeGreaterThan(3);
  });

  it("lehnt doppelte Registrierungen ab", async () => {
    const email = `doppelt-${Date.now()}@example.test`;
    const input = { name: "Erste", email, password: "EinSicheresPasswort1", organizationName: "Erste GmbH" };
    await register(input);
    await expect(register({ ...input, organizationName: "Zweite GmbH" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("verrät bei falschen Zugangsdaten nicht, ob das Konto existiert", async () => {
    const email = `login-${Date.now()}@example.test`;
    await register({ name: "Login", email, password: "EinSicheresPasswort1", organizationName: "Login GmbH" });

    const wrongPassword = await login({ email, password: "falschesPasswort1" }).catch((error) => error);
    const unknownUser = await login({ email: "gibtesnicht@example.test", password: "falschesPasswort1" }).catch(
      (error) => error,
    );

    expect(wrongPassword.message).toBe(unknownUser.message);
    expect(wrongPassword.code).toBe("UNAUTHENTICATED");
  });

  it("sperrt das Konto nach zu vielen Fehlversuchen", async () => {
    const email = `sperre-${Date.now()}@example.test`;
    await register({ name: "Sperre", email, password: "EinSicheresPasswort1", organizationName: "Sperr GmbH" });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await login({ email, password: "falsch1234567" }).catch(() => undefined);
    }

    const blocked = await login({ email, password: "EinSicheresPasswort1" }).catch((error) => error);
    expect(blocked.message).toContain("gesperrt");
  });

  it("meldet nach einem Passwortwechsel andere Sitzungen ab", async () => {
    const { ctx, user } = await createTestOrganization();

    const otherSession = await prisma.session.create({
      data: {
        tokenHash: hashToken(`token-${Date.now()}`),
        userId: user.id,
        csrfToken: "csrf",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await changePassword(ctx, { currentPassword: "TestPasswort2026!", newPassword: "NeuesPasswort2026x" });

    const revoked = await prisma.session.findUnique({ where: { id: otherSession.id } });
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it("führt den Einladungsfluss bis zur aktiven Mitgliedschaft", async () => {
    const { ctx, organization } = await createTestOrganization();
    const email = `eingeladen-${Date.now()}@example.test`;

    const invitation = await inviteMember(ctx, { email, role: "SALES" });
    const token = invitation.inviteUrl.split("/invite/")[1];

    const preview = await readInvitation(token);
    expect(preview.email).toBe(email);
    expect(preview.organizationName).toBe(organization.name);

    const accepted = await acceptInvitation({ token, name: "Neues Mitglied", password: "EinSicheresPasswort1" });
    expect(accepted.organizationId).toBe(organization.id);

    const membership = await prisma.membership.findFirst({
      where: { organizationId: organization.id, userId: accepted.userId },
    });
    expect(membership?.role).toBe("SALES");
    expect(membership?.status).toBe("ACTIVE");

    // A token can only be used once.
    await expect(readInvitation(token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Verschlüsselung, Signaturen und Rate Limiting", () => {
  it("verschlüsselt und entschlüsselt Integrationsgeheimnisse", () => {
    const cipher = encryptSecret("smtp-passwort");
    expect(cipher).not.toContain("smtp-passwort");
    expect(decryptSecret(cipher)).toBe("smtp-passwort");
    expect(() => decryptSecret("kaputt")).toThrow();
  });

  it("signiert Webhook-Payloads stabil", () => {
    const signature = signPayload("secret", "123.{}");
    expect(signature).toHaveLength(64);
    expect(signPayload("secret", "123.{}")).toBe(signature);
    expect(signPayload("anderes", "123.{}")).not.toBe(signature);
  });

  it("begrenzt Anfragen pro Schlüssel", () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() => consumeRateLimit({ key: "test", limit: 3, windowMs: 1000 })).not.toThrow();
    }
    expect(() => consumeRateLimit({ key: "test", limit: 3, windowMs: 1000 })).toThrow();
    expect(() => consumeRateLimit({ key: "anderer", limit: 3, windowMs: 1000 })).not.toThrow();
  });
});

describe("E-Mail-Vorlagen", () => {
  it("ersetzt bekannte Platzhalter", () => {
    const rendered = renderTemplate("Hallo {{contact.firstName}} von {{company.name}}", {
      "contact.firstName": "Maria",
      "company.name": "Nordwind",
    });
    expect(rendered).toBe("Hallo Maria von Nordwind");
  });

  it("lässt unbekannte Platzhalter stehen und meldet sie", () => {
    expect(renderTemplate("Hallo {{contact.vorname}}", {})).toBe("Hallo {{contact.vorname}}");
    expect(findUnknownPlaceholders("Hallo {{contact.vorname}}")).toEqual(["contact.vorname"]);
    expect(findUnknownPlaceholders("Hallo {{contact.firstName}}")).toEqual([]);
  });

  it("maskiert HTML in eingesetzten Werten", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("weist Vorlagen mit unbekannten Platzhaltern ab", async () => {
    const { ctx } = await createTestOrganization();
    await expect(
      createTemplate(ctx, { name: "Kaputt", subject: "Hallo {{contact.vorname}}", bodyHtml: "Text", isActive: true }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("speichert den Entwurf und meldet den fehlenden Postausgang", async () => {
    const { ctx } = await createTestOrganization();
    const contact = await createContact(ctx, { firstName: "Empfänger", lastName: "Test", email: "empfang@example.de" });

    await expect(
      sendEmail(ctx, { subject: "Angebot", bodyHtml: "<p>Anbei</p>", to: ["empfang@example.de"], contactId: contact.id }),
    ).rejects.toMatchObject({ code: "INTEGRATION_NOT_CONNECTED" });

    const draft = await prisma.emailMessage.findFirst({ where: { contactId: contact.id } });
    expect(draft?.status).toBe("DRAFT");
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createPlatformUser, createCustomer } from "@/server/services/platform";
import { inviteMember } from "@/server/services/users";
import { createTestOrganization } from "./setup/factories";

/**
 * Einladungen über Resend: Team-Einladungen und Kunden-Einladungen gehen über
 * den Postausgang des Betriebs. Die Resend-Schnittstelle wird nachgebildet —
 * es geht nichts nach draußen.
 */
type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

let captured: Captured[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { id: "re_msg_1" } };

beforeEach(() => {
  captured = [];
  reply = { status: 200, body: { id: "re_msg_1" } };
  process.env.RESEND_API_KEY = "re_test_schluessel";
  process.env.MAIL_FROM = "einladung@okun.test";
  delete process.env.MAIL_FROM_NAME;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    captured.push({
      url,
      headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>)),
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
});

describe("Team-Einladung über Resend", () => {
  it("verschickt die Einladung mit Absender, Link und Antwort an die einladende Person", async () => {
    const { ctx } = await createTestOrganization();
    const email = `neu-${randomUUID().slice(0, 8)}@kunde.test`;

    const result = await inviteMember(ctx, { email, role: "SALES" });

    expect(result).toMatchObject({ emailSent: true, emailSkippedReason: null });
    expect(captured).toHaveLength(1);
    const [request] = captured;
    expect(request.url).toBe("https://api.resend.com/emails");
    expect(request.headers.authorization).toBe("Bearer re_test_schluessel");
    expect(request.body).toMatchObject({
      from: "OKUN CRM <einladung@okun.test>",
      to: [email],
      reply_to: ctx.email,
      subject: `Einladung zu OKUN CRM — ${ctx.organizationName}`,
    });
    expect(request.body.html).toContain(result.inviteUrl);
    expect(request.body.html).toContain("Einladung annehmen");
    expect(request.body.text).toContain(`${ctx.name} lädt Sie zu ${ctx.organizationName} in OKUN CRM ein.`);
  });

  it("legt die Einladung auch an, wenn Resend ablehnt, und nennt den Grund", async () => {
    const { ctx } = await createTestOrganization();
    reply = { status: 403, body: { name: "validation_error", message: "The okun.test domain is not verified." } };

    const result = await inviteMember(ctx, { email: `abgelehnt-${randomUUID().slice(0, 8)}@kunde.test`, role: "SALES" });

    expect(result.emailSent).toBe(false);
    expect(result.emailSkippedReason).toContain("Absenderdomain ist in Resend nicht bestätigt");
    expect(result.inviteUrl).toContain("/invite/");
    expect(await prisma.invitation.count({ where: { id: result.id } })).toBe(1);
  });

  it("meldet eine unvollständige Einrichtung, statt still nichts zu senden", async () => {
    const { ctx } = await createTestOrganization();
    delete process.env.MAIL_FROM;

    const result = await inviteMember(ctx, { email: `ohne-absender-${randomUUID().slice(0, 8)}@kunde.test`, role: "SALES" });

    expect(result.emailSent).toBe(false);
    expect(result.emailSkippedReason).toContain("MAIL_FROM");
    expect(captured).toHaveLength(0);
  });

  it("zeigt ohne Resend wie bisher den Link mit Grund", async () => {
    delete process.env.RESEND_API_KEY;
    const { ctx } = await createTestOrganization();

    const result = await inviteMember(ctx, { email: `ohne-${randomUUID().slice(0, 8)}@kunde.test`, role: "SALES" });

    expect(result.emailSent).toBe(false);
    expect(result.emailSkippedReason).toContain("kein E-Mail-Postausgang verbunden");
    expect(captured).toHaveLength(0);
  });
});

describe("Kunden-Einladung aus dem Backoffice über Resend", () => {
  it("schickt dem ersten Administrator seinen Zugang", async () => {
    process.env.MAIL_FROM_NAME = "OKUN Software";
    const suffix = randomUUID().slice(0, 8);
    const operator = await createPlatformUser({ email: `betreiber-${suffix}@okun.test`, name: "Betreiber", password: "BetreiberStart2026!" });
    const adminEmail = `chefin-${suffix}@kunde.test`;

    const result = await createCustomer(
      { userId: operator.id, email: operator.email, name: operator.name },
      { organizationName: `Kunde ${suffix}`, adminName: "Clara Chefin", adminEmail },
    );

    expect(result.emailSent).toBe(true);
    expect(captured[0].body).toMatchObject({
      from: "OKUN Software <einladung@okun.test>",
      to: [adminEmail],
      subject: `Ihr Zugang zu OKUN CRM — Kunde ${suffix}`,
    });
    expect(captured[0].body).not.toHaveProperty("reply_to");
    expect(captured[0].body.text).toContain("Guten Tag Clara Chefin,");
    expect(captured[0].body.html).toContain("Zugang einrichten");
  });
});

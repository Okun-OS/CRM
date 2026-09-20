import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOrganization } from "./setup/factories";
import {
  createCustomer,
  createPlatformUser,
  getCustomer,
  inviteCustomerAdmin,
  listCustomers,
  listPlatformAudit,
  platformOverview,
  reactivateCustomer,
  setPlatformAdmin,
  suspendCustomer,
} from "@/server/services/platform";
import { acceptInvitation } from "@/server/services/users";
import { login } from "@/server/services/auth";
import { createContact } from "@/server/services/contacts";
import type { PlatformActor } from "@/lib/platform";
import { randomUUID } from "node:crypto";

async function platformActor(): Promise<PlatformActor> {
  const suffix = randomUUID().slice(0, 8);
  const user = await createPlatformUser({
    email: `betreiber-${suffix}@okun.test`,
    name: `Betreiber ${suffix}`,
    password: "BetreiberStart2026!",
  });
  return { userId: user.id, email: user.email, name: user.name };
}

describe("Betreiber-Backoffice", () => {
  it("legt einen Kunden mit eigener Konfiguration und offener Einladung an", async () => {
    const actor = await platformActor();
    const suffix = randomUUID().slice(0, 8);

    const result = await createCustomer(actor, {
      organizationName: `Nordlicht Technik ${suffix}`,
      adminName: "Markus Hoffmann",
      adminEmail: `m.hoffmann-${suffix}@nordlicht.test`,
    });

    expect(result.inviteUrl).toContain("/invite/");
    // Ohne konfigurierten Postausgang wird nichts vorgetäuscht.
    expect(result.emailSent).toBe(false);
    expect(result.emailSkippedReason).toBeTruthy();

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
      include: { pipelines: { include: { stages: true } }, leadStatuses: true, invitations: true },
    });

    expect(organization.pipelines).toHaveLength(1);
    expect(organization.pipelines[0].stages.length).toBeGreaterThan(0);
    expect(organization.leadStatuses.length).toBeGreaterThan(0);
    expect(organization.invitations).toHaveLength(1);
    expect(organization.invitations[0].role).toBe("SUPER_ADMIN");

    // Der Betreiber setzt kein Passwort — es gibt noch gar kein Konto.
    const user = await prisma.user.findUnique({ where: { email: `m.hoffmann-${suffix}@nordlicht.test` } });
    expect(user).toBeNull();
  });

  it("führt die Einladung bis zur Super-Administration des Mandanten", async () => {
    const actor = await platformActor();
    const suffix = randomUUID().slice(0, 8);
    const email = `chefin-${suffix}@kunde.test`;

    const created = await createCustomer(actor, {
      organizationName: `Auriga Systems ${suffix}`,
      adminName: "Sabine Kröger",
      adminEmail: email,
    });

    const token = created.inviteUrl.split("/invite/")[1];
    await acceptInvitation({ token, name: "Sabine Kröger", password: "KundenStart2026!" });

    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: created.organizationId, user: { email } },
      select: { role: true, status: true },
    });
    expect(membership.role).toBe("SUPER_ADMIN");
    expect(membership.status).toBe("ACTIVE");

    const session = await login({ email, password: "KundenStart2026!" });
    expect(session.organizationId).toBe(created.organizationId);
  });

  it("weist eine Adresse ab, die bereits zu einer Organisation gehört", async () => {
    const actor = await platformActor();
    const { ctx, user } = await createTestOrganization();
    void ctx;

    await expect(
      createCustomer(actor, {
        organizationName: "Doppelt GmbH",
        adminName: "Doppelt",
        adminEmail: user.email,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("zeigt Kennzahlen, aber keine Inhalte des Mandanten", async () => {
    const actor = await platformActor();
    const { ctx, organization } = await createTestOrganization();
    await createContact(ctx, { firstName: "Geheime", lastName: "Kundin", email: "geheim@kunde.test" });

    const detail = await getCustomer(actor, organization.id);
    expect(detail.counts.contacts).toBe(1);

    // Entscheidend: Die Rückgabe enthält den Namen des Kontakts nirgends.
    const serialised = JSON.stringify(detail);
    expect(serialised).not.toContain("Geheime");
    expect(serialised).not.toContain("geheim@kunde.test");

    const list = await listCustomers(actor);
    const entry = list.find((row) => row.id === organization.id);
    expect(entry?.contacts).toBe(1);
    expect(JSON.stringify(list)).not.toContain("Geheime");
  });

  it("legt still und reaktiviert, mit Begründung und Protokoll", async () => {
    const actor = await platformActor();
    const { ctx, organization, user } = await createTestOrganization();
    void ctx;

    await suspendCustomer(actor, organization.id, { reason: "Rechnung seit 60 Tagen offen." });

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(stored.suspendedAt).not.toBeNull();
    expect(stored.suspendedReason).toContain("Rechnung");

    // Die Anmeldung erklärt den Zustand, statt wortlos zu scheitern.
    await expect(login({ email: user.email, password: "TestPasswort2026!" })).rejects.toThrow(/stillgelegt/i);

    await reactivateCustomer(actor, organization.id);
    const reactivated = await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(reactivated.suspendedAt).toBeNull();

    const session = await login({ email: user.email, password: "TestPasswort2026!" });
    expect(session.organizationId).toBe(organization.id);

    const audit = await listPlatformAudit(actor, 50);
    const actions = audit.filter((entry) => entry.organizationId === organization.id).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["customer.suspended", "customer.reactivated"]));
  });

  it("begründet eine Stilllegung zwingend", async () => {
    const actor = await platformActor();
    const { organization } = await createTestOrganization();

    // Wie überall im Projekt wirft das Schema; die Route übersetzt das in die
    // Fehlerhülle. Entscheidend ist hier, dass ohne Begründung nichts passiert.
    await expect(suspendCustomer(actor, organization.id, { reason: "" })).rejects.toThrow();

    const unchanged = await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(unchanged.suspendedAt).toBeNull();
  });

  it("lädt weitere Zugänge zu einer bestehenden Organisation ein", async () => {
    const actor = await platformActor();
    const { organization } = await createTestOrganization();
    const suffix = randomUUID().slice(0, 8);

    const invitation = await inviteCustomerAdmin(actor, organization.id, {
      email: `zweiter-${suffix}@kunde.test`,
      name: "Zweite Person",
    });

    expect(invitation.inviteUrl).toContain("/invite/");
    const stored = await prisma.invitation.findFirstOrThrow({
      where: { organizationId: organization.id, email: `zweiter-${suffix}@kunde.test` },
    });
    expect(stored.role).toBe("SUPER_ADMIN");
  });

  it("zählt Kunden für die Übersicht", async () => {
    const actor = await platformActor();
    await createTestOrganization();
    const overview = await platformOverview(actor);
    expect(overview.total).toBeGreaterThan(0);
    expect(overview.active + overview.suspended).toBe(overview.total);
  });
});

describe("Grenze zwischen Betreiber und Mandant", () => {
  it("macht eine Mitgliedschaft nicht zum Betreiber", async () => {
    const { user } = await createTestOrganization({ role: "SUPER_ADMIN" });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Selbst der Super-Administrator einer Organisation ist kein Betreiber.
    expect(stored.isPlatformAdmin).toBe(false);
  });

  it("vergibt und entzieht das Betreiberrecht ausdrücklich", async () => {
    const { user } = await createTestOrganization();

    const granted = await setPlatformAdmin(user.email, true);
    expect(granted.isPlatformAdmin).toBe(true);

    const revoked = await setPlatformAdmin(user.email, false);
    expect(revoked.isPlatformAdmin).toBe(false);
  });

  it("gibt dem Betreiber keine Mitgliedschaft in einem Mandanten", async () => {
    const actor = await platformActor();
    const memberships = await prisma.membership.count({ where: { userId: actor.userId } });
    expect(memberships).toBe(0);
  });
});

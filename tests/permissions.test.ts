import { describe, expect, it } from "vitest";
import { addMember, createTestOrganization, defaultPipeline } from "./setup/factories";
import { permissionsForRole, roleHasPermission, assignableRoles } from "@/lib/rbac";
import { createContact, deleteContact, listContacts, updateContact } from "@/server/services/contacts";
import { createDeal } from "@/server/services/deals";
import { createWorkflow } from "@/server/services/workflows";
import { listAuditLog } from "@/server/services/audit";
import { inviteMember, updateMember } from "@/server/services/users";
import { createDefinition } from "@/server/services/property-definitions";

/**
 * Permissions are enforced in the service layer, which is what the API and the
 * UI both go through. A role that cannot do something must fail here, not just
 * have the button hidden.
 */
describe("Rollen und Berechtigungen", () => {
  it("leitet die Rechte je Rolle konsistent ab", () => {
    expect(roleHasPermission("USER", "contacts.read")).toBe(true);
    expect(roleHasPermission("USER", "contacts.write")).toBe(false);
    expect(roleHasPermission("SALES", "contacts.write")).toBe(true);
    expect(roleHasPermission("SALES", "contacts.delete")).toBe(false);
    expect(roleHasPermission("MANAGER", "contacts.delete")).toBe(true);
    expect(roleHasPermission("MANAGER", "users.manage")).toBe(false);
    expect(roleHasPermission("ADMIN", "users.manage")).toBe(true);
    expect(permissionsForRole("SUPER_ADMIN").length).toBeGreaterThan(permissionsForRole("ADMIN").length - 1);
  });

  it("erlaubt nur Administratoren das Vergeben von Rollen", () => {
    expect(assignableRoles("SALES")).toHaveLength(0);
    expect(assignableRoles("MANAGER")).toHaveLength(0);
    expect(assignableRoles("ADMIN")).toContain("SALES");
    expect(assignableRoles("ADMIN")).not.toContain("SUPER_ADMIN");
    expect(assignableRoles("SUPER_ADMIN")).toContain("SUPER_ADMIN");
  });

  it("verweigert Lesern das Schreiben von Kontakten", async () => {
    const org = await createTestOrganization();
    const reader = await addMember(org.ctx, "USER");

    await expect(createContact(reader.ctx, { firstName: "Darf", lastName: "Nicht" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // Reading is still allowed.
    await expect(listContacts(reader.ctx, { page: 1, pageSize: 10, sortDirection: "desc" })).resolves.toBeDefined();
  });

  it("verweigert dem Vertrieb das Löschen von Kontakten", async () => {
    const org = await createTestOrganization();
    const sales = await addMember(org.ctx, "SALES");

    const contact = await createContact(sales.ctx, { firstName: "Bearbeitbar", lastName: "Test" });
    await expect(updateContact(sales.ctx, contact.id, { jobTitle: "Einkauf" })).resolves.toBeDefined();
    await expect(deleteContact(sales.ctx, contact.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("verweigert Nicht-Administratoren die Benutzerverwaltung", async () => {
    const org = await createTestOrganization();
    const manager = await addMember(org.ctx, "MANAGER");

    await expect(inviteMember(manager.ctx, { email: "neu@example.test", role: "SALES" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("verweigert dem Vertrieb Workflow- und Eigenschaftsverwaltung", async () => {
    const org = await createTestOrganization();
    const sales = await addMember(org.ctx, "SALES");

    await expect(
      createWorkflow(sales.ctx, {
        name: "Nicht erlaubt",
        objectType: "DEAL",
        triggerType: "RECORD_CREATED",
        triggerConfig: {},
        conditions: { combinator: "AND", conditions: [] },
        actions: [{ type: "create_note", body: "Test" }],
        isActive: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      createDefinition(sales.ctx, { objectType: "CONTACT", key: "budget", label: "Budget", type: "CURRENCY", isRequired: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("verweigert dem Vertrieb das Audit Log", async () => {
    const org = await createTestOrganization();
    const sales = await addMember(org.ctx, "SALES");

    await expect(listAuditLog(sales.ctx, { page: 1, pageSize: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAuditLog(org.ctx, { page: 1, pageSize: 10 })).resolves.toBeDefined();
  });

  it("lässt den Vertrieb Deals anlegen", async () => {
    const org = await createTestOrganization();
    const sales = await addMember(org.ctx, "SALES");
    const pipeline = await defaultPipeline(org.ctx);

    const deal = await createDeal(sales.ctx, {
      name: "Vertriebsdeal",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 2500,
      currency: "EUR",
    });
    expect(deal.name).toBe("Vertriebsdeal");
    expect(deal.owner?.id).toBe(sales.user.id);
  });

  it("schützt den letzten Super-Administrator", async () => {
    const org = await createTestOrganization();
    const admin = await addMember(org.ctx, "ADMIN");

    const membership = await import("@/lib/db").then((module) =>
      module.prisma.membership.findFirst({
        where: { organizationId: org.organization.id, userId: org.user.id },
      }),
    );

    // Demoting the only remaining owner is refused, whoever asks.
    await expect(updateMember(admin.ctx, membership!.id, { role: "SALES" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(updateMember(admin.ctx, membership!.id, { status: "SUSPENDED" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

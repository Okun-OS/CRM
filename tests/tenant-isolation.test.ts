import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api/errors";
import { createTestOrganization, defaultPipeline } from "./setup/factories";
import { createContact, getContact, listContacts, updateContact, deleteContact } from "@/server/services/contacts";
import { createCompany, getCompany, listCompanies } from "@/server/services/companies";
import { createDeal, getDeal, listDeals } from "@/server/services/deals";
import { createLead, getLead, listLeads } from "@/server/services/leads";
import { createTask, listTasks } from "@/server/services/tasks";
import { createNote, listNotes } from "@/server/services/notes";
import { globalSearch } from "@/server/services/search";
import { listActivities } from "@/server/services/activities";

/**
 * Tenant isolation is the guarantee the whole product rests on: no request may
 * ever read or write another organization's data. These tests create two real
 * organizations and try to cross the boundary from every CRM entry point.
 */
describe("Mandantentrennung", () => {
  it("verhindert Lesen fremder Kontakte über die Detailabfrage", async () => {
    const alpha = await createTestOrganization();
    const beta = await createTestOrganization();

    const contact = await createContact(alpha.ctx, { firstName: "Anna", lastName: "Alpha", email: "anna@alpha.test" });

    await expect(getContact(beta.ctx, contact.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listet nur Datensätze der eigenen Organisation", async () => {
    const alpha = await createTestOrganization();
    const beta = await createTestOrganization();

    await createContact(alpha.ctx, { firstName: "Alpha", lastName: "Kontakt" });
    await createCompany(alpha.ctx, { name: "Alpha GmbH" });
    await createLead(alpha.ctx, { lastName: "Alpha Lead", status: "new" });

    const [contacts, companies, leads] = await Promise.all([
      listContacts(beta.ctx, { page: 1, pageSize: 25, sortDirection: "desc" }),
      listCompanies(beta.ctx, { page: 1, pageSize: 25, sortDirection: "desc" }),
      listLeads(beta.ctx, { page: 1, pageSize: 25, sortDirection: "desc" }),
    ]);

    expect(contacts.total).toBe(0);
    expect(companies.total).toBe(0);
    expect(leads.total).toBe(0);
  });

  it("verhindert Ändern und Löschen fremder Datensätze", async () => {
    const alpha = await createTestOrganization();
    const beta = await createTestOrganization();
    const contact = await createContact(alpha.ctx, { firstName: "Nicht", lastName: "Erreichbar" });

    await expect(updateContact(beta.ctx, contact.id, { firstName: "Gekapert" })).rejects.toBeInstanceOf(AppError);
    await expect(deleteContact(beta.ctx, contact.id)).rejects.toBeInstanceOf(AppError);

    const untouched = await getContact(alpha.ctx, contact.id);
    expect(untouched.firstName).toBe("Nicht");
  });

  it("verhindert das Verknüpfen fremder Datensätze", async () => {
    const alpha = await createTestOrganization();
    const beta = await createTestOrganization();
    const alphaCompany = await createCompany(alpha.ctx, { name: "Alpha Holding" });

    await expect(
      createContact(beta.ctx, { firstName: "Beta", lastName: "Kontakt", companyId: alphaCompany.id }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("verhindert Deals in fremden Pipelines", async () => {
    const alpha = await createTestOrganization();
    const beta = await createTestOrganization();
    const alphaPipeline = await defaultPipeline(alpha.ctx);

    await expect(
      createDeal(beta.ctx, {
        name: "Fremder Deal",
        pipelineId: alphaPipeline.id,
        stageId: alphaPipeline.stages[0].id,
        amount: 1000,
        currency: "EUR",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("hält Aktivitäten, Aufgaben, Notizen und Deals getrennt", async () => {
    const alpha = await createTestOrganization();
    const beta = await createTestOrganization();
    const pipeline = await defaultPipeline(alpha.ctx);

    const contact = await createContact(alpha.ctx, { firstName: "Timeline", lastName: "Test" });
    await createTask(alpha.ctx, { title: "Alpha-Aufgabe", contactId: contact.id, status: "OPEN", priority: "MEDIUM" });
    await createNote(alpha.ctx, { body: "Interne Notiz", contactId: contact.id });
    await createDeal(alpha.ctx, {
      name: "Alpha Deal",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 5000,
      currency: "EUR",
    });

    const [tasks, notes, deals, activities] = await Promise.all([
      listTasks(beta.ctx, { page: 1, pageSize: 25, view: "all" }),
      listNotes(beta.ctx, { page: 1, pageSize: 25 }),
      listDeals(beta.ctx, { page: 1, pageSize: 25, sortDirection: "desc" }),
      listActivities(beta.ctx, { page: 1, pageSize: 25 }),
    ]);

    expect(tasks.total).toBe(0);
    expect(notes.total).toBe(0);
    expect(deals.total).toBe(0);
    expect(activities.total).toBe(0);
  });

  it("findet fremde Datensätze nicht über die globale Suche", async () => {
    const alpha = await createTestOrganization();
    const beta = await createTestOrganization();
    await createContact(alpha.ctx, { firstName: "Geheim", lastName: "Suchbar", email: "geheim@alpha.test" });

    const ownResults = await globalSearch(alpha.ctx, { q: "Geheim", limit: 5 });
    const foreignResults = await globalSearch(beta.ctx, { q: "Geheim", limit: 5 });

    expect(ownResults.length).toBeGreaterThan(0);
    expect(foreignResults).toHaveLength(0);
  });

  it("schreibt jede Zeile mit der eigenen organizationId", async () => {
    const alpha = await createTestOrganization();
    const pipeline = await defaultPipeline(alpha.ctx);

    const contact = await createContact(alpha.ctx, { firstName: "Scope", lastName: "Check" });
    const deal = await createDeal(alpha.ctx, {
      name: "Scope Deal",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 100,
      currency: "EUR",
      contactIds: [contact.id],
    });

    const [contactRow, dealRow, dealContact, activity] = await Promise.all([
      prisma.contact.findUnique({ where: { id: contact.id }, select: { organizationId: true } }),
      prisma.deal.findUnique({ where: { id: deal.id }, select: { organizationId: true } }),
      prisma.dealContact.findFirst({ where: { dealId: deal.id }, select: { organizationId: true } }),
      prisma.activity.findFirst({ where: { dealId: deal.id }, select: { organizationId: true } }),
    ]);

    expect(contactRow?.organizationId).toBe(alpha.organization.id);
    expect(dealRow?.organizationId).toBe(alpha.organization.id);
    expect(dealContact?.organizationId).toBe(alpha.organization.id);
    expect(activity?.organizationId).toBe(alpha.organization.id);
  });

  it("verhindert Zugriff auf fremde Leads und Deals über die Detailabfrage", async () => {
    const alpha = await createTestOrganization();
    const beta = await createTestOrganization();
    const pipeline = await defaultPipeline(alpha.ctx);

    const lead = await createLead(alpha.ctx, { lastName: "Fremd", status: "new" });
    const deal = await createDeal(alpha.ctx, {
      name: "Fremd",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 1,
      currency: "EUR",
    });
    const company = await createCompany(alpha.ctx, { name: "Fremd GmbH" });

    await expect(getLead(beta.ctx, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDeal(beta.ctx, deal.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCompany(beta.ctx, company.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

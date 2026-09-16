import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOrganization, defaultPipeline } from "./setup/factories";
import { createContact, getContact, listContacts, updateContact, deleteContact } from "@/server/services/contacts";
import { createCompany, getCompany, normaliseDomain, updateCompany } from "@/server/services/companies";
import { changeDealStage, createDeal, getDeal, listDeals, updateDeal } from "@/server/services/deals";
import { convertLead, createLead, updateLead } from "@/server/services/leads";
import { createTask, listTasks, updateTask } from "@/server/services/tasks";
import { createNote, updateNote } from "@/server/services/notes";
import { createMeeting } from "@/server/services/meetings";
import { createActivity, listActivities } from "@/server/services/activities";

/** CRUD, relations, timeline and audit behaviour of the core CRM objects. */
describe("CRM-Objekte", () => {
  it("legt Kontakte an, verknüpft sie und schreibt Timeline sowie Audit", async () => {
    const { ctx, organization } = await createTestOrganization();
    const company = await createCompany(ctx, { name: "Nordwind GmbH", domain: "https://www.nordwind.de/kontakt" });

    expect(company.domain).toBe("nordwind.de");

    const contact = await createContact(ctx, {
      firstName: "Maria",
      lastName: "Nord",
      email: "MARIA@Nordwind.de",
      companyId: company.id,
    });

    expect(contact.email).toBe("maria@nordwind.de");
    expect(contact.company?.id).toBe(company.id);
    expect(contact.owner?.id).toBe(ctx.userId);
    expect(contact.lifecycleStage).toBe("lead");

    const timeline = await listActivities(ctx, { page: 1, pageSize: 10, contactId: contact.id });
    expect(timeline.items.some((item) => item.subject === "Kontakt erstellt")).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, entityType: "Contact", entityId: contact.id, action: "contact.created" },
    });
    expect(audit).not.toBeNull();
  });

  it("protokolliert Änderungen als Differenz", async () => {
    const { ctx } = await createTestOrganization();
    const contact = await createContact(ctx, { firstName: "Jan", lastName: "Alt" });

    await updateContact(ctx, contact.id, { jobTitle: "Leiter Einkauf" });

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: contact.id, action: "contact.updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.after).toMatchObject({ jobTitle: "Leiter Einkauf" });
  });

  it("löscht weich und blendet den Datensatz aus Listen aus", async () => {
    const { ctx } = await createTestOrganization();
    const contact = await createContact(ctx, { firstName: "Weg", lastName: "Damit" });

    await deleteContact(ctx, contact.id);

    const list = await listContacts(ctx, { page: 1, pageSize: 25, sortDirection: "desc" });
    expect(list.items.some((item) => item.id === contact.id)).toBe(false);
    await expect(getContact(ctx, contact.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("normalisiert Domains einheitlich", () => {
    expect(normaliseDomain("https://www.Beispiel.de/pfad")).toBe("beispiel.de");
    expect(normaliseDomain("Beispiel.de")).toBe("beispiel.de");
    expect(normaliseDomain(undefined)).toBeUndefined();
  });

  it("führt Deals durch die Pipeline und schreibt Stage-Historie", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);
    const wonStage = pipeline.stages.find((stage) => stage.type === "WON")!;

    const deal = await createDeal(ctx, {
      name: "Rahmenvertrag",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 12_500,
      currency: "EUR",
    });

    expect(deal.status).toBe("OPEN");
    expect(deal.probability).toBe(pipeline.stages[0].probability);

    const moved = await changeDealStage(ctx, deal.id, { stageId: pipeline.stages[1].id });
    expect(moved.stage.id).toBe(pipeline.stages[1].id);

    const won = await changeDealStage(ctx, deal.id, { stageId: wonStage.id });
    expect(won.status).toBe("WON");
    expect(won.probability).toBe(100);
    expect(won.closedAt).not.toBeNull();
    expect(won.stageHistory.length).toBe(3);
    expect(won.stageHistory[0].to.id).toBe(wonStage.id);
  });

  it("erfasst einen Verlustgrund beim Wechsel in die Verloren-Stage", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);
    const lostStage = pipeline.stages.find((stage) => stage.type === "LOST")!;

    const deal = await createDeal(ctx, {
      name: "Verlorener Deal",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 900,
      currency: "EUR",
    });

    const lost = await changeDealStage(ctx, deal.id, { stageId: lostStage.id, lostReason: "Budget gestrichen" });
    expect(lost.status).toBe("LOST");
    expect(lost.lostReason).toBe("Budget gestrichen");
    expect(lost.probability).toBe(0);
  });

  it("summiert Dealwerte in der Liste", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);

    await createDeal(ctx, { name: "A", pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: 1000, currency: "EUR" });
    await createDeal(ctx, { name: "B", pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: 2500.5, currency: "EUR" });

    const list = await listDeals(ctx, { page: 1, pageSize: 25, sortDirection: "desc" });
    expect(list.total).toBe(2);
    expect(list.totalAmount).toBeCloseTo(3500.5, 2);
  });

  it("wechselt die Stage nur innerhalb derselben Pipeline", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);
    const other = await prisma.pipeline.create({
      data: {
        organizationId: ctx.organizationId,
        name: "Zweite Pipeline",
        stages: {
          create: [
            { organizationId: ctx.organizationId, key: "start", name: "Start", position: 0, probability: 10, type: "OPEN" },
            { organizationId: ctx.organizationId, key: "won", name: "Gewonnen", position: 1, probability: 100, type: "WON" },
            { organizationId: ctx.organizationId, key: "lost", name: "Verloren", position: 2, probability: 0, type: "LOST" },
          ],
        },
      },
      include: { stages: true },
    });

    const deal = await createDeal(ctx, {
      name: "Pipeline-Test",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 100,
      currency: "EUR",
    });

    await expect(changeDealStage(ctx, deal.id, { stageId: other.stages[0].id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("konvertiert einen Lead zu Kontakt, Unternehmen und Deal", async () => {
    const { ctx } = await createTestOrganization();
    const lead = await createLead(ctx, {
      firstName: "Lea",
      lastName: "Kandidat",
      email: "lea@kandidat.de",
      companyName: "Kandidat AG",
      status: "qualified",
      source: "Website",
    });

    const result = await convertLead(ctx, lead.id, { createDeal: true, dealAmount: 7500 });

    expect(result.contactId).toBeDefined();
    expect(result.companyId).toBeDefined();
    expect(result.dealId).toBeDefined();

    const contact = await getContact(ctx, result.contactId!);
    expect(contact.email).toBe("lea@kandidat.de");
    expect(contact.company?.id).toBe(result.companyId);

    const deal = await getDeal(ctx, result.dealId!);
    expect(deal.amount).toBe(7500);
    expect(deal.contacts.some((item) => item.id === result.contactId)).toBe(true);

    // A converted lead is frozen.
    await expect(updateLead(ctx, lead.id, { status: "new" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(convertLead(ctx, lead.id, { createDeal: false })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("validiert Leads ohne jede Kontaktangabe", async () => {
    const { ctx } = await createTestOrganization();
    await expect(createLead(ctx, { status: "new" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("verweigert unbekannte Lead-Status", async () => {
    const { ctx } = await createTestOrganization();
    await expect(createLead(ctx, { lastName: "Test", status: "gibt_es_nicht" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("führt Aufgaben durch ihren Lebenszyklus", async () => {
    const { ctx } = await createTestOrganization();
    const contact = await createContact(ctx, { firstName: "Task", lastName: "Bezug" });

    const task = await createTask(ctx, {
      title: "Angebot nachfassen",
      contactId: contact.id,
      dueAt: new Date(Date.now() - 86_400_000),
      status: "OPEN",
      priority: "HIGH",
    });
    expect(task.isOverdue).toBe(true);

    const overdue = await listTasks(ctx, { page: 1, pageSize: 10, view: "overdue" });
    expect(overdue.items.some((item) => item.id === task.id)).toBe(true);
    expect(overdue.counts.overdue).toBeGreaterThan(0);

    const done = await updateTask(ctx, task.id, { status: "COMPLETED" });
    expect(done.completedAt).not.toBeNull();
    expect(done.isOverdue).toBe(false);

    const timeline = await listActivities(ctx, { page: 1, pageSize: 20, contactId: contact.id });
    expect(timeline.items.some((item) => item.subject?.startsWith("Aufgabe erledigt"))).toBe(true);
  });

  it("bewahrt frühere Fassungen einer Notiz auf", async () => {
    const { ctx } = await createTestOrganization();
    const contact = await createContact(ctx, { firstName: "Notiz", lastName: "Test" });

    const note = await createNote(ctx, { body: "Erste Fassung", contactId: contact.id });
    await updateNote(ctx, note.id, "Zweite Fassung");

    const revisions = await prisma.noteRevision.findMany({ where: { noteId: note.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].body).toBe("Erste Fassung");

    const updated = await prisma.note.findUnique({ where: { id: note.id } });
    expect(updated?.body).toBe("Zweite Fassung");
    expect(updated?.editedAt).not.toBeNull();
  });

  it("aktualisiert lastActivityAt und nextActivityAt", async () => {
    const { ctx } = await createTestOrganization();
    const contact = await createContact(ctx, { firstName: "Aktiv", lastName: "Test" });

    await createActivity(ctx, { type: "CALL", subject: "Erstkontakt", contactId: contact.id });
    const startAt = new Date(Date.now() + 3 * 86_400_000);
    await createMeeting(ctx, {
      title: "Präsentation",
      startAt,
      endAt: new Date(startAt.getTime() + 3_600_000),
      contactId: contact.id,
    });

    const refreshed = await getContact(ctx, contact.id);
    expect(refreshed.lastActivityAt).not.toBeNull();
    expect(refreshed.nextActivityAt).not.toBeNull();
  });

  it("verweigert Aktivitäten ohne Verknüpfung", async () => {
    const { ctx } = await createTestOrganization();
    await expect(createActivity(ctx, { type: "CALL", subject: "Ohne Bezug" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("verweigert Termine mit Ende vor Beginn", async () => {
    const { ctx } = await createTestOrganization();
    const start = new Date();
    await expect(
      createMeeting(ctx, { title: "Falsch", startAt: start, endAt: new Date(start.getTime() - 1000) }),
    ).rejects.toBeDefined();
  });

  it("aktualisiert Dealwerte und protokolliert sie", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);
    const deal = await createDeal(ctx, {
      name: "Wertänderung",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 1000,
      currency: "EUR",
    });

    const updated = await updateDeal(ctx, deal.id, { amount: 4200 });
    expect(updated.amount).toBe(4200);

    const activity = await prisma.activity.findFirst({
      where: { dealId: deal.id, subject: { contains: "Dealwert geändert" } },
    });
    expect(activity).not.toBeNull();
  });

  it("aktualisiert Unternehmen und behält Beziehungen", async () => {
    const { ctx } = await createTestOrganization();
    const company = await createCompany(ctx, { name: "Alt GmbH" });
    await createContact(ctx, { firstName: "Verknüpft", lastName: "Kontakt", companyId: company.id });

    const updated = await updateCompany(ctx, company.id, { name: "Neu GmbH", industry: "Handel" });
    expect(updated.name).toBe("Neu GmbH");
    expect(updated.contacts).toHaveLength(1);

    const fetched = await getCompany(ctx, company.id);
    expect(fetched.industry).toBe("Handel");
  });
});

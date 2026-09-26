import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOrganization } from "./setup/factories";
import {
  changeProspectStage,
  createProspect,
  deleteProspect,
  getProspect,
  listProspects,
  updateProspect,
} from "@/server/services/acquisition/prospects";
import { intakeCandidates } from "@/server/services/acquisition/intake";
import { addSuppression, checkSuppression, removeSuppression } from "@/server/services/acquisition/suppression";
import { convertProspect, previewConversion } from "@/server/services/acquisition/conversion";
import {
  createProspectList,
  listProspectLists,
  prospectFilterWhere,
  setListMembers,
} from "@/server/services/acquisition/lists";
import { assertStageTransition } from "@/server/services/acquisition/lifecycle";
import { candidatesFromCsv } from "@/server/acquisition/providers/csv";
import { crmProvider } from "@/server/acquisition/providers/crm";
import { createCompany } from "@/server/services/companies";

const BASE = {
  companyName: "Nordlicht Fenstertechnik GmbH",
  domain: "nordlicht-fenster.test",
  city: "Kiel",
  industry: "Handwerk",
};

describe("Prospects", () => {
  it("legt einen Prospect mit dokumentierter Herkunft an", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, { ...BASE, email: "info@nordlicht-fenster.test", sourceKey: "manual" });

    expect(prospect.stage).toBe("NEW");
    expect(prospect.sourceKey).toBe("manual");
    expect(prospect.domain).toBe("nordlicht-fenster.test");
  });

  it("leitet die Domain aus der Adresse ab, wenn keine angegeben ist", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, {
      companyName: "Ohne Domain GmbH",
      email: "kontakt@ohne-domain.test",
      sourceKey: "manual",
    });
    expect(prospect.domain).toBe("ohne-domain.test");
  });

  it("verhindert eine Dublette über dieselbe Adresse", async () => {
    const { ctx } = await createTestOrganization();
    await createProspect(ctx, { ...BASE, email: "info@nordlicht-fenster.test" });

    await expect(
      createProspect(ctx, { companyName: "Anderer Name GmbH", email: "info@nordlicht-fenster.test" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lässt einen zweiten Ansprechpartner derselben Firma zu", async () => {
    const { ctx } = await createTestOrganization();
    await createProspect(ctx, { ...BASE, email: "erste@nordlicht-fenster.test" });
    const second = await createProspect(ctx, { ...BASE, email: "zweite@nordlicht-fenster.test" });
    expect(second.id).toBeTruthy();
  });

  it("prüft Stufenwechsel", async () => {
    expect(() => assertStageTransition("NEW", "QUALIFIED")).not.toThrow();
    expect(() => assertStageTransition("NEW", "MEETING")).toThrow();
    // Die Kontaktsperre gilt von überall.
    expect(() => assertStageTransition("IN_SEQUENCE", "DO_NOT_CONTACT")).not.toThrow();
    // „Übernommen" entsteht nur durch die Konvertierung.
    expect(() => assertStageTransition("INTERESTED", "CONVERTED")).toThrow();
    expect(() => assertStageTransition("CONVERTED", "RESEARCHING")).toThrow();
  });

  it("verlangt eine Begründung beim Aussortieren", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, BASE);

    await expect(changeProspectStage(ctx, prospect.id, { stage: "DISQUALIFIED" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const done = await changeProspectStage(ctx, prospect.id, {
      stage: "DISQUALIFIED",
      reason: "Kein Bedarf, Eigenfertigung",
    });
    expect(done.stage).toBe("DISQUALIFIED");
    expect(done.disqualifiedReason).toContain("Eigenfertigung");
  });

  it("hält Zeitstempel für den Funnel fest", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, BASE);
    const qualified = await changeProspectStage(ctx, prospect.id, { stage: "QUALIFIED" });
    expect(qualified.qualifiedAt).not.toBeNull();
  });
});

describe("Kontaktsperre", () => {
  it("sperrt eine Adresse und ihre Domain getrennt", async () => {
    const { ctx } = await createTestOrganization();
    await addSuppression(ctx, { scope: "EMAIL", value: "Nein@Beispiel.test", reason: "UNSUBSCRIBED" });

    expect((await checkSuppression(ctx.organizationId, "nein@beispiel.test")).blocked).toBe(true);
    expect((await checkSuppression(ctx.organizationId, "ja@beispiel.test")).blocked).toBe(false);

    await addSuppression(ctx, { scope: "DOMAIN", value: "beispiel.test", reason: "COMPLAINT" });
    expect((await checkSuppression(ctx.organizationId, "ja@beispiel.test")).blocked).toBe(true);
  });

  it("wirkt beim Anlegen sofort auf die Stufe", async () => {
    const { ctx } = await createTestOrganization();
    await addSuppression(ctx, { scope: "EMAIL", value: "gesperrt@nordlicht-fenster.test", reason: "UNSUBSCRIBED" });

    const prospect = await createProspect(ctx, { ...BASE, email: "gesperrt@nordlicht-fenster.test" });
    expect(prospect.stage).toBe("DO_NOT_CONTACT");
  });

  it("überlebt das Löschen des Prospects", async () => {
    const { ctx } = await createTestOrganization();
    await addSuppression(ctx, { scope: "EMAIL", value: "weg@beispiel.test", reason: "UNSUBSCRIBED" });
    const prospect = await createProspect(ctx, { companyName: "Weg GmbH", email: "weg@beispiel.test" });
    await prisma.prospect.update({ where: { id: prospect.id }, data: { stage: "NEW" } });
    await deleteProspect(ctx, prospect.id);

    // Ein erneuter Import darf die Adresse nicht wieder freigeben.
    expect((await checkSuppression(ctx.organizationId, "weg@beispiel.test")).blocked).toBe(true);
  });

  it("lässt sich wieder aufheben", async () => {
    const { ctx } = await createTestOrganization();
    const entry = await addSuppression(ctx, { scope: "EMAIL", value: "kurz@beispiel.test", reason: "MANUAL" });
    await removeSuppression(ctx, entry.id);
    expect((await checkSuppression(ctx.organizationId, "kurz@beispiel.test")).blocked).toBe(false);
  });
});

describe("Übernahme von Kandidaten", () => {
  it("zählt Anlage, Dubletten und Gesperrte getrennt", async () => {
    const { ctx } = await createTestOrganization();
    await addSuppression(ctx, { scope: "EMAIL", value: "gesperrt@dritte.test", reason: "UNSUBSCRIBED" });

    const result = await intakeCandidates(ctx, "csv", [
      { companyName: "Erste GmbH", email: "info@erste.test" },
      { companyName: "Erste GmbH nochmal", email: "info@erste.test" },
      { companyName: "Dritte GmbH", email: "gesperrt@dritte.test" },
      { companyName: "" },
    ]);

    expect(result.created).toBe(2);
    expect(result.duplicates).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("schreibt die Herkunft je Feld mit", async () => {
    const { ctx } = await createTestOrganization();
    const result = await intakeCandidates(ctx, "csv", [
      {
        companyName: "Herkunft GmbH",
        city: "Bremen",
        provenance: [
          { field: "companyName", reference: "kontakte.csv" },
          { field: "city", reference: "kontakte.csv" },
        ],
      },
    ]);

    const prospect = await getProspect(ctx, result.prospectIds[0]);
    expect(prospect.provenance).toHaveLength(2);
    expect(prospect.provenance.map((entry) => entry.field).sort()).toEqual(["city", "companyName"]);
    expect(prospect.provenance[0].sourceKey).toBe("csv");
  });

  it("liest Kandidaten aus einer Tabelle", () => {
    const csv = [
      "Firma,Ort,E-Mail",
      "Alpha GmbH,Hamburg,info@alpha.test",
      "Beta GmbH,Bremen,info@beta.test",
      ",Ohne Firma,info@ohne.test",
    ].join("\n");

    const { candidates, skipped } = candidatesFromCsv(
      csv,
      { Firma: "companyName", Ort: "city", "E-Mail": "email" },
      "quelle.csv",
    );

    expect(candidates).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(candidates[0].city).toBe("Hamburg");
    expect(candidates[0].provenance?.every((entry) => entry.reference === "quelle.csv")).toBe(true);
  });
});

describe("Listen", () => {
  it("führt Mitglieder einer statischen Liste", async () => {
    const { ctx } = await createTestOrganization();
    const list = await createProspectList(ctx, { name: "Messekontakte", kind: "STATIC" });
    const a = await createProspect(ctx, { companyName: "A GmbH", email: "a@a.test" });
    const b = await createProspect(ctx, { companyName: "B GmbH", email: "b@b.test" });

    await setListMembers(ctx, list.id, [a.id, b.id], "add");
    expect((await listProspectLists(ctx))[0].count).toBe(2);

    await setListMembers(ctx, list.id, [a.id], "remove");
    expect((await listProspectLists(ctx))[0].count).toBe(1);
  });

  it("berechnet eine dynamische Liste aus ihrem Filter", async () => {
    const { ctx } = await createTestOrganization();
    await createProspect(ctx, { companyName: "Kieler Werft GmbH", city: "Kiel", email: "a@werft.test" });
    await createProspect(ctx, { companyName: "Bremer Werft GmbH", city: "Bremen", email: "b@werft.test" });

    await createProspectList(ctx, {
      name: "Kiel",
      kind: "DYNAMIC",
      filter: { combinator: "AND", conditions: [{ field: "city", operator: "eq", value: "Kiel" }] },
    });

    const lists = await listProspectLists(ctx);
    expect(lists[0].count).toBe(1);
  });

  it("lehnt eine dynamische Liste ohne Filter ab", async () => {
    const { ctx } = await createTestOrganization();
    await expect(createProspectList(ctx, { name: "Ohne", kind: "DYNAMIC" })).rejects.toBeTruthy();
  });

  it("lehnt unbekannte Filterfelder ab", () => {
    expect(() =>
      prospectFilterWhere({ combinator: "AND", conditions: [{ field: "umsatz", operator: "eq", value: 1 }] }),
    ).toThrow();
  });

  it("verweigert das Ändern der Mitglieder einer dynamischen Liste", async () => {
    const { ctx } = await createTestOrganization();
    const list = await createProspectList(ctx, {
      name: "Dynamisch",
      kind: "DYNAMIC",
      filter: { combinator: "AND", conditions: [{ field: "city", operator: "eq", value: "Kiel" }] },
    });
    const prospect = await createProspect(ctx, { companyName: "X GmbH", email: "x@x.test" });

    await expect(setListMembers(ctx, list.id, [prospect.id], "add")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("Übernahme ins CRM", () => {
  it("erzeugt Unternehmen und Kontakt und behält die Herkunft", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, {
      ...BASE,
      firstName: "Malte",
      lastName: "Thiessen",
      email: "m.thiessen@nordlicht-fenster.test",
      jobTitle: "Geschäftsführung",
      sourceKey: "csv",
    });

    const result = await convertProspect(ctx, prospect.id, { createDeal: false });

    expect(result.companyId).toBeTruthy();
    expect(result.contactId).toBeTruthy();
    expect(result.reusedCompany).toBe(false);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: result.companyId } });
    expect(company.source).toBe("acquisition:csv");

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: result.contactId! } });
    expect(contact.lastName).toBe("Thiessen");
    expect(contact.companyId).toBe(company.id);

    // Der Prospect bleibt als Ursprung stehen und zeigt auf das Ergebnis.
    const after = await getProspect(ctx, prospect.id);
    expect(after.stage).toBe("CONVERTED");
    expect(after.company?.id).toBe(company.id);
    expect(after.convertedAt).not.toBeNull();
  });

  it("erkennt ein vorhandenes Unternehmen über die Domain", async () => {
    const { ctx } = await createTestOrganization();
    const existing = await createCompany(ctx, { name: "Nordlicht AG", domain: "nordlicht-fenster.test" });
    const prospect = await createProspect(ctx, { ...BASE, email: "neu@nordlicht-fenster.test" });

    const result = await convertProspect(ctx, prospect.id, { createDeal: false });
    expect(result.reusedCompany).toBe(true);
    expect(result.companyId).toBe(existing.id);
  });

  it("hängt gesendete Nachrichten um, statt sie zu kopieren", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, { ...BASE, email: "post@nordlicht-fenster.test" });

    await prisma.emailMessage.create({
      data: {
        organizationId: ctx.organizationId,
        direction: "OUTBOUND",
        status: "SENT",
        subject: "Kurze Frage zu Ihren Fenstern",
        bodyHtml: "<p>Guten Tag</p>",
        fromAddress: "vertrieb@okun.test",
        toAddresses: ["post@nordlicht-fenster.test"],
        prospectId: prospect.id,
      },
    });

    const result = await convertProspect(ctx, prospect.id, { createDeal: false });
    expect(result.movedMessages).toBe(1);

    const messages = await prisma.emailMessage.findMany({ where: { organizationId: ctx.organizationId } });
    // Genau eine Nachricht — keine zweite Chronik.
    expect(messages).toHaveLength(1);
    expect(messages[0].contactId).toBe(result.contactId);
    expect(messages[0].companyId).toBe(result.companyId);
    expect(messages[0].prospectId).toBe(prospect.id);
  });

  it("legt auf Wunsch einen Deal an", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, { ...BASE, email: "deal@nordlicht-fenster.test" });

    const result = await convertProspect(ctx, prospect.id, {
      createDeal: true,
      dealName: "Fensterwartung 2026",
      dealAmount: 18000,
    });

    expect(result.dealId).toBeTruthy();
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: result.dealId! } });
    expect(deal.name).toBe("Fensterwartung 2026");
    expect(Number(deal.amount)).toBe(18000);
    expect(deal.source).toBe("acquisition:manual");
  });

  it("verweigert die Übernahme bei Kontaktsperre", async () => {
    const { ctx } = await createTestOrganization();
    await addSuppression(ctx, { scope: "EMAIL", value: "nein@nordlicht-fenster.test", reason: "UNSUBSCRIBED" });
    const prospect = await createProspect(ctx, { ...BASE, email: "nein@nordlicht-fenster.test" });

    await expect(convertProspect(ctx, prospect.id, { createDeal: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("lässt sich nicht zweimal übernehmen", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, { ...BASE, email: "einmal@nordlicht-fenster.test" });
    await convertProspect(ctx, prospect.id, { createDeal: false });

    await expect(convertProspect(ctx, prospect.id, { createDeal: false })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("schützt einen übernommenen Prospect vor dem Löschen", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, { ...BASE, email: "bleibt@nordlicht-fenster.test" });
    await convertProspect(ctx, prospect.id, { createDeal: false });

    await expect(deleteProspect(ctx, prospect.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("sagt vorab, was die Übernahme tun würde", async () => {
    const { ctx } = await createTestOrganization();
    await createCompany(ctx, { name: "Schon da GmbH", domain: "schon-da.test" });
    const prospect = await createProspect(ctx, {
      companyName: "Schon da GmbH",
      domain: "schon-da.test",
      email: "neu@schon-da.test",
    });

    const preview = await previewConversion(ctx, prospect.id);
    expect(preview.existingCompany?.name).toBe("Schon da GmbH");
    expect(preview.existingContact).toBeNull();
    expect(preview.willCreateContact).toBe(true);
    expect(preview.alreadyConverted).toBe(false);
  });
});

describe("Quelle: eigener Bestand", () => {
  it("findet nur Unternehmen ohne offenen Deal", async () => {
    const { ctx } = await createTestOrganization();
    await createCompany(ctx, { name: "Ohne Chance GmbH", domain: "ohne-chance.test", city: "Lübeck" });

    const result = await crmProvider.search(ctx, { limit: 50 });
    expect(result.candidates.map((entry) => entry.companyName)).toContain("Ohne Chance GmbH");
    expect(result.candidates[0].provenance?.length).toBeGreaterThan(0);
  });
});

describe("Mandantentrennung", () => {
  it("hält Prospects, Listen und Sperren getrennt", async () => {
    const first = await createTestOrganization();
    const second = await createTestOrganization();

    const prospect = await createProspect(first.ctx, { ...BASE, email: "geheim@nordlicht-fenster.test" });
    await createProspectList(first.ctx, { name: "Nur hier", kind: "STATIC" });
    await addSuppression(first.ctx, { scope: "EMAIL", value: "gesperrt@erste.test", reason: "MANUAL" });

    expect((await listProspects(second.ctx, { page: 1, pageSize: 25 })).items).toHaveLength(0);
    expect(await listProspectLists(second.ctx)).toHaveLength(0);
    expect((await checkSuppression(second.ctx.organizationId, "gesperrt@erste.test")).blocked).toBe(false);

    await expect(getProspect(second.ctx, prospect.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateProspect(second.ctx, prospect.id, { city: "Fremd" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

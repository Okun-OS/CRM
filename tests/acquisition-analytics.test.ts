import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOrganization } from "./setup/factories";
import { createProspect } from "@/server/services/acquisition/prospects";
import { convertProspect } from "@/server/services/acquisition/conversion";
import { createSendingAccount } from "@/server/services/acquisition/sending-accounts";
import {
  acquisitionFunnel,
  attributionBySource,
  needsAttention,
} from "@/server/services/acquisition/analytics";
import type { ActorContext } from "@/lib/context";

/**
 * Die Auswertung der Akquise.
 *
 * Diese Zahlen stehen auf der Akquise-Übersicht und im Haupt-Dashboard. Eine
 * Kennzahl, die niemand nachgerechnet hat, ist eine Behauptung — deshalb prüft
 * jeder Test hier einen Wert gegen Datensätze, die er selbst angelegt hat.
 */
const DAY = 24 * 60 * 60 * 1000;

const ACCOUNT = {
  label: "Vertrieb",
  fromName: "Sabine Vogt",
  fromEmail: "vertrieb@okun.test",
  dailyLimit: 50,
  sendWindowStart: 8,
  sendWindowEnd: 18,
  sendDays: [1, 2, 3, 4, 5],
  timezone: "Europe/Berlin",
  minGapSeconds: 30,
  maxGapSeconds: 90,
};

/** Setzt die Stufenzeitpunkte direkt — die Auswertung liest genau diese Felder. */
async function markReached(prospectId: string, data: Record<string, Date | string>) {
  await prisma.prospect.update({ where: { id: prospectId }, data });
}

function withoutProspectAccess(ctx: ActorContext): ActorContext {
  return { ...ctx, permissions: ctx.permissions.filter((permission) => permission !== "prospects.read") };
}

describe("Akquise-Trichter", () => {
  it("zählt je Stufe nur Prospects, die sie tatsächlich erreicht haben", async () => {
    const { ctx } = await createTestOrganization();

    const a = await createProspect(ctx, { companyName: "Erreicht alles GmbH", email: "a@stufen.test" });
    const b = await createProspect(ctx, { companyName: "Nur angesprochen GmbH", email: "b@stufen.test" });
    await createProspect(ctx, { companyName: "Nur angelegt GmbH", email: "c@stufen.test" });

    await markReached(a.id, {
      qualifiedAt: new Date(),
      firstContactedAt: new Date(),
      repliedAt: new Date(),
      interestedAt: new Date(),
      meetingAt: new Date(),
    });
    await markReached(b.id, { qualifiedAt: new Date(), firstContactedAt: new Date() });

    const funnel = await acquisitionFunnel(ctx);

    expect(funnel.prospects).toBe(3);
    expect(funnel.qualified).toBe(2);
    expect(funnel.contacted).toBe(2);
    expect(funnel.replied).toBe(1);
    expect(funnel.positive).toBe(1);
    expect(funnel.meetings).toBe(1);
    // Ohne Übernahme gibt es keine Opportunity — nicht „vermutlich eine".
    expect(funnel.opportunities).toBe(0);
    expect(funnel.customers).toBe(0);
    expect(funnel.pipelineValue).toBe(0);
    expect(funnel.wonValue).toBe(0);
  });

  it("lässt Prospects außerhalb des Zeitraums weg", async () => {
    const { ctx } = await createTestOrganization();
    const alt = await createProspect(ctx, { companyName: "Von früher GmbH", email: "alt@zeitraum.test" });
    await prisma.prospect.update({
      where: { id: alt.id },
      data: { createdAt: new Date(Date.now() - 200 * DAY) },
    });
    await createProspect(ctx, { companyName: "Von heute GmbH", email: "neu@zeitraum.test" });

    expect((await acquisitionFunnel(ctx, 90)).prospects).toBe(1);
    expect((await acquisitionFunnel(ctx, 365)).prospects).toBe(2);
  });

  it("nimmt Pipeline und Umsatz aus den echten Deals, nicht aus einer Hochrechnung", async () => {
    const { ctx } = await createTestOrganization();

    const offen = await createProspect(ctx, { companyName: "Laeuft noch GmbH", email: "offen@deals.test" });
    const gewonnen = await createProspect(ctx, { companyName: "Ist Kunde GmbH", email: "kunde@deals.test" });

    const a = await convertProspect(ctx, offen.id, { createDeal: true, dealName: "Angebot A", dealAmount: 12000 });
    const b = await convertProspect(ctx, gewonnen.id, { createDeal: true, dealName: "Angebot B", dealAmount: 8000 });
    await prisma.deal.update({ where: { id: b.dealId! }, data: { status: "WON" } });

    const funnel = await acquisitionFunnel(ctx);

    expect(funnel.opportunities).toBe(2);
    expect(funnel.customers).toBe(1);
    // 12.000 offen, 8.000 gewonnen — der gewonnene Deal zählt nicht doppelt.
    expect(funnel.pipelineValue).toBe(12000);
    expect(funnel.wonValue).toBe(8000);
    expect(a.dealId).toBeTruthy();
  });

  it("zeigt keine Zahlen einer anderen Organisation", async () => {
    const eins = await createTestOrganization();
    const zwei = await createTestOrganization();

    await createProspect(eins.ctx, { companyName: "Nur bei eins GmbH", email: "eins@trennung.test" });
    await createProspect(eins.ctx, { companyName: "Auch bei eins GmbH", email: "eins2@trennung.test" });

    expect((await acquisitionFunnel(eins.ctx)).prospects).toBe(2);
    expect((await acquisitionFunnel(zwei.ctx)).prospects).toBe(0);
  });

  it("verweigert die Auswertung ohne prospects.read", async () => {
    const { ctx } = await createTestOrganization();
    const blind = withoutProspectAccess(ctx);

    await expect(acquisitionFunnel(blind)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(needsAttention(blind)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(attributionBySource(blind)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Was eine Entscheidung braucht", () => {
  it("meldet nichts, solange nichts liegen geblieben ist", async () => {
    const { ctx } = await createTestOrganization();
    await createProspect(ctx, { companyName: "Alles in Ordnung GmbH", email: "ruhig@attention.test" });

    expect(await needsAttention(ctx)).toEqual([]);
  });

  it("meldet eingegangene Antworten, die noch niemand gesichtet hat", async () => {
    const { ctx } = await createTestOrganization();
    const prospect = await createProspect(ctx, { companyName: "Hat geantwortet GmbH", email: "antwort@attention.test" });

    await prisma.emailMessage.create({
      data: {
        organizationId: ctx.organizationId,
        direction: "INBOUND",
        status: "RECEIVED",
        subject: "Re: Kurze Frage",
        bodyHtml: "<p>Klingt interessant.</p>",
        fromAddress: "antwort@attention.test",
        toAddresses: ["vertrieb@okun.test"],
        prospectId: prospect.id,
      },
    });

    const items = await needsAttention(ctx);
    const replies = items.find((item) => item.key === "replies");
    expect(replies?.count).toBe(1);
    expect(replies?.href).toBe("/outreach/inbox");

    // Nach der Sichtung verschwindet der Hinweis.
    await prisma.emailMessage.updateMany({
      where: { organizationId: ctx.organizationId, prospectId: prospect.id },
      data: { reviewedAt: new Date(), reviewedById: ctx.userId },
    });
    expect((await needsAttention(ctx)).some((item) => item.key === "replies")).toBe(false);
  });

  it("meldet Interessierte ohne Termin erst, wenn sie zwei Tage liegen", async () => {
    const { ctx } = await createTestOrganization();
    const frisch = await createProspect(ctx, { companyName: "Gerade eben GmbH", email: "frisch@attention.test" });
    await markReached(frisch.id, { stage: "INTERESTED", interestedAt: new Date() });

    expect((await needsAttention(ctx)).some((item) => item.key === "interested")).toBe(false);

    await markReached(frisch.id, { interestedAt: new Date(Date.now() - 3 * DAY) });
    const items = await needsAttention(ctx);
    expect(items.find((item) => item.key === "interested")?.count).toBe(1);
  });

  it("meldet ein pausiertes Versandkonto", async () => {
    const { ctx } = await createTestOrganization();
    const account = await createSendingAccount(ctx, ACCOUNT);

    expect((await needsAttention(ctx)).some((item) => item.key === "accounts")).toBe(false);

    await prisma.sendingAccount.update({ where: { id: account.id }, data: { status: "PAUSED" } });
    const items = await needsAttention(ctx);
    const accounts = items.find((item) => item.key === "accounts");
    expect(accounts?.count).toBe(1);
    expect(accounts?.tone).toBe("danger");
  });

  it("meldet qualifizierte Prospects ohne Ansprechpartner", async () => {
    const { ctx } = await createTestOrganization();
    const ohne = await createProspect(ctx, { companyName: "Kein Kontakt GmbH" });
    await markReached(ohne.id, { stage: "QUALIFIED", qualifiedAt: new Date() });

    const items = await needsAttention(ctx);
    expect(items.find((item) => item.key === "no-contact")?.count).toBe(1);
  });

  it("sieht die offenen Punkte einer anderen Organisation nicht", async () => {
    const eins = await createTestOrganization();
    const zwei = await createTestOrganization();
    const account = await createSendingAccount(eins.ctx, ACCOUNT);
    await prisma.sendingAccount.update({ where: { id: account.id }, data: { status: "ERROR" } });

    expect((await needsAttention(eins.ctx)).some((item) => item.key === "accounts")).toBe(true);
    expect(await needsAttention(zwei.ctx)).toEqual([]);
  });
});

describe("Herkunft", () => {
  it("gruppiert nach Quelle und rechnet den Umsatz der Quelle zu", async () => {
    const { ctx } = await createTestOrganization();

    await createProspect(ctx, { companyName: "Aus Tabelle GmbH", email: "a@herkunft.test", sourceKey: "csv" });
    const zweite = await createProspect(ctx, {
      companyName: "Auch aus Tabelle GmbH",
      email: "b@herkunft.test",
      sourceKey: "csv",
    });
    await createProspect(ctx, { companyName: "Von Hand GmbH", email: "c@herkunft.test", sourceKey: "manual" });

    const converted = await convertProspect(ctx, zweite.id, {
      createDeal: true,
      dealName: "Auftrag aus Tabelle",
      dealAmount: 5500,
    });
    await prisma.deal.update({ where: { id: converted.dealId! }, data: { status: "WON" } });

    const rows = await attributionBySource(ctx);
    const csv = rows.find((row) => row.sourceKey === "csv");
    const manual = rows.find((row) => row.sourceKey === "manual");

    expect(csv).toMatchObject({ prospects: 2, opportunities: 1, customers: 1, revenue: 5500 });
    // Ohne Übernahme kein Umsatz — die Quelle bekommt nichts zugerechnet.
    expect(manual).toMatchObject({ prospects: 1, opportunities: 0, customers: 0, revenue: 0 });
  });
});

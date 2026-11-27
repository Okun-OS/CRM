import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  mapMetaFields,
  pollMetaPage,
  processDueMetaLeads,
  processMetaLeadEvent,
  recordMetaWebhook,
} from "@/server/services/meta-leads";
import {
  connectMetaPages,
  getMetaOverview,
  importExistingMetaLeads,
  lookupMetaPages,
  noPagesMessage,
  retryMetaLeadEvent,
  sendMetaTestNotification,
  syncMetaPage,
  updateMetaPage,
} from "@/server/services/meta-settings";
import { GET as verifyWebhook, POST as postWebhook } from "@/app/api/integrations/meta/webhook/route";
import { deleteLead } from "@/server/services/leads";
import { createTestOrganization } from "./setup/factories";

/**
 * Meta Lead Ads: Formular-Einsendungen landen als Lead im CRM, und die
 * eingestellten Adressen bekommen eine E-Mail. Graph API und Resend sind
 * nachgebildet — es geht nichts nach draußen.
 */
const APP_SECRET = "meta-app-geheimnis-test";

type Call = { method: string; url: URL; body: string };
let calls: Call[] = [];
let leads: Record<string, unknown> = {};
let leadError: { status: number; body: unknown } | null = null;
let extendedFieldsRejected = false;

/** Was das nachgebildete Facebook-Konto hinter dem Nutzer-Token zeigt. */
type Account = {
  pages: { id: string; name: string; access_token?: string }[];
  permissions: { permission: string; status: string }[] | null;
  granularScopes: { scope: string; target_ids?: string[] }[] | null;
  businesses: string[];
  ownedPages: Record<string, { id: string; name: string }[]>;
  pageNodes: Record<string, { id: string; name?: string; access_token?: string }>;
};
let account: Account;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  leads = {};
  leadError = null;
  extendedFieldsRejected = false;
  account = {
    pages: [{ id: "PAGE1", name: "OKUN Systems", access_token: "SEITEN_TOKEN" }],
    permissions: null,
    granularScopes: null,
    businesses: [],
    ownedPages: {},
    pageNodes: {},
  };
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.META_WEBHOOK_VERIFY_TOKEN = "bestaetigung-123";
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "crm@okun.test";
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ method, url, body: typeof init.body === "string" ? init.body : "" });
    if (url.host === "api.resend.com") return json({ id: "re_1" });

    const path = url.pathname.replace(/^\/v[\d.]+\//, "");
    if (path === "oauth/access_token") return json({ access_token: "LANGLEBIG", token_type: "bearer" });
    if (path === "me/accounts") return json({ data: account.pages });
    if (path === "me/permissions" && account.permissions) return json({ data: account.permissions });
    if (path === "debug_token" && account.granularScopes) return json({ data: { is_valid: true, granular_scopes: account.granularScopes } });
    if (path === "me/businesses" && account.permissions) return json({ data: account.businesses.map((id) => ({ id })) });
    if (path.endsWith("/owned_pages") || path.endsWith("/client_pages")) {
      return json({ data: path.endsWith("/owned_pages") ? (account.ownedPages[path.split("/")[0]] ?? []) : [] });
    }
    if (account.pageNodes[path]) return json(account.pageNodes[path]);
    if (path.endsWith("/subscribed_apps")) return json({ success: true });
    if (path.startsWith("FORM")) return json({ id: path, name: "Rückruf anfordern" });
    if (leadError) return json(leadError.body, leadError.status);
    if (extendedFieldsRejected && url.searchParams.get("fields")?.includes("campaign_name")) {
      return json({ error: { message: "(#100) Tried accessing nonexisting field (campaign_name)", code: 100 } }, 400);
    }
    if (leads[path]) return json(leads[path]);
    return json({ error: { message: "Unknown path", code: 803 } }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ["META_APP_ID", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN", "RESEND_API_KEY", "MAIL_FROM"]) delete process.env[key];
});

async function connectedWorkspace() {
  const org = await createTestOrganization();
  // Seiten-IDs sind weltweit eindeutig — je Test eine eigene.
  const pageId = `PAGE${randomUUID().slice(0, 8)}`;
  calls = [];
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/me/accounts")) {
      calls.push({ method: "GET", url, body: "" });
      return json({ data: [{ id: pageId, name: "OKUN Systems", access_token: "SEITEN_TOKEN" }] });
    }
    return original(input, init);
  });
  await connectMetaPages(org.ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890", pageIds: [pageId] });
  const page = await prisma.metaLeadPage.findUniqueOrThrow({ where: { pageId } });
  return { ...org, pageId, page };
}

function leadPayload(pageId: string, leadgenId: string, formId = "FORM1") {
  return {
    object: "page",
    entry: [
      {
        id: pageId,
        time: 1_700_000_000,
        changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: formId, ad_id: "AD1", created_time: 1_700_000_000 } }],
      },
    ],
  };
}

function metaLead(leadgenId: string, fields: Record<string, string>, extra: Record<string, unknown> = {}) {
  leads[leadgenId] = {
    id: leadgenId,
    created_time: "2026-11-23T09:15:00+0000",
    form_id: "FORM1",
    ad_id: "AD1",
    ad_name: "Anzeige Rückruf",
    adset_name: "Gruppe Hamburg",
    campaign_name: "Herbstaktion 2026",
    platform: "ig",
    field_data: Object.entries(fields).map(([name, value]) => ({ name, values: [value] })),
    ...extra,
  };
}

function signed(body: string) {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

const resendMails = () => calls.filter((call) => call.url.host === "api.resend.com").map((call) => JSON.parse(call.body));

describe("Seite verbinden", () => {
  it("tauscht das Token, abonniert die Seite und speichert nur das Seiten-Token verschlüsselt", async () => {
    const { ctx } = await createTestOrganization();
    const found = await lookupMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890" });
    expect(found).toEqual({
      pages: [{ id: "PAGE1", name: "OKUN Systems", connected: false, connectedElsewhere: false }],
      missingPermissions: [],
    });
    expect(JSON.stringify(found)).not.toContain("SEITEN_TOKEN");

    await prisma.metaLeadPage.deleteMany({ where: { pageId: "PAGE1" } });
    await connectMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890", pageIds: ["PAGE1"] });
    const subscribe = calls.find((call) => call.url.pathname.endsWith("PAGE1/subscribed_apps"))!;
    const params = new URLSearchParams(subscribe.body);
    expect(params.get("subscribed_fields")).toBe("leadgen");
    expect(params.get("access_token")).toBe("SEITEN_TOKEN");
    expect(params.get("appsecret_proof")).toBe(createHmac("sha256", APP_SECRET).update("SEITEN_TOKEN").digest("hex"));
    // Die Seiten wurden mit dem getauschten, langlebigen Token abgefragt.
    expect(calls.find((call) => call.url.pathname.endsWith("me/accounts"))!.url.searchParams.get("access_token")).toBe("LANGLEBIG");

    const page = await prisma.metaLeadPage.findUniqueOrThrow({ where: { pageId: "PAGE1" } });
    expect(page.tokenCipher).not.toContain("SEITEN_TOKEN");
    expect(page).toMatchObject({ organizationId: ctx.organizationId, notifyEmails: [ctx.email], ownerId: ctx.userId });
    await prisma.metaLeadPage.delete({ where: { pageId: "PAGE1" } });
  });

  const ALL = ["leads_retrieval", "pages_manage_metadata", "pages_show_list", "pages_read_engagement", "pages_manage_ads", "ads_management", "business_management"];
  const granted = (...names: string[]) => names.map((permission) => ({ permission, status: "granted" }));

  it("findet Seiten eines Business-Portfolios, die me/accounts nicht liefert", async () => {
    const { ctx } = await createTestOrganization();
    const pageId = `PAGEB${randomUUID().slice(0, 8)}`;
    account.pages = [];
    account.permissions = granted(...ALL);
    account.businesses = ["BIZ1"];
    account.ownedPages = { BIZ1: [{ id: pageId, name: "OKUN im Portfolio" }] };
    account.pageNodes = { [pageId]: { id: pageId, name: "OKUN im Portfolio", access_token: "PORTFOLIO_SEITEN_TOKEN" } };

    const found = await lookupMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890" });
    expect(found).toEqual({ pages: [{ id: pageId, name: "OKUN im Portfolio", connected: false, connectedElsewhere: false }], missingPermissions: [] });

    await connectMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890", pageIds: [pageId] });
    const subscribe = calls.find((call) => call.url.pathname.endsWith(`${pageId}/subscribed_apps`))!;
    expect(new URLSearchParams(subscribe.body).get("access_token")).toBe("PORTFOLIO_SEITEN_TOKEN");
    await prisma.metaLeadPage.delete({ where: { pageId } });
  });

  it("fragt die beim Bestätigen gewählten Seiten direkt ab (granular_scopes)", async () => {
    const { ctx } = await createTestOrganization();
    account.pages = [];
    account.permissions = granted(...ALL.filter((name) => name !== "business_management"));
    account.granularScopes = [{ scope: "pages_show_list", target_ids: ["PAGEG"] }, { scope: "leads_retrieval", target_ids: ["PAGEG"] }];
    account.pageNodes = { PAGEG: { id: "PAGEG", name: "Gewählte Seite", access_token: "GEWAEHLT_TOKEN" } };

    const found = await lookupMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890" });
    expect(found.pages.map((page) => page.name)).toEqual(["Gewählte Seite"]);
    // debug_token geht mit dem App-Token, das eingefügte Token ist nur Gegenstand der Prüfung.
    const debug = calls.find((call) => call.url.pathname.endsWith("/debug_token"))!;
    expect(debug.url.searchParams.get("access_token")).toBe(`1234567890|${APP_SECRET}`);
    expect(debug.url.searchParams.get("input_token")).toBe("LANGLEBIG");
  });

  it("warnt, wenn dem Token eine Berechtigung für das Abholen fehlt", async () => {
    const { ctx } = await createTestOrganization();
    account.permissions = granted("pages_show_list", "pages_manage_metadata", "pages_read_engagement");
    const found = await lookupMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890" });
    expect(found.pages).toHaveLength(1);
    expect(found.missingPermissions).toEqual(["leads_retrieval", "pages_manage_ads", "ads_management"]);
  });

  it("sagt genau, warum keine Seite erreichbar ist", async () => {
    const { ctx } = await createTestOrganization();
    account.pages = [];
    account.permissions = granted(...ALL.filter((name) => name !== "business_management"));
    await expect(lookupMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890" })).rejects.toThrow(/business_management/);

    account.permissions = [...granted("leads_retrieval"), { permission: "pages_show_list", status: "declined" }];
    await expect(lookupMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890" })).rejects.toThrow(
      /pages_show_list abgelehnt.*Unternehmensintegrationen/,
    );

    // Seite sichtbar, aber ohne Seiten-Token: Die Person hat keinen vollen Zugriff.
    account.permissions = granted(...ALL);
    account.pages = [{ id: "PAGEX", name: "Fremde Seite" }];
    account.pageNodes = { PAGEX: { id: "PAGEX", name: "Fremde Seite" } };
    await expect(lookupMetaPages(ctx, { accessToken: "KURZLEBIGES_NUTZER_TOKEN_1234567890" })).rejects.toThrow(
      /sieht „Fremde Seite“, aber Meta gibt dafür kein Seiten-Token heraus/,
    );

    // Alles erlaubt, trotzdem nichts: Auswahl beim Bestätigen zurücksetzen.
    expect(noPagesMessage({ grant: { granted: ALL, declined: [], pageIds: [], businessIds: [] }, withoutToken: [] })).toMatch(
      /Unternehmensintegrationen die App entfernen/,
    );
    // me/permissions nicht lesbar: allgemeiner Hinweis statt Absturz.
    expect(noPagesMessage({ grant: null, withoutToken: [] })).toMatch(/keine Facebook-Seite erreichbar/);
  });
});

describe("Webhook", () => {
  it("bestätigt die Einrichtung nur mit dem richtigen Token", async () => {
    const ok = await verifyWebhook(
      new NextRequest("http://localhost/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=bestaetigung-123&hub.challenge=4711"),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("4711");
    const wrong = await verifyWebhook(
      new NextRequest("http://localhost/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=falsch&hub.challenge=4711"),
    );
    expect(wrong.status).toBe(403);
  });

  it("lehnt Meldungen ohne gültige Signatur ab", async () => {
    const { pageId } = await connectedWorkspace();
    const body = JSON.stringify(leadPayload(pageId, `L${randomUUID()}`));
    const response = await postWebhook(
      new NextRequest("http://localhost/api/integrations/meta/webhook", {
        method: "POST",
        body,
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
      }),
    );
    expect(response.status).toBe(401);
    expect(await prisma.metaLeadEvent.count({ where: { pageId } })).toBe(0);
  });

  it("legt aus einer Formular-Einsendung einen Lead an und verschickt die E-Mail", async () => {
    const { ctx, pageId, organization } = await connectedWorkspace();
    await updateMetaPage(ctx, (await prisma.metaLeadPage.findUniqueOrThrow({ where: { pageId } })).id, {
      notifyEmails: ["vertrieb@okun.test", "chef@okun.test"],
    });
    const leadgenId = `L${randomUUID()}`;
    metaLead(leadgenId, {
      full_name: "Erika Musterfrau",
      email: "Erika@Beispiel.de",
      phone_number: "+49 30 1234567",
      company_name: "Beispiel GmbH",
      "wann_dürfen_wir_anrufen?": "Vormittags",
    });

    const body = JSON.stringify(leadPayload(pageId, leadgenId));
    const response = await postWebhook(
      new NextRequest("http://localhost/api/integrations/meta/webhook", { method: "POST", body, headers: { "x-hub-signature-256": signed(body) } }),
    );
    expect(response.status).toBe(200);
    await vi.waitFor(async () => {
      const event = await prisma.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId } });
      expect(event.status).toBe("CREATED");
    }, { timeout: 15_000, interval: 100 });

    const event = await prisma.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId } });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: event.leadId! } });
    expect(lead).toMatchObject({
      organizationId: organization.id,
      firstName: "Erika",
      lastName: "Musterfrau",
      email: "erika@beispiel.de",
      phone: "+49 30 1234567",
      companyName: "Beispiel GmbH",
      source: "Meta Lead Ads (Instagram)",
      status: "new",
      ownerId: ctx.userId,
    });
    const note = await prisma.note.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(note.body).toContain("Instagram-Formular „Rückruf anfordern“");
    // Nach einem Fragezeichen kein Doppelpunkt.
    expect(note.body).toContain("Wann dürfen wir anrufen? Vormittags");
    expect(note.body).toContain("Kampagne: Herbstaktion 2026");
    expect(await prisma.notification.count({ where: { userId: ctx.userId, type: "LEAD_RECEIVED", entityId: lead.id } })).toBe(1);

    const mails = resendMails();
    expect(mails.map((mail) => mail.to[0]).sort()).toEqual(["chef@okun.test", "vertrieb@okun.test"]);
    expect(mails[0].subject).toBe("Neuer Lead: Erika Musterfrau");
    expect(mails[0].html).toContain(`/leads/${lead.id}`);
    expect(mails[0].html).toContain("tel:+49301234567");
    expect(mails[0].text).toContain("Kampagne: Herbstaktion 2026");
    expect(event.summary).toMatchObject({ name: "Erika Musterfrau", emailSent: true, campaignName: "Herbstaktion 2026" });
  });

  it("legt dieselbe Einsendung nie doppelt an, auch wenn Meta sie mehrfach meldet", async () => {
    const { pageId, organization } = await connectedWorkspace();
    const leadgenId = `L${randomUUID()}`;
    metaLead(leadgenId, { full_name: "Max Doppelt", email: "max@doppelt.de" });
    const first = await recordMetaWebhook(leadPayload(pageId, leadgenId));
    const second = await recordMetaWebhook(leadPayload(pageId, leadgenId));
    expect(first.recorded).toHaveLength(1);
    expect(second).toEqual({ recorded: [], ignored: 1 });
    await processMetaLeadEvent(first.recorded[0]);
    expect(await prisma.lead.count({ where: { organizationId: organization.id, email: "max@doppelt.de" } })).toBe(1);
  });

  it("hängt eine erneute Anfrage derselben Person an den offenen Lead", async () => {
    const { pageId } = await connectedWorkspace();
    const email = `wieder-${randomUUID().slice(0, 6)}@kunde.de`;
    const firstId = `L${randomUUID()}`;
    const secondId = `L${randomUUID()}`;
    metaLead(firstId, { full_name: "Wieder Holer", email });
    metaLead(secondId, { full_name: "Wieder Holer", email, "budget": "10.000 €" });

    const a = await processMetaLeadEvent((await recordMetaWebhook(leadPayload(pageId, firstId))).recorded[0]);
    const b = await processMetaLeadEvent((await recordMetaWebhook(leadPayload(pageId, secondId))).recorded[0]);
    expect(a?.status).toBe("CREATED");
    expect(b).toMatchObject({ status: "MERGED", leadId: a?.leadId });
    expect(await prisma.lead.count({ where: { email } })).toBe(1);
    expect(await prisma.note.count({ where: { leadId: a!.leadId } })).toBe(2);
    expect(resendMails().map((mail) => mail.subject)).toEqual(["Neuer Lead: Wieder Holer", "Erneute Anfrage: Wieder Holer"]);
  });

  it("übergeht Meldungen für Seiten, die nicht verbunden sind", async () => {
    expect(await recordMetaWebhook(leadPayload("FREMDE_SEITE", `L${randomUUID()}`))).toEqual({ recorded: [], ignored: 1 });
  });
});

describe("Fehler und Wiederholung", () => {
  it("merkt sich einen Fehler, versucht es später erneut und legt den Lead dann an", async () => {
    const { ctx, pageId } = await connectedWorkspace();
    const leadgenId = `L${randomUUID()}`;
    metaLead(leadgenId, { full_name: "Spät Ankommer", email: "spaet@kunde.de" });
    leadError = { status: 400, body: { error: { message: "Error validating access token", code: 190 } } };

    const { recorded } = await recordMetaWebhook(leadPayload(pageId, leadgenId));
    expect(await processMetaLeadEvent(recorded[0])).toBeNull();
    const failed = await prisma.metaLeadEvent.findUniqueOrThrow({ where: { id: recorded[0] } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(failed.error).toContain("Zugriffstoken ist ungültig");
    expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.metaLeadPage.findUniqueOrThrow({ where: { pageId } })).lastError).toContain("neu verbinden");

    // Vor dem nächsten Termin passiert nichts …
    expect(await processMetaLeadEvent(recorded[0])).toBeNull();
    // … danach klappt es.
    leadError = null;
    await processDueMetaLeads(50, new Date(Date.now() + 2 * 60_000));
    expect((await prisma.metaLeadEvent.findUniqueOrThrow({ where: { id: recorded[0] } })).status).toBe("CREATED");
    expect((await prisma.metaLeadPage.findUniqueOrThrow({ where: { pageId } })).lastError).toBeNull();

    // Ein manueller Neuversuch auf etwas schon Angelegtes wird abgelehnt.
    await expect(retryMetaLeadEvent(ctx, recorded[0])).rejects.toThrow("bereits angelegt");
  });

  it("verzichtet auf Kampagnenfelder, wenn Meta sie ablehnt", async () => {
    const { pageId } = await connectedWorkspace();
    const leadgenId = `L${randomUUID()}`;
    metaLead(leadgenId, { full_name: "Ohne Kampagne", email: "ohne@kampagne.de" });
    extendedFieldsRejected = true;
    const outcome = await processMetaLeadEvent((await recordMetaWebhook(leadPayload(pageId, leadgenId))).recorded[0]);
    expect(outcome?.status).toBe("CREATED");
  });
});

describe("Zuordnung der Formularfelder", () => {
  it("erkennt eigene Fragen auf Deutsch und macht Antwortoptionen lesbar", () => {
    expect(
      mapMetaFields([
        { name: "was_möchten_sie_in_ihrem_unternehmen_verbessern?", values: ["zeit_im_arbeitsalltag_sparen"] },
        { name: "telefonnummer", values: ["+4368864111317"] },
        { name: "vollständiger_name", values: ["Wardak Ajmal"] },
        {
          name: "was_trifft_auf_ihr_unternehmen_zu?",
          values: ["viele_abläufe_laufen_noch_manuell", "wir_möchten_ki_einsetzen,_wissen_aber_nicht_wo"],
        },
        { name: "e-mail-adresse", values: ["wardak@example.com"] },
      ]),
    ).toEqual({
      firstName: "Wardak",
      lastName: "Ajmal",
      email: "wardak@example.com",
      phone: "+4368864111317",
      companyName: null,
      jobTitle: null,
      answers: [
        { label: "Was möchten sie in ihrem unternehmen verbessern?", value: "Zeit im arbeitsalltag sparen" },
        {
          label: "Was trifft auf ihr unternehmen zu?",
          value: "Viele abläufe laufen noch manuell, Wir möchten ki einsetzen, wissen aber nicht wo",
        },
      ],
    });
  });

  it("ordnet frei formulierte Fragen nur zu, wenn die Antwort passt", () => {
    const mapped = mapMetaFields([
      { name: "Wie lautet Ihre Handynummer?", values: ["0170 1234567"] },
      { name: "nutzen_sie_schon_ein_telefonsystem?", values: ["ja"] },
      { name: "Ihr Vorname", values: ["Lea"] },
      { name: "Nachname", values: ["Muster"] },
      { name: "Firmenname", values: ["Muster GmbH"] },
      { name: "kontakt", values: ["lea@muster.de"] },
    ]);
    expect(mapped).toMatchObject({
      firstName: "Lea",
      lastName: "Muster",
      phone: "0170 1234567",
      companyName: "Muster GmbH",
      // Keine E-Mail-Frage erkannt, aber genau eine Antwort ist eine Adresse.
      email: "lea@muster.de",
      answers: [{ label: "Nutzen sie schon ein telefonsystem?", value: "ja" }],
    });
  });

  it("erkennt Standardfragen und hält alles andere als Antwort fest", () => {
    expect(
      mapMetaFields([
        { name: "full_name", values: ["Anna Maria Beispiel"] },
        { name: "email", values: ["keine-adresse"] },
        { name: "job_title", values: ["Einkauf"] },
        { name: "city", values: ["Hamburg"] },
        { name: "welche_leistung", values: ["Wartung", "Montage"] },
      ]),
    ).toEqual({
      firstName: "Anna Maria",
      lastName: "Beispiel",
      email: null,
      phone: null,
      companyName: null,
      jobTitle: "Einkauf",
      answers: [
        { label: "E-Mail", value: "keine-adresse" },
        { label: "Ort", value: "Hamburg" },
        { label: "Welche leistung", value: "Wartung, Montage" },
      ],
    });
  });
});

describe("Test-E-Mail", () => {
  it("schickt eine gekennzeichnete Probe an die Empfänger", async () => {
    const { ctx, page } = await connectedWorkspace();
    const result = await sendMetaTestNotification(ctx, page.id);
    expect(result.sent).toBe(true);
    expect(resendMails()[0].subject).toBe("[Test] Neuer Lead: Erika Musterfrau");
  });
});

describe("Bestehende Leads importieren", () => {
  /** Zwei Formulare, eines mit zwei Seiten; eine Person hat in beiden geantwortet. */
  function stubForms(pageId: string, options: { formsUnavailable?: boolean } = {}) {
    const original = globalThis.fetch;
    const lead = (id: string, name: string, email: string, created: string) => ({
      id,
      created_time: created,
      form_id: id.startsWith("A") ? "111111" : "222222",
      platform: "fb",
      field_data: [
        { name: "full_name", values: [name] },
        { name: "email", values: [email] },
      ],
    });
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace(/^\/v[\d.]+\//, "");
      if (path === `${pageId}/leadgen_forms`) {
        calls.push({ method: "GET", url, body: "" });
        if (options.formsUnavailable) return json({ error: { message: "(#100) Unsupported get request", code: 100 } }, 400);
        return json({ data: [{ id: "111111", name: "Rückruf" }, { id: "222222", name: "Angebot" }] });
      }
      if (path === "111111/leads") {
        calls.push({ method: "GET", url, body: "" });
        return url.searchParams.get("after")
          ? json({ data: [lead(`A2-${pageId}`, "Bernd Zwei", `bernd-${pageId}@kunde.de`, "2026-08-02T10:00:00+0000")] })
          : json({
              data: [lead(`A1-${pageId}`, "Anna Eins", `anna-${pageId}@kunde.de`, "2026-08-01T09:00:00+0000")],
              paging: { cursors: { after: "WEITER" }, next: "https://graph.facebook.com/next" },
            });
      }
      if (path === "222222/leads") {
        calls.push({ method: "GET", url, body: "" });
        return json({ data: [lead(`B1-${pageId}`, "Anna Eins", `anna-${pageId}@kunde.de`, "2026-09-15T12:00:00+0000")] });
      }
      if (path === "111111" || path === "222222") return json({ id: path, name: path === "111111" ? "Rückruf" : "Angebot" });
      return original(input, init);
    });
  }

  it("übernimmt alle Einsendungen ohne Einzel-E-Mail, mit Eingangsdatum und Abschlussmeldung", async () => {
    const { ctx, page, pageId, organization } = await connectedWorkspace();
    stubForms(pageId);
    calls = [];

    const result = await importExistingMetaLeads(ctx, page.id, {});
    expect(result).toMatchObject({ found: 3, added: 3, alreadyKnown: 0, limited: false });
    expect(result.forms).toEqual([
      { id: "111111", name: "Rückruf", found: 2, added: 2, completed: 0, restored: 0 },
      { id: "222222", name: "Angebot", found: 1, added: 1, completed: 0, restored: 0 },
    ]);

    await vi.waitFor(
      async () => {
        expect(await prisma.notification.count({ where: { userId: ctx.userId, type: "IMPORT_COMPLETED", organizationId: organization.id } })).toBe(1);
      },
      { timeout: 15_000, interval: 100 },
    );

    const leads = await prisma.lead.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: "asc" } });
    expect(leads.map((lead) => [lead.firstName, lead.lastName, lead.createdAt.toISOString()])).toEqual([
      ["Anna", "Eins", "2026-08-01T09:00:00.000Z"],
      ["Bernd", "Zwei", "2026-08-02T10:00:00.000Z"],
    ]);
    // Annas zweite Einsendung hängt an ihrem Lead statt einen zweiten anzulegen.
    expect(await prisma.note.count({ where: { leadId: leads[0].id } })).toBe(2);
    expect(resendMails()).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: ctx.userId, type: "LEAD_RECEIVED", organizationId: organization.id } })).toBe(0);
    const summary = await prisma.notification.findFirstOrThrow({ where: { userId: ctx.userId, type: "IMPORT_COMPLETED", organizationId: organization.id } });
    expect(summary.body).toBe("2 neu angelegt, 1 zu offenen Leads hinzugefügt");
    expect(await prisma.metaLeadEvent.count({ where: { organizationId: organization.id, rawLead: { not: Prisma.DbNull } } })).toBe(0);

    // Ein zweiter Import findet dieselben Einsendungen und übernimmt nichts doppelt.
    const again = await importExistingMetaLeads(ctx, page.id, {});
    expect(again).toMatchObject({ found: 3, added: 0, alreadyKnown: 3, completed: 0 });
  });

  it("ergänzt beim erneuten Import Angaben, die beim ersten Mal nicht erkannt wurden — ohne Handänderungen zu überschreiben", async () => {
    const { ctx, page, pageId, organization } = await connectedWorkspace();
    stubForms(pageId);
    await importExistingMetaLeads(ctx, page.id, {});
    await vi.waitFor(
      async () => {
        expect(await prisma.notification.count({ where: { userId: ctx.userId, type: "IMPORT_COMPLETED", organizationId: organization.id } })).toBe(1);
      },
      { timeout: 15_000, interval: 100 },
    );
    const [anna, bernd] = await prisma.lead.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: "asc" } });

    // So sahen Leads aus, deren Fragen eine frühere Version nicht kannte …
    await prisma.lead.update({ where: { id: anna.id }, data: { firstName: null, lastName: "Unbekannt", email: null } });
    // … und hier hat jemand den Namen schon von Hand eingetragen.
    await prisma.lead.update({ where: { id: bernd.id }, data: { firstName: null, lastName: "Zwei-Handschrift", email: null } });

    const again = await importExistingMetaLeads(ctx, page.id, {});
    expect(again).toMatchObject({ added: 0, completed: 2 });
    const after = await prisma.lead.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: "asc" } });
    expect(after.map((lead) => [lead.firstName, lead.lastName, lead.email])).toEqual([
      ["Anna", "Eins", `anna-${pageId}@kunde.de`.toLowerCase()],
      [null, "Zwei-Handschrift", `bernd-${pageId}@kunde.de`.toLowerCase()],
    ]);

    // Ein dritter Lauf hat nichts mehr zu ergänzen.
    expect(await importExistingMetaLeads(ctx, page.id, {})).toMatchObject({ completed: 0 });
  });

  it("legt gelöschte Leads nur auf ausdrücklichen Wunsch neu an", async () => {
    const { ctx, page, pageId, organization } = await connectedWorkspace();
    stubForms(pageId);
    const summaries = () => prisma.notification.count({ where: { userId: ctx.userId, type: "IMPORT_COMPLETED", organizationId: organization.id } });
    await importExistingMetaLeads(ctx, page.id, {});
    await vi.waitFor(async () => expect(await summaries()).toBe(1), { timeout: 15_000, interval: 100 });

    // Annas Lead (zwei Einsendungen) wird gelöscht.
    const anna = await prisma.lead.findFirstOrThrow({ where: { organizationId: organization.id, lastName: "Eins" } });
    await deleteLead(ctx, anna.id);

    // Ohne Haken bleibt er gelöscht — die Oberfläche weist darauf hin.
    const skipped = await importExistingMetaLeads(ctx, page.id, {});
    expect(skipped).toMatchObject({ found: 3, added: 0, restored: 0, deleted: 2, alreadyKnown: 3 });
    expect(await prisma.lead.count({ where: { organizationId: organization.id, deletedAt: null } })).toBe(1);

    // Mit Haken entsteht er neu, beide Einsendungen wieder an einem Lead.
    const restored = await importExistingMetaLeads(ctx, page.id, { restoreDeleted: true });
    expect(restored).toMatchObject({ found: 3, added: 0, restored: 2, deleted: 0, alreadyKnown: 1 });
    await vi.waitFor(async () => expect(await summaries()).toBe(2), { timeout: 15_000, interval: 100 });
    const live = await prisma.lead.findMany({ where: { organizationId: organization.id, deletedAt: null }, orderBy: { createdAt: "asc" } });
    expect(live.map((lead) => [lead.firstName, lead.lastName, lead.createdAt.toISOString()])).toEqual([
      ["Anna", "Eins", "2026-08-01T09:00:00.000Z"],
      ["Bernd", "Zwei", "2026-08-02T10:00:00.000Z"],
    ]);
    expect(live[0].id).not.toBe(anna.id);
    expect(await prisma.note.count({ where: { leadId: live[0].id } })).toBe(2);
    expect(resendMails()).toHaveLength(0);

    // Danach ist alles wieder „schon im CRM“.
    expect(await importExistingMetaLeads(ctx, page.id, { restoreDeleted: true })).toMatchObject({ added: 0, restored: 0, deleted: 0 });
  });

  it("grenzt auf einen Zeitraum ein und fragt nach der Formular-ID, wenn Meta die Liste verweigert", async () => {
    const { ctx, page, pageId } = await connectedWorkspace();
    stubForms(pageId, { formsUnavailable: true });

    await expect(importExistingMetaLeads(ctx, page.id, {})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { fields: { formIds: expect.any(String) } },
    });

    calls = [];
    const result = await importExistingMetaLeads(ctx, page.id, { formIds: ["222222"], since: "2026-09-01" });
    expect(result).toMatchObject({ found: 1, added: 1, forms: [{ id: "222222", name: "Angebot", found: 1, added: 1 }] });
    const request = calls.find((call) => call.url.pathname.endsWith("222222/leads"))!;
    expect(JSON.parse(request.url.searchParams.get("filtering")!)).toEqual([
      { field: "time_created", operator: "GREATER_THAN", value: Math.floor(new Date("2026-09-01").getTime() / 1000) },
    ]);
  });
});

describe("Eigener Abgleich mit Meta", () => {
  /** Ein aktives und ein archiviertes Formular; im aktiven eine frische und eine alte Einsendung. */
  function stubPoll(pageId: string, options: { formsUnavailable?: boolean } = {}) {
    const original = globalThis.fetch;
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString().replace(".000Z", "+0000");
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace(/^\/v[\d.]+\//, "");
      if (path === `${pageId}/leadgen_forms`) {
        calls.push({ method: "GET", url, body: "" });
        if (options.formsUnavailable) return json({ error: { message: "(#100) Unsupported get request", code: 100 } }, 400);
        return json({
          data: [
            { id: "777001", name: "Hochpreisleadquelle", status: "ACTIVE" },
            { id: "777002", name: "Altes Formular", status: "ARCHIVED" },
          ],
        });
      }
      if (path === "777001/leads") {
        calls.push({ method: "GET", url, body: "" });
        return json({
          data: [
            {
              id: `P-NEU-${pageId}`,
              created_time: minutesAgo(10),
              form_id: "777001",
              platform: "fb",
              field_data: [
                { name: "vollständiger_name", values: ["Wardak Ajmal"] },
                { name: "e-mail-adresse", values: [`wardak-${pageId}@example.com`] },
                { name: "telefonnummer", values: ["+4368864111317"] },
              ],
            },
            {
              id: `P-ALT-${pageId}`,
              created_time: minutesAgo(3 * 24 * 60),
              form_id: "777001",
              platform: "fb",
              field_data: [{ name: "full_name", values: ["Olaf Alt"] }, { name: "email", values: [`olaf-${pageId}@example.com`] }],
            },
          ],
        });
      }
      if (path === "777002/leads") {
        calls.push({ method: "GET", url, body: "" });
        return json({ data: [] });
      }
      return original(input, init);
    });
  }

  it("holt neue Einsendungen selbst ab, mit E-Mail nur für frische, und fragt höchstens alle 5 Minuten", async () => {
    const { pageId, page, organization } = await connectedWorkspace();
    stubPoll(pageId);
    calls = [];

    const first = await pollMetaPage(page.id);
    expect(first).toEqual({ polled: true, found: 2, added: 2, error: null });
    // Nur aktive Formulare, ab dem Verbinden (mit 15 Minuten Überlappung).
    expect(calls.some((call) => call.url.pathname.endsWith("777002/leads"))).toBe(false);
    const request = calls.find((call) => call.url.pathname.endsWith("777001/leads"))!;
    expect(JSON.parse(request.url.searchParams.get("filtering")!)[0].value).toBe(Math.floor((page.createdAt.getTime() - 15 * 60_000) / 1000));

    const events = await prisma.metaLeadEvent.findMany({ where: { pageId }, orderBy: { leadgenId: "asc" } });
    expect(events.map((event) => [event.leadgenId, event.origin])).toEqual([
      [`P-ALT-${pageId}`, "import"],
      [`P-NEU-${pageId}`, "poll"],
    ]);
    for (const event of events) await processMetaLeadEvent(event.id);

    const leads = await prisma.lead.findMany({ where: { organizationId: organization.id }, orderBy: { lastName: "asc" } });
    expect(leads.map((lead) => [lead.firstName, lead.lastName, lead.phone])).toEqual([
      ["Wardak", "Ajmal", "+4368864111317"],
      ["Olaf", "Alt", null],
    ]);
    // E-Mail und Glocke nur für die frische Einsendung.
    expect(resendMails().map((mail) => mail.subject)).toEqual(["Neuer Lead: Wardak Ajmal"]);
    expect(await prisma.notification.count({ where: { organizationId: organization.id, type: "LEAD_RECEIVED" } })).toBe(1);

    // Innerhalb von 5 Minuten fragt der Worker nicht erneut.
    calls = [];
    expect(await pollMetaPage(page.id)).toMatchObject({ polled: false });
    expect(calls).toHaveLength(0);
    // Erzwungen schon — Bekanntes wird nicht doppelt angelegt.
    expect(await pollMetaPage(page.id, new Date(), { force: true })).toMatchObject({ polled: true, found: 2, added: 0 });
    const after = await prisma.metaLeadPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(after.lastPolledAt).not.toBeNull();
  });

  it("„Jetzt abgleichen“ legt Gefundenes sofort an; gelöschte Leads bleiben gelöscht", async () => {
    const { ctx, pageId, page, organization } = await connectedWorkspace();
    stubPoll(pageId);
    expect(await syncMetaPage(ctx, page.id)).toEqual({ found: 2, added: 2, created: 2 });
    expect(await prisma.lead.count({ where: { organizationId: organization.id, deletedAt: null } })).toBe(2);

    const wardak = await prisma.lead.findFirstOrThrow({ where: { organizationId: organization.id, lastName: "Ajmal" } });
    await deleteLead(ctx, wardak.id);
    expect(await syncMetaPage(ctx, page.id)).toEqual({ found: 2, added: 0, created: 0 });
    expect(await prisma.lead.count({ where: { organizationId: organization.id, deletedAt: null } })).toBe(1);
  });

  it("nimmt die bekannten Formulare, wenn Meta die Liste verweigert, und meldet Fehler an der Seite", async () => {
    const { pageId, page } = await connectedWorkspace();
    stubPoll(pageId, { formsUnavailable: true });
    // Ohne bekanntes Formular gibt es nichts zu fragen.
    expect(await pollMetaPage(page.id)).toEqual({ polled: true, found: 0, added: 0, error: null });

    await prisma.metaLeadEvent.create({
      data: { organizationId: page.organizationId, pageId, leadgenId: `ALT-${pageId}`, formId: "777001", status: "CREATED", origin: "import" },
    });
    expect(await pollMetaPage(page.id, new Date(), { force: true })).toMatchObject({ polled: true, found: 2, added: 2 });

    // Token entzogen: Fehler an der Seite, kein Absturz.
    vi.stubGlobal("fetch", async () => json({ error: { message: "Error validating access token", code: 190 } }, 400));
    const failed = await pollMetaPage(page.id, new Date(), { force: true });
    expect(failed.error).toMatch(/Zugriffstoken ist ungültig/);
    const after = await prisma.metaLeadPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(after.lastError).toMatch(/^Abgleich mit Meta:/);

    // Klappt es wieder, verschwindet der Fehler.
    stubPoll(pageId);
    expect(await pollMetaPage(page.id, new Date(), { force: true })).toMatchObject({ error: null });
    expect((await prisma.metaLeadPage.findUniqueOrThrow({ where: { id: page.id } })).lastError).toBeNull();
  });

  it("merkt sich, wann Meta zuletzt per Webhook gemeldet hat, und zeigt, ob E-Mails rausgehen", async () => {
    const { ctx, pageId, page } = await connectedWorkspace();
    expect((await getMetaOverview(ctx)).pages.find((entry) => entry.id === page.id)).toMatchObject({ lastWebhookAt: null });
    await recordMetaWebhook(leadPayload(pageId, `L${randomUUID()}`));
    const overview = await getMetaOverview(ctx);
    expect(overview.pages.find((entry) => entry.id === page.id)!.lastWebhookAt).not.toBeNull();
    expect(overview.mail).toEqual({ ready: true, reason: null });

    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    const withoutMail = await getMetaOverview(ctx);
    expect(withoutMail.mail.ready).toBe(false);
    expect(withoutMail.mail.reason).toMatch(/Postausgang/);
  });
});

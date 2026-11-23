import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta Graph API für Lead Ads — nur das, was der Lead-Eingang braucht.
 *
 * Ohne SDK: ein paar GET/POST-Aufrufe mit Seiten-Token. Ist ein App-Geheimnis
 * gesetzt, geht jeder Aufruf mit `appsecret_proof` raus (empfohlen von Meta
 * und Pflicht, wenn in der App „Require App Secret“ aktiv ist).
 *
 * Konfiguration auf Railway: META_APP_ID, META_APP_SECRET,
 * META_WEBHOOK_VERIFY_TOKEN; optional META_GRAPH_VERSION.
 */
const GRAPH_HOST = "https://graph.facebook.com";
const TIMEOUT_MS = 15_000;

/** Berechtigungen, die das Zugriffstoken braucht (laut Meta-Doku zu Lead Ads). */
export const META_REQUIRED_PERMISSIONS = [
  "leads_retrieval",
  "pages_manage_metadata",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "ads_management",
] as const;

/**
 * Zusätzlich nötig, wenn die Seite einem Business-Portfolio gehört: Ohne diese
 * Berechtigung liefert Meta solche Seiten nicht unter `me/accounts`.
 */
export const META_BUSINESS_PERMISSION = "business_management";

export function metaGraphVersion(): string {
  return process.env.META_GRAPH_VERSION?.trim() || "v27.0";
}

export function metaConfig() {
  return {
    appId: process.env.META_APP_ID?.trim() || null,
    appSecret: process.env.META_APP_SECRET?.trim() || null,
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null,
  };
}

/** Welche Variablen fehlen — für die Einstellungsseite. */
export function metaMissingConfig(): string[] {
  const config = metaConfig();
  return [
    config.appId ? null : "META_APP_ID",
    config.appSecret ? null : "META_APP_SECRET",
    config.verifyToken ? null : "META_WEBHOOK_VERIFY_TOKEN",
  ].filter((name): name is string => name !== null);
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Meta-Fehlercode, z. B. 190 = Token ungültig, 100 = Parameter/Feld. */
    readonly code: number | null,
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  /** Token abgelaufen oder entzogen — hier hilft nur neu verbinden. */
  get tokenInvalid(): boolean {
    return this.code === 190 || this.code === 102;
  }
}

type GraphParams = Record<string, string | number | undefined>;

async function graph<T>(method: "GET" | "POST" | "DELETE", path: string, token: string, params: GraphParams = {}): Promise<T> {
  const { appSecret } = metaConfig();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  query.set("access_token", token);
  if (appSecret) query.set("appsecret_proof", createHmac("sha256", appSecret).update(token).digest("hex"));

  const url = `${GRAPH_HOST}/${metaGraphVersion()}/${path.replace(/^\//, "")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response =
      method === "GET"
        ? await fetch(`${url}?${query.toString()}`, { signal: controller.signal })
        : await fetch(url, {
            method,
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: query.toString(),
            signal: controller.signal,
          });
  } catch (error) {
    throw new MetaApiError(
      controller.signal.aborted ? "Meta hat nicht rechtzeitig geantwortet." : `Meta ist nicht erreichbar: ${(error as Error).message}`,
      0,
      null,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
  if (!response.ok || !body || body.error) {
    const error = body?.error;
    throw new MetaApiError(explain(error?.code ?? null, error?.message ?? `HTTP ${response.status}`), response.status, error?.code ?? null);
  }
  return body;
}

function explain(code: number | null, message: string): string {
  if (code === 190) return `Das Zugriffstoken ist ungültig oder abgelaufen. Bitte die Seite neu verbinden. (${message})`;
  if (code === 10 || code === 200) return `Meta verweigert den Zugriff. Fehlt eine Berechtigung oder der Lead-Zugriff der Seite? (${message})`;
  return `Meta meldet: ${message}`;
}

/**
 * Prüft `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 mit dem
 * App-Geheimnis über den unveränderten Request-Body.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Kurzlebiges Nutzer-Token (z. B. aus dem Graph API Explorer) gegen ein
 * langlebiges tauschen. Seiten-Tokens, die daraus entstehen, laufen nicht ab.
 * Klappt der Tausch nicht (etwa bei einem System-User-Token), bleibt es beim
 * übergebenen Token.
 */
export async function exchangeForLongLivedToken(token: string): Promise<string> {
  const { appId, appSecret } = metaConfig();
  if (!appId || !appSecret) return token;
  try {
    const result = await graph<{ access_token?: string }>("GET", "oauth/access_token", token, {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: token,
    });
    return result.access_token ?? token;
  } catch {
    return token;
  }
}

export type MetaPage = { id: string; name: string; accessToken: string };

export type MetaTokenGrant = {
  granted: string[];
  declined: string[];
  /** Seiten, die beim Bestätigen ausdrücklich gewählt wurden (`granular_scopes`). */
  pageIds: string[];
  /** Business-Portfolios, die beim Bestätigen ausdrücklich gewählt wurden. */
  businessIds: string[];
};

const PAGE_SCOPES = new Set(["pages_show_list", "pages_manage_metadata", "pages_read_engagement", "pages_manage_ads", "leads_retrieval"]);

/**
 * Was das Nutzer-Token darf: erteilte und abgelehnte Berechtigungen und,
 * soweit Meta es verrät, welche Seiten und Portfolios beim Bestätigen gewählt
 * wurden. Dient der Fehlersuche und als Umweg zu den Seiten — scheitert es,
 * kommt `null` zurück.
 */
export async function inspectMetaToken(userToken: string): Promise<MetaTokenGrant | null> {
  let permissions: { permission: string; status: string }[];
  try {
    const result = await graph<{ data?: { permission: string; status: string }[] }>("GET", "me/permissions", userToken, { limit: 100 });
    permissions = result.data ?? [];
  } catch {
    return null;
  }
  const pageIds = new Set<string>();
  const businessIds = new Set<string>();
  const { appId, appSecret } = metaConfig();
  if (appId && appSecret) {
    try {
      const debug = await graph<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(
        "GET",
        "debug_token",
        `${appId}|${appSecret}`,
        { input_token: userToken },
      );
      for (const entry of debug.data?.granular_scopes ?? []) {
        const target = entry.scope === META_BUSINESS_PERMISSION ? businessIds : PAGE_SCOPES.has(entry.scope) ? pageIds : null;
        for (const id of entry.target_ids ?? []) target?.add(id);
      }
    } catch {
      // Nur ein Hinweis; ohne ihn geht es mit me/accounts und me/businesses weiter.
    }
  }
  return {
    granted: permissions.filter((entry) => entry.status === "granted").map((entry) => entry.permission),
    declined: permissions.filter((entry) => entry.status === "declined").map((entry) => entry.permission),
    pageIds: [...pageIds],
    businessIds: [...businessIds],
  };
}

export type MetaPageSearch = {
  pages: MetaPage[];
  /** Seiten, die das Token sieht, für die Meta aber kein Seiten-Token herausgibt. */
  withoutToken: { id: string; name: string }[];
  grant: MetaTokenGrant | null;
};

const MAX_PAGE_CANDIDATES = 50;

/**
 * Seiten, auf die das Nutzer-Token Zugriff hat — mit je eigenem Seiten-Token.
 *
 * Erst `me/accounts`. Ist die Liste leer (typisch bei Seiten, die einem
 * Business-Portfolio gehören), werden die beim Bestätigen gewählten Seiten
 * und die Seiten der Portfolios einzeln nach ihrem Seiten-Token gefragt.
 */
export async function listMetaPages(userToken: string): Promise<MetaPageSearch> {
  const [accounts, grant] = await Promise.all([
    graph<{ data?: { id: string; name: string; access_token?: string }[] }>("GET", "me/accounts", userToken, {
      fields: "id,name,access_token",
      limit: 100,
    }),
    inspectMetaToken(userToken),
  ]);
  const pages = new Map<string, MetaPage>();
  /** Seiten, die Meta mit Namen gezeigt hat (auch ohne Seiten-Token). */
  const seen = new Map<string, string>();
  for (const page of accounts.data ?? []) {
    if (page.access_token) pages.set(page.id, { id: page.id, name: page.name, accessToken: page.access_token });
    else seen.set(page.id, page.name);
  }

  if (pages.size === 0 && grant) {
    const candidates = new Set([...seen.keys(), ...grant.pageIds]);
    const businessIds = new Set(grant.businessIds);
    if (grant.granted.includes(META_BUSINESS_PERMISSION)) {
      try {
        const businesses = await graph<{ data?: { id: string }[] }>("GET", "me/businesses", userToken, { fields: "id", limit: 50 });
        for (const business of businesses.data ?? []) businessIds.add(business.id);
      } catch {
        // Ohne Portfolio-Liste bleibt es bei den ausdrücklich gewählten Seiten.
      }
    }
    for (const businessId of [...businessIds].slice(0, 10)) {
      for (const edge of ["owned_pages", "client_pages"]) {
        try {
          const owned = await graph<{ data?: { id: string; name?: string }[] }>("GET", `${businessId}/${edge}`, userToken, {
            fields: "id,name",
            limit: 100,
          });
          for (const page of owned.data ?? []) {
            candidates.add(page.id);
            if (page.name) seen.set(page.id, page.name);
          }
        } catch {
          // Kein Zugriff auf dieses Portfolio — weiter mit dem nächsten.
        }
      }
    }
    for (const id of [...candidates].slice(0, MAX_PAGE_CANDIDATES)) {
      try {
        const page = await graph<{ id: string; name?: string; access_token?: string }>("GET", id, userToken, {
          fields: "id,name,access_token",
        });
        const name = page.name ?? seen.get(id) ?? id;
        if (page.access_token) pages.set(page.id, { id: page.id, name, accessToken: page.access_token });
        else seen.set(id, name);
      } catch {
        // Seite nicht lesbar — zählt nur, wenn Meta sie oben schon gezeigt hat.
      }
    }
  }

  return {
    pages: [...pages.values()],
    withoutToken: [...seen.entries()].filter(([id]) => !pages.has(id)).map(([id, name]) => ({ id, name })),
    grant,
  };
}

/** Meldet der App künftig jede neue Formular-Einsendung dieser Seite (Feld `leadgen`). */
export async function subscribePage(pageId: string, pageToken: string): Promise<void> {
  await graph("POST", `${pageId}/subscribed_apps`, pageToken, { subscribed_fields: "leadgen" });
}

export async function unsubscribePage(pageId: string, pageToken: string): Promise<void> {
  await graph("DELETE", `${pageId}/subscribed_apps`, pageToken);
}

export type MetaLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
  field_data?: { name: string; values?: string[] }[];
};

const LEAD_FIELDS = "id,created_time,ad_id,form_id,field_data";
const LEAD_FIELDS_WITH_AD = `${LEAD_FIELDS},ad_name,adset_name,campaign_name,platform,is_organic`;

/**
 * Die Angaben einer Formular-Einsendung. Erst mit Kampagne und Plattform;
 * lehnt Meta ein Feld ab (Code 100), noch einmal nur mit den Grundfeldern —
 * ein fehlender Kampagnenname darf keinen Lead kosten.
 */
export async function fetchMetaLead(leadgenId: string, pageToken: string): Promise<MetaLead> {
  try {
    return await graph<MetaLead>("GET", leadgenId, pageToken, { fields: LEAD_FIELDS_WITH_AD });
  } catch (error) {
    if (error instanceof MetaApiError && error.code === 100) {
      return graph<MetaLead>("GET", leadgenId, pageToken, { fields: LEAD_FIELDS });
    }
    throw error;
  }
}

/** Name des Formulars — nur zur Anzeige; Fehler sind hier egal. */
export async function fetchMetaFormName(formId: string, pageToken: string): Promise<string | null> {
  try {
    const form = await graph<{ name?: string }>("GET", formId, pageToken, { fields: "name" });
    return form.name ?? null;
  } catch {
    return null;
  }
}

export type MetaLeadForm = { id: string; name: string; status: string | null; leadsCount: number | null };

/**
 * Lead-Formulare einer Seite. Meta dokumentiert das Lesen dieser Liste nicht
 * eindeutig — scheitert es, fragt die Oberfläche nach der Formular-ID.
 */
export async function listMetaLeadForms(pageId: string, pageToken: string): Promise<MetaLeadForm[]> {
  const forms: MetaLeadForm[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await graph<{
      data?: { id: string; name?: string; status?: string; leads_count?: number }[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>("GET", `${pageId}/leadgen_forms`, pageToken, { fields: "id,name,status,leads_count", limit: 100, after });
    for (const form of result.data ?? []) {
      forms.push({ id: form.id, name: form.name ?? form.id, status: form.status ?? null, leadsCount: form.leads_count ?? null });
    }
    after = result.paging?.next ? result.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return forms;
}

/**
 * Alle Einsendungen eines Formulars, seitenweise (je 100). `since` grenzt auf
 * neuere Einsendungen ein. Lehnt Meta die Kampagnenfelder ab (Code 100), geht
 * es mit den Grundfeldern weiter.
 */
export async function* fetchMetaFormLeads(formId: string, pageToken: string, since?: Date): AsyncGenerator<MetaLead[]> {
  let fields = LEAD_FIELDS_WITH_AD;
  let after: string | undefined;
  const filtering = since
    ? JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(since.getTime() / 1000) }])
    : undefined;
  for (let page = 0; page < 500; page++) {
    let result: { data?: MetaLead[]; paging?: { cursors?: { after?: string }; next?: string } };
    try {
      result = await graph("GET", `${formId}/leads`, pageToken, { fields, limit: 100, after, filtering });
    } catch (error) {
      if (error instanceof MetaApiError && error.code === 100 && fields !== LEAD_FIELDS) {
        fields = LEAD_FIELDS;
        page--;
        continue;
      }
      throw error;
    }
    if (result.data?.length) yield result.data;
    after = result.paging?.next ? result.paging.cursors?.after : undefined;
    if (!after) return;
  }
}

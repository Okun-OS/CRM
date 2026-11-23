import { NextResponse, type NextRequest } from "next/server";
import { logError, logWarn } from "@/lib/logger";
import { metaConfig, verifyMetaSignature } from "@/server/integrations/meta";
import { processMetaLeadEvent, recordMetaWebhook } from "@/server/services/meta-leads";

/**
 * Webhook für Meta Lead Ads. Diese Adresse wird in der Meta-App unter
 * „Webhooks → Page → leadgen“ eingetragen.
 *
 * GET:  Einmalige Bestätigung beim Einrichten (hub.challenge zurückgeben).
 * POST: Neue Formular-Einsendungen, signiert mit dem App-Geheimnis.
 *       Antwort sofort 200 — abgeholt und angelegt wird danach; was dabei
 *       scheitert, wiederholt der Zustell-Worker.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const { verifyToken } = metaConfig();
  if (
    verifyToken &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === verifyToken &&
    params.get("hub.challenge")
  ) {
    return new NextResponse(params.get("hub.challenge"), { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const { appSecret } = metaConfig();
  if (!appSecret) {
    // Ohne Geheimnis lässt sich nichts prüfen. Meta stellt später erneut zu.
    logWarn("meta.webhook_without_secret", {});
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    logWarn("meta.webhook_bad_signature", {});
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { recorded } = await recordMetaWebhook(payload);
  // Gleich verarbeiten, ohne Meta warten zu lassen.
  for (const eventId of recorded) {
    void processMetaLeadEvent(eventId).catch((error) => logError("meta.lead_process_failed", error, { eventId }));
  }
  return NextResponse.json({ ok: true });
}

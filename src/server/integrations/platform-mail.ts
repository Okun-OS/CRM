import "server-only";
import { logError, logInfo } from "@/lib/logger";
import { createSmtpTransport, parseSmtpConfig, verifySmtp, type SmtpConfig } from "./smtp";

/**
 * Postausgang der Betreiber-Ebene.
 *
 * Bewusst getrennt vom Postausgang einer Organisation: Eine Einladung an einen
 * künftigen Kunden kann nicht über dessen eigene Integration gehen — die
 * existiert zu diesem Zeitpunkt noch gar nicht. Die Zugangsdaten stehen
 * deshalb in der Umgebung des Betreibers.
 *
 * Ist nichts konfiguriert, wird nichts gesendet und der Grund zurückgegeben.
 * Der Einladungslink wird in der Oberfläche ohnehin angezeigt und lässt sich
 * von Hand weitergeben — nichts geht verloren, es wird nur nichts vorgetäuscht.
 */
export type PlatformMailResult = { sent: boolean; reason?: string };

function readConfig(): { config: SmtpConfig; password: string } | { reason: string } {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD ?? "";
  const from = process.env.SMTP_FROM?.trim() || user;

  if (!host || !user || !password || !from) {
    return {
      reason:
        "Kein Postausgang für den Betrieb konfiguriert (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM).",
    };
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const config = parseSmtpConfig({
    host,
    port,
    secure: process.env.SMTP_SECURE === "1" || port === 465,
    user,
    fromAddress: from,
    fromName: process.env.SMTP_FROM_NAME ?? "OKUN CRM",
  });

  if (!config) return { reason: "Die SMTP-Konfiguration des Betriebs ist unvollständig oder ungültig." };
  return { config, password };
}

export function platformMailConfigured(): boolean {
  return !("reason" in readConfig());
}

export async function sendPlatformEmail(message: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<PlatformMailResult> {
  const resolved = readConfig();
  if ("reason" in resolved) return { sent: false, reason: resolved.reason };

  try {
    const transport = createSmtpTransport(resolved.config, resolved.password);
    const result = await transport.send({
      from: "",
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    logInfo("platform.mail_sent", { to: message.to, messageId: result.providerMessageId });
    return { sent: true };
  } catch (error) {
    logError("platform.mail_failed", error, { to: message.to });
    return {
      sent: false,
      reason: error instanceof Error ? `Versand fehlgeschlagen: ${error.message.slice(0, 200)}` : "Versand fehlgeschlagen.",
    };
  }
}

/** Prüft den Postausgang des Betriebs, ohne eine Nachricht zu senden. */
export async function verifyPlatformMail(): Promise<{ ok: boolean; reason?: string }> {
  const resolved = readConfig();
  if ("reason" in resolved) return { ok: false, reason: resolved.reason };
  const result = await verifySmtp(resolved.config, resolved.password);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

import "server-only";
import { logError, logInfo } from "@/lib/logger";
import { createSmtpTransport, parseSmtpConfig, verifySmtp, type SmtpConfig } from "./smtp";
import { sendViaResend } from "./resend";

/**
 * Postausgang der Betreiber-Ebene — für Systemnachrichten wie Einladungen.
 *
 * Bewusst getrennt vom Postausgang einer Organisation: Eine Einladung an einen
 * künftigen Kunden kann nicht über dessen eigene Integration gehen — die
 * existiert zu diesem Zeitpunkt noch gar nicht. Die Zugangsdaten stehen
 * deshalb in der Umgebung des Betreibers.
 *
 * Zwei Wege, Resend hat Vorrang:
 * - **Resend:** `RESEND_API_KEY` und `MAIL_FROM` (Adresse auf einer in Resend
 *   bestätigten Domain), optional `MAIL_FROM_NAME`.
 * - **SMTP:** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
 *
 * Ist nichts konfiguriert, wird nichts gesendet und der Grund zurückgegeben.
 * Der Einladungslink wird in der Oberfläche ohnehin angezeigt und lässt sich
 * von Hand weitergeben — nichts geht verloren, es wird nur nichts vorgetäuscht.
 */
export type PlatformMailResult = { sent: boolean; reason?: string };

type Resolved =
  | { provider: "resend"; apiKey: string; from: string }
  | { provider: "smtp"; config: SmtpConfig; password: string }
  | { reason: string };

const NOT_CONFIGURED =
  "Kein Postausgang für den Betrieb konfiguriert (RESEND_API_KEY und MAIL_FROM — oder SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM).";

function fromName(): string {
  return (process.env.MAIL_FROM_NAME ?? process.env.SMTP_FROM_NAME ?? "OKUN CRM").trim() || "OKUN CRM";
}

function readConfig(): Resolved {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const address = (process.env.MAIL_FROM ?? process.env.SMTP_FROM)?.trim();
    if (!address || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(address)) {
      return { reason: "RESEND_API_KEY ist gesetzt, aber MAIL_FROM fehlt oder ist keine gültige Absenderadresse." };
    }
    const name = fromName().replace(/["<>]/g, "");
    return { provider: "resend", apiKey: resendKey, from: `${name} <${address}>` };
  }

  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD ?? "";
  const from = process.env.SMTP_FROM?.trim() || user;

  if (!host || !user || !password || !from) return { reason: NOT_CONFIGURED };

  const port = Number(process.env.SMTP_PORT ?? 587);
  const config = parseSmtpConfig({
    host,
    port,
    secure: process.env.SMTP_SECURE === "1" || port === 465,
    user,
    fromAddress: from,
    fromName: fromName(),
  });

  if (!config) return { reason: "Die SMTP-Konfiguration des Betriebs ist unvollständig oder ungültig." };
  return { provider: "smtp", config, password };
}

export function platformMailConfigured(): boolean {
  return !("reason" in readConfig());
}

/** Soll der Betrieb versenden — auch wenn die Angaben noch unvollständig sind? */
export function platformMailIntended(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() || process.env.SMTP_HOST?.trim());
}

/** Für Hinweise in der Oberfläche: „Resend“, „SMTP“ oder null. */
export function platformMailProvider(): "Resend" | "SMTP" | null {
  const resolved = readConfig();
  if ("reason" in resolved) return null;
  return resolved.provider === "resend" ? "Resend" : "SMTP";
}

export async function sendPlatformEmail(message: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Antworten gehen an diese Adresse, etwa an die Person, die eingeladen hat. */
  replyTo?: string;
}): Promise<PlatformMailResult> {
  const resolved = readConfig();
  if ("reason" in resolved) return { sent: false, reason: resolved.reason };

  try {
    if (resolved.provider === "resend") {
      const result = await sendViaResend(resolved.apiKey, {
        from: resolved.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
      });
      logInfo("platform.mail_sent", { to: message.to, provider: "resend", messageId: result.id });
      return { sent: true };
    }

    const transport = createSmtpTransport(resolved.config, resolved.password);
    const result = await transport.send({
      from: "",
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
    logInfo("platform.mail_sent", { to: message.to, provider: "smtp", messageId: result.providerMessageId });
    return { sent: true };
  } catch (error) {
    logError("platform.mail_failed", error, { to: message.to });
    return {
      sent: false,
      reason: error instanceof Error ? `Versand fehlgeschlagen: ${error.message.slice(0, 300)}` : "Versand fehlgeschlagen.",
    };
  }
}

/** Prüft den SMTP-Postausgang des Betriebs, ohne eine Nachricht zu senden. */
export async function verifyPlatformMail(): Promise<{ ok: boolean; reason?: string }> {
  const resolved = readConfig();
  if ("reason" in resolved) return { ok: false, reason: resolved.reason };
  if (resolved.provider === "resend") return { ok: true };
  const result = await verifySmtp(resolved.config, resolved.password);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

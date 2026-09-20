import nodemailer, { type Transporter } from "nodemailer";
import type { EmailTransport, OutgoingEmail } from "./email";

/**
 * SMTP-Versandadapter.
 *
 * Der erste tatsächlich implementierte Transport. Er nimmt die Verbindungsdaten
 * einer Integration entgegen; das Passwort liegt verschlüsselt in der Datenbank
 * und wird erst hier entschlüsselt übergeben.
 */
export type SmtpConfig = {
  host: string;
  port: number;
  /** Implizites TLS (in der Regel Port 465). Sonst wird STARTTLS genutzt. */
  secure: boolean;
  user: string;
  fromAddress: string;
  fromName?: string;
};

export function parseSmtpConfig(value: unknown): SmtpConfig | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const host = typeof raw.host === "string" ? raw.host.trim() : "";
  const user = typeof raw.user === "string" ? raw.user.trim() : "";
  const fromAddress = typeof raw.fromAddress === "string" ? raw.fromAddress.trim() : "";
  const port = Number(raw.port);

  if (!host || !user || !fromAddress || !Number.isInteger(port) || port <= 0 || port > 65535) return null;

  return {
    host,
    port,
    secure: raw.secure === true || port === 465,
    user,
    fromAddress,
    fromName: typeof raw.fromName === "string" && raw.fromName.trim() ? raw.fromName.trim() : undefined,
  };
}

function formatFrom(config: SmtpConfig): string {
  return config.fromName ? `"${config.fromName.replace(/"/g, "")}" <${config.fromAddress}>` : config.fromAddress;
}

function createTransporter(config: SmtpConfig, password: string): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: password },
    // Ein hängender Postausgang darf keine Anfrage blockieren.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export function createSmtpTransport(config: SmtpConfig, password: string): EmailTransport {
  return {
    provider: "SMTP",
    async send(message: OutgoingEmail) {
      const transporter = createTransporter(config, password);
      try {
        const result = await transporter.sendMail({
          from: message.from || formatFrom(config),
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        return { providerMessageId: result.messageId };
      } finally {
        transporter.close();
      }
    },
  };
}

/** Prüft die Zugangsdaten, ohne eine Nachricht zu senden. */
export async function verifySmtp(config: SmtpConfig, password: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const transporter = createTransporter(config, password);
  try {
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.slice(0, 300) : "Verbindung fehlgeschlagen." };
  } finally {
    transporter.close();
  }
}

import "server-only";

/**
 * Versand über Resend (https://resend.com) — per HTTP-Schnittstelle, ohne SDK.
 *
 * Resend verschickt nur von einer dort bestätigten Domain. Fehler werden in
 * verständliche Gründe übersetzt, damit die Oberfläche statt „403“ sagen
 * kann, was zu tun ist.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

export type ResendMessage = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export class ResendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export async function sendViaResend(apiKey: string, message: ResendMessage): Promise<{ id: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ResendError(
      controller.signal.aborted ? "Resend hat nicht rechtzeitig geantwortet." : `Resend ist nicht erreichbar: ${(error as Error).message}`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
  if (response.ok && body?.id) return { id: body.id };
  throw new ResendError(explain(response.status, body?.message ?? "", body?.name ?? ""), response.status);
}

function explain(status: number, message: string, name: string): string {
  if (status === 401 || name === "missing_api_key" || name === "invalid_api_key") {
    return "Der Resend-Schlüssel (RESEND_API_KEY) fehlt oder ist ungültig.";
  }
  if (/domain/i.test(message) && /verif/i.test(message)) {
    return `Die Absenderdomain ist in Resend nicht bestätigt — unter resend.com → Domains die DNS-Einträge setzen. (${message})`;
  }
  if (status === 429) return "Resend begrenzt gerade die Anzahl der Nachrichten — bitte gleich noch einmal versuchen.";
  return `Resend hat den Versand abgelehnt (${status})${message ? `: ${message}` : "."}`;
}

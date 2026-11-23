import "server-only";

/**
 * E-Mail „Neuer Lead“. Enthält alles, um sofort zurückzurufen — Name,
 * Telefon, E-Mail, die Antworten aus dem Formular und woher der Lead kam —
 * und einen Knopf direkt zur Akte im CRM.
 */
export type LeadNotificationInput = {
  leadName: string;
  leadUrl: string;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  /** Weitere Antworten aus dem Formular, in Reihenfolge. */
  answers: { label: string; value: string }[];
  /** „Facebook-Formular „Rückruf anfordern““, Kampagne usw. */
  origin: { label: string; value: string }[];
  /** Eine zweite Anfrage derselben Person zu einem offenen Lead. */
  repeat?: boolean;
  /** Probe aus den Einstellungen. */
  test?: boolean;
};

export function leadNotificationMail(input: LeadNotificationInput): { subject: string; html: string; text: string } {
  const prefix = input.test ? "[Test] " : "";
  const subject = `${prefix}${input.repeat ? "Erneute Anfrage" : "Neuer Lead"}: ${input.leadName}`;
  const contact = [
    { label: "Name", value: input.leadName },
    input.companyName ? { label: "Unternehmen", value: input.companyName } : null,
    input.jobTitle ? { label: "Position", value: input.jobTitle } : null,
    input.phone ? { label: "Telefon", value: input.phone, href: `tel:${input.phone.replace(/[^\d+]/g, "")}` } : null,
    input.email ? { label: "E-Mail", value: input.email, href: `mailto:${input.email}` } : null,
  ].filter((row): row is { label: string; value: string; href?: string } => row !== null);

  const rows = (items: { label: string; value: string; href?: string }[]) =>
    items
      .map(
        (row) => `<tr>
          <td style="padding:6px 12px 6px 0;font-size:13px;color:#6B7280;vertical-align:top;white-space:nowrap;">${escapeHtml(row.label)}</td>
          <td style="padding:6px 0;font-size:14px;color:#1A1F26;">${
            row.href ? `<a href="${escapeHtml(row.href)}" style="color:#2563EB;text-decoration:none;">${escapeHtml(row.value)}</a>` : escapeHtml(row.value)
          }</td>
        </tr>`,
      )
      .join("");

  const section = (title: string, items: { label: string; value: string; href?: string }[]) =>
    items.length === 0
      ? ""
      : `<p style="margin:24px 0 4px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6B7280;">${title}</p>
      <table role="presentation" cellpadding="0" cellspacing="0">${rows(items)}</table>`;

  const html = `<!doctype html>
<html lang="de"><body style="margin:0;background:#E5E7EB;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#0D1117;padding:24px 32px;color:#ffffff;">
      <div style="font-size:18px;font-weight:600;letter-spacing:-0.01em;">OKUN <span style="color:#06B6D4;">CRM</span></div>
      <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:2px;">${input.repeat ? "Erneute Anfrage zu einem offenen Lead" : "Ein neuer Lead ist eingegangen"}</div>
    </td></tr>
    <tr><td style="padding:28px 32px;color:#1A1F26;">
      ${input.test ? '<p style="margin:0 0 16px;padding:8px 12px;background:#FEF3C7;border-radius:6px;font-size:13px;color:#92400E;">Das ist eine Probe aus den Einstellungen, kein echter Lead.</p>' : ""}
      <p style="margin:0;font-size:20px;font-weight:600;">${escapeHtml(input.leadName)}</p>
      ${section("Kontakt", contact.slice(1))}
      ${section("Antworten aus dem Formular", input.answers)}
      ${section("Herkunft", input.origin)}
      <p style="margin:28px 0 0;">
        <a href="${escapeHtml(input.leadUrl)}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">Lead im CRM öffnen</a>
      </p>
    </td></tr>
    <tr><td style="padding:16px 32px;background:#F3F4F6;font-size:11px;color:#6B7280;">
      Diese Benachrichtigung stellen Sie im CRM unter Einstellungen → Integrationen → Meta Lead Ads ein.
    </td></tr>
  </table>
</body></html>`;

  const textRows = (items: { label: string; value: string }[]) => items.map(answerLine);
  const text = [
    input.test ? "PROBE AUS DEN EINSTELLUNGEN, KEIN ECHTER LEAD" : null,
    input.repeat ? "Erneute Anfrage zu einem offenen Lead" : "Ein neuer Lead ist eingegangen",
    "",
    ...textRows(contact),
    ...(input.answers.length ? ["", "Antworten aus dem Formular:", ...textRows(input.answers)] : []),
    ...(input.origin.length ? ["", "Herkunft:", ...textRows(input.origin)] : []),
    "",
    `Im CRM öffnen: ${input.leadUrl}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { subject, html, text };
}

/** „Frage?: Antwort“ liest sich holprig — nach Fragezeichen kein Doppelpunkt. */
export function answerLine(row: { label: string; value: string }): string {
  return `${row.label}${/[?:]$/.test(row.label) ? "" : ":"} ${row.value}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

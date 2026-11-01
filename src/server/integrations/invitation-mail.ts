import "server-only";

/**
 * Einladungs-E-Mail — eine Vorlage für beide Wege: Der Betreiber richtet einen
 * Kunden ein („Ihr Zugang zu OKUN CRM“), oder ein Administrator lädt jemanden
 * in sein Team ein („Anna Weber lädt Sie ein“).
 */
export type InvitationMailInput = {
  organizationName: string;
  inviteUrl: string;
  expiresAt: Date;
  /** Anrede; ohne Namen „Guten Tag,“. */
  recipientName?: string | null;
  /** Wer einlädt; ohne Angabe wurde der Zugang vom Betreiber eingerichtet. */
  inviterName?: string | null;
};

export function invitationMail(input: InvitationMailInput): { subject: string; html: string; text: string } {
  const longDate = input.expiresAt.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  const greeting = input.recipientName?.trim() ? `Guten Tag ${input.recipientName.trim()},` : "Guten Tag,";
  const org = input.organizationName;
  const inviter = input.inviterName?.trim();

  const introText = inviter
    ? `${inviter} lädt Sie zu ${org} in OKUN CRM ein. Über den folgenden Link nehmen Sie die Einladung an und melden sich an.`
    : `für ${org} wurde ein Zugang zu OKUN CRM eingerichtet. Über den folgenden Link legen Sie Ihr Passwort fest und melden sich das erste Mal an.`;
  const introHtml = inviter
    ? `<strong>${escapeHtml(inviter)}</strong> lädt Sie zu <strong>${escapeHtml(org)}</strong> in OKUN CRM ein.
        Über den folgenden Link nehmen Sie die Einladung an und melden sich an.`
    : `für <strong>${escapeHtml(org)}</strong> wurde ein Zugang zu OKUN CRM eingerichtet.
        Über den folgenden Link legen Sie Ihr Passwort fest und melden sich das erste Mal an.`;
  const url = escapeHtml(input.inviteUrl);

  return {
    subject: inviter ? `Einladung zu OKUN CRM — ${org}` : `Ihr Zugang zu OKUN CRM — ${org}`,
    html: `<!doctype html>
<html lang="de"><body style="margin:0;background:#E5E7EB;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#0D1117;padding:28px 32px;color:#ffffff;">
      <div style="font-size:18px;font-weight:600;letter-spacing:-0.01em;">OKUN <span style="color:#06B6D4;">CRM</span></div>
      <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:2px;">Kunden. Beziehungen. Wachstum.</div>
    </td></tr>
    <tr><td style="padding:32px;color:#1A1F26;">
      <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        ${introHtml}
      </p>
      <p style="margin:24px 0;">
        <a href="${url}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">${inviter ? "Einladung annehmen" : "Zugang einrichten"}</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#6B7280;line-height:1.6;">
        Der Link gilt bis zum ${longDate} und kann nur einmal verwendet werden.
        Falls der Knopf nicht funktioniert, kopieren Sie diese Adresse in Ihren Browser:
      </p>
      <p style="margin:0;font-size:12px;color:#6B7280;word-break:break-all;">${url}</p>
    </td></tr>
    <tr><td style="padding:20px 32px;background:#F3F4F6;font-size:11px;color:#6B7280;letter-spacing:0.08em;text-transform:uppercase;">
      Powered by OKUN Software
    </td></tr>
  </table>
</body></html>`,
    text: [
      greeting,
      "",
      introText,
      "",
      input.inviteUrl,
      "",
      `Der Link gilt bis zum ${input.expiresAt.toLocaleDateString("de-DE")} und kann nur einmal verwendet werden.`,
      "",
      "Powered by OKUN Software",
    ].join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

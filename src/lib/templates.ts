/**
 * E-mail template placeholders.
 *
 * Placeholders are validated centrally: a template can only reference tokens
 * this module knows, so a template cannot silently render an empty value for a
 * typo like {{contact.firstname}}.
 */
export const PLACEHOLDERS = {
  "contact.firstName": "Vorname des Kontakts",
  "contact.lastName": "Nachname des Kontakts",
  "contact.fullName": "Vollständiger Name des Kontakts",
  "contact.email": "E-Mail des Kontakts",
  "contact.jobTitle": "Position des Kontakts",
  "company.name": "Name des Unternehmens",
  "company.domain": "Domain des Unternehmens",
  "deal.name": "Name des Deals",
  "deal.amount": "Wert des Deals",
  "owner.name": "Name des Owners",
  "owner.email": "E-Mail des Owners",
  "organization.name": "Name der Organisation",

  // ─── Akquise ──────────────────────────────────────────────────────────
  // Ein Prospect ist noch kein Kontakt; seine Felder heißen deshalb anders.
  // Dieselbe Vorlagensprache, erweitertes Vokabular — keine zweite Engine.
  "prospect.firstName": "Vorname des Prospects",
  "prospect.lastName": "Nachname des Prospects",
  "prospect.fullName": "Vollständiger Name des Prospects",
  "prospect.email": "E-Mail des Prospects",
  "prospect.jobTitle": "Position des Prospects",
  "prospect.companyName": "Unternehmen des Prospects",
  "prospect.domain": "Domain des Prospects",
  "prospect.city": "Ort des Prospects",
  "prospect.industry": "Branche des Prospects",
  "sender.name": "Name des Absenders",
  "sender.email": "Adresse des Absenders",
  "sender.company": "Unternehmen des Absenders",
} as const;

export type PlaceholderKey = keyof typeof PLACEHOLDERS;

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z]+\.[a-zA-Z]+)\s*\}\}/g;

export function extractPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(TOKEN_PATTERN)).map((match) => match[1]);
}

/** Returns the placeholders a template uses that this CRM cannot resolve. */
export function findUnknownPlaceholders(...texts: string[]): string[] {
  const unknown = new Set<string>();
  for (const text of texts) {
    for (const token of extractPlaceholders(text)) {
      if (!(token in PLACEHOLDERS)) unknown.add(token);
    }
  }
  return Array.from(unknown);
}

export type TemplateVariables = Partial<Record<PlaceholderKey, string | null | undefined>>;

/**
 * Renders a template. Unresolved placeholders become an empty string, which is
 * only reachable for known tokens whose record value is missing.
 */
export function renderTemplate(text: string, variables: TemplateVariables): string {
  return text.replace(TOKEN_PATTERN, (match, token: string) => {
    if (!(token in PLACEHOLDERS)) return match;
    const value = variables[token as PlaceholderKey];
    return value === null || value === undefined ? "" : String(value);
  });
}

/** Escapes user-provided values before they are placed into HTML bodies. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

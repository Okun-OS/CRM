/**
 * Lesbare Texte für das Audit-Log.
 *
 * Gespeichert werden technische Schlüssel wie `deal.stage_changed`; die
 * Oberfläche zeigt „Deal: Phase geändert“. Unbekannte Schlüssel fallen auf
 * Bereich + Vorgang zurück, damit ein neues Ereignis nie leer dasteht.
 */

const AREAS: Record<string, string> = {
  active_crm: "Aktives CRM",
  api_key: "API-Schlüssel",
  auth: "Anmeldung",
  automation: "Automation",
  company: "Unternehmen",
  contact: "Kontakt",
  customer: "Kunde",
  deal: "Deal",
  email_template: "E-Mail-Vorlage",
  enrollment: "Sequenz-Teilnahme",
  file: "Datei",
  import: "Import",
  integration: "Integration",
  lead: "Lead",
  lead_status: "Lead-Status",
  lifecycle_stage: "Lifecycle-Stufe",
  mailwin: "Mailwin",
  meeting: "Termin",
  next_action: "Nächste Aktion",
  note: "Notiz",
  organization: "Organisation",
  pipeline: "Pipeline",
  property: "Eigenschaft",
  prospect: "Prospect",
  prospect_list: "Prospect-Liste",
  prospects: "Prospects",
  recall: "Wiedervorlage",
  reply: "Antwort",
  sending_account: "Versandkonto",
  sequence: "Sequenz",
  suggestion: "Vorschlag",
  suppression: "Sperrliste",
  tag: "Tag",
  task: "Aufgabe",
  team: "Team",
  user: "Benutzer",
  view: "Ansicht",
  webhook: "Webhook",
  workflow: "Workflow",
};

const VERBS: Record<string, string> = {
  created: "angelegt",
  updated: "geändert",
  deleted: "gelöscht",
  archived: "archiviert",
  merged: "zusammengeführt",
  purged: "endgültig gelöscht",
  converted: "umgewandelt",
  completed: "erledigt",
  dismissed: "verworfen",
  accepted: "übernommen",
  rejected: "verworfen",
  revoked: "widerrufen",
  paused: "pausiert",
  resumed: "fortgesetzt",
  cancelled: "abgebrochen",
  connected: "verbunden",
  disconnected: "getrennt",
  stage_changed: "Phase geändert",
  status_changed: "Status geändert",
  invited: "eingeladen",
  removed: "entfernt",
  added: "hinzugefügt",
  uploaded: "hochgeladen",
  imported: "importiert",
  enrolled: "in Sequenz aufgenommen",
  stopped: "beendet",
  set: "gesetzt",
};

/** Ganze Sätze, wo Bereich + Vorgang holprig wäre. */
const ACTIONS: Record<string, string> = {
  "auth.login": "Angemeldet",
  "auth.login_failed": "Anmeldung fehlgeschlagen",
  "auth.password_changed": "Passwort geändert",
  "auth.session_revoked": "Sitzung abgemeldet",
  "user.password_reset": "Passwort zurückgesetzt",
  "user.unlocked": "Anmeldesperre aufgehoben",
  "user.email_changed": "Anmelde-E-Mail geändert",
  "user.profile_updated": "Profil geändert",
  "user.membership_updated": "Rolle oder Team geändert",
  "user.invitation_accepted": "Einladung angenommen",
  "user.invitation_revoked": "Einladung zurückgezogen",
  "organization.onboarding_completed": "Einrichtung abgeschlossen",
  "next_action.set_manually": "Nächste Aktion festgelegt",
  "next_action.snoozed": "Nächste Aktion verschoben",
  "mailwin.key_created": "Mailwin-Schlüssel erzeugt",
  "mailwin.key_revoked": "Mailwin-Schlüssel widerrufen",
  "mailwin.signal_settings_updated": "Mailwin-Signale eingestellt",
  "active_crm.rule_updated": "Regel des aktiven CRM geändert",
  "active_crm.settings_updated": "Einstellungen des aktiven CRM geändert",
  "reply.reclassified": "Antwort neu eingestuft",
  "prospects.imported": "Prospects importiert",
  "import.completed": "Import abgeschlossen",
  "recall.set": "Wiedervorlage gesetzt",
  "sequence.enrolled": "In Sequenz aufgenommen",
  "customer.admin_invited": "Administrator eingeladen",
  "customer.suspended": "Kunde stillgelegt",
  "customer.reactivated": "Kunde reaktiviert",
};

function humanize(key: string): string {
  return key.replace(/_/g, " ");
}

export function auditActionLabel(action: string): string {
  if (ACTIONS[action]) return ACTIONS[action];
  const dot = action.indexOf(".");
  if (dot < 0) return humanize(action);
  const area = action.slice(0, dot);
  const verb = action.slice(dot + 1);
  const areaLabel = AREAS[area] ?? humanize(area);
  return `${areaLabel} ${VERBS[verb] ?? humanize(verb)}`;
}

const ENTITIES: Record<string, string> = {
  activecrmrulesetting: "Regel",
  activecrmsetting: "Einstellung",
  apikey: "API-Schlüssel",
  company: "Unternehmen",
  contact: "Kontakt",
  deal: "Deal",
  emailmessage: "E-Mail",
  emailtemplate: "E-Mail-Vorlage",
  fileobject: "Datei",
  importjob: "Import",
  integrationconnection: "Integration",
  integrationsetting: "Integration",
  invitation: "Einladung",
  lead: "Lead",
  leadstatusoption: "Lead-Status",
  lifecyclestageoption: "Lifecycle-Stufe",
  meeting: "Termin",
  membership: "Mitgliedschaft",
  nextaction: "Nächste Aktion",
  note: "Notiz",
  organization: "Organisation",
  pipeline: "Pipeline",
  propertydefinition: "Eigenschaft",
  prospect: "Prospect",
  prospectlist: "Prospect-Liste",
  recordsuggestion: "Vorschlag",
  savedview: "Ansicht",
  scheduledautomation: "Automation",
  sendingaccount: "Versandkonto",
  sequence: "Sequenz",
  sequenceenrollment: "Sequenz-Teilnahme",
  session: "Sitzung",
  suppressionentry: "Sperrliste",
  tag: "Tag",
  task: "Aufgabe",
  team: "Team",
  user: "Benutzer",
  webhookendpoint: "Webhook",
  workflow: "Workflow",
};

export function auditEntityLabel(entityType: string): string {
  return ENTITIES[entityType.toLowerCase()] ?? entityType;
}

/** Link zum Datensatz, wo es eine Akte gibt. */
export function auditEntityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entityType.toLowerCase()) {
    case "contact":
      return `/contacts/${entityId}`;
    case "company":
      return `/companies/${entityId}`;
    case "deal":
      return `/deals/${entityId}`;
    case "lead":
      return `/leads/${entityId}`;
    default:
      return null;
  }
}

const FIELDS: Record<string, string> = {
  name: "Name",
  title: "Titel",
  firstName: "Vorname",
  lastName: "Nachname",
  email: "E-Mail",
  phone: "Telefon",
  mobile: "Mobil",
  jobTitle: "Position",
  amount: "Wert",
  currency: "Währung",
  stage: "Phase",
  stageId: "Phase",
  status: "Status",
  probability: "Wahrscheinlichkeit",
  expectedCloseDate: "Erwarteter Abschluss",
  ownerId: "Owner",
  companyId: "Unternehmen",
  contactId: "Kontakt",
  domain: "Domain",
  industry: "Branche",
  timezone: "Zeitzone",
  role: "Rolle",
  teamId: "Team",
  description: "Beschreibung",
  dueAt: "Fällig am",
  startAt: "Beginn",
  endAt: "Ende",
  location: "Ort",
  priority: "Priorität",
  lostReason: "Verlustgrund",
  label: "Bezeichnung",
  key: "Schlüssel",
  type: "Typ",
  url: "Adresse",
  events: "Ereignisse",
  isActive: "Aktiv",
  until: "Bis",
  reason: "Grund",
  kind: "Art",
};

export function auditFieldLabel(field: string): string {
  if (field.startsWith("property:")) return `Eigenschaft „${field.slice("property:".length)}“`;
  return FIELDS[field] ?? field;
}

/** Häufige Aufzählungswerte (Status, Priorität, Rolle …) auf Deutsch. */
const VALUES: Record<string, string> = {
  OPEN: "Offen",
  IN_PROGRESS: "In Arbeit",
  COMPLETED: "Erledigt",
  CANCELLED: "Abgebrochen",
  SCHEDULED: "Geplant",
  WON: "Gewonnen",
  LOST: "Verloren",
  ACTIVE: "Aktiv",
  INVITED: "Eingeladen",
  SUSPENDED: "Gesperrt",
  LOW: "Niedrig",
  MEDIUM: "Mittel",
  HIGH: "Hoch",
  URGENT: "Dringend",
  SUPER_ADMIN: "Super-Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  SALES: "Vertrieb",
  USER: "Benutzer",
  INBOUND: "Eingehend",
  OUTBOUND: "Ausgehend",
};

/** Ein Wert in einer Zeile: Zeitpunkte deutsch, Listen mit Komma, Leeres als „—“. */
export function auditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if (typeof value === "string" && VALUES[value]) return VALUES[value];
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
    }
  }
  if (Array.isArray(value)) return value.map((item) => auditValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export type AuditChange = { field: string; label: string; before: string | null; after: string | null };

/** Vorher/Nachher als Liste geänderter Felder — statt eines JSON-Blocks. */
export function auditChanges(before: unknown, after: unknown): AuditChange[] {
  const b = before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === "object" && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  return keys
    .filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]) || !(key in b) || !(key in a))
    .map((key) => ({
      field: key,
      label: auditFieldLabel(key),
      before: key in b ? auditValue(b[key]) : null,
      after: key in a ? auditValue(a[key]) : null,
    }));
}

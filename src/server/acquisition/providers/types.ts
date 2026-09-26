import type { ActorContext } from "@/lib/context";

/**
 * Provider-Abstraktion der Acquisition Engine.
 *
 * Externe Datenquellen gehören nicht in die Geschäftslogik. Jede Quelle ist
 * eine Implementierung einer schmalen Schnittstelle; das OKUN-Datenmodell
 * bleibt die einzige Wahrheit. Dadurch lässt sich ein Anbieter austauschen,
 * ohne die Engine umzubauen.
 *
 * **Ausgeliefert wird nur, was wirklich etwas tut.** Ein Provider ohne
 * Implementierung erscheint nicht als verfügbare Funktion — er wird als
 * „nicht angebunden" geführt. Was nicht angeschlossen ist, wird nicht als
 * fertig dargestellt.
 */

/** Ein von einer Quelle gelieferter Datensatz, bevor er ein Prospect wird. */
export type ProspectCandidate = {
  companyName: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  linkedinUrl?: string | null;
  /** Kennung beim Provider, für Aktualisierung und Dublettenprüfung. */
  sourceRef?: string | null;
  /**
   * Herkunft je Feld. Nur Felder eintragen, die der Provider wirklich
   * geliefert hat — daraus entsteht die Nachvollziehbarkeit.
   */
  provenance?: { field: string; reference?: string | null; confidence?: number | null }[];
};

/** Welche Filter eine Quelle tatsächlich unterstützt. Nichts vortäuschen. */
export type ProspectSearchCapability =
  | "industry"
  | "location"
  | "employeeCount"
  | "hasWebsite"
  | "role"
  | "freeText";

export type ProspectSearchInput = {
  freeText?: string;
  industry?: string;
  location?: string;
  minEmployees?: number;
  maxEmployees?: number;
  hasWebsite?: boolean;
  role?: string;
  limit: number;
};

export type ProspectSearchResult = {
  candidates: ProspectCandidate[];
  /** Was die Quelle zu dieser Suche zu sagen hat, etwa ein Limit. */
  note?: string;
};

export type ProspectingProvider = {
  key: string;
  label: string;
  description: string;
  /** Ob die Quelle in dieser Installation wirklich Daten liefern kann. */
  available: (ctx: ActorContext) => Promise<boolean>;
  /** Filter, die diese Quelle beherrscht. Die Oberfläche zeigt nur diese. */
  capabilities: ProspectSearchCapability[];
  search: (ctx: ActorContext, input: ProspectSearchInput) => Promise<ProspectSearchResult>;
};

/** Anreicherung vorhandener Datensätze. */
export type EnrichmentProvider = {
  key: string;
  label: string;
  description: string;
  available: (ctx: ActorContext) => Promise<boolean>;
  /** Welche Felder diese Quelle ergänzen kann. */
  fields: string[];
  enrich: (
    ctx: ActorContext,
    input: { companyName: string; domain?: string | null; email?: string | null },
  ) => Promise<Partial<ProspectCandidate>>;
};

/** Versandweg für Outreach-Nachrichten. */
export type SendingProvider = {
  key: string;
  label: string;
  available: (ctx: ActorContext) => Promise<boolean>;
};

/**
 * Intelligence-Schicht.
 *
 * Bewusst als Schnittstelle vorhanden und bewusst ohne Implementierung: Eine
 * Einstufung, die niemand geprüft hat, ist keine Funktion, sondern ein Risiko.
 * Solange nichts angebunden ist, stuft die Engine regelbasiert ein und sagt
 * das auch.
 */
export type IntelligenceProvider = {
  key: string;
  label: string;
  available: (ctx: ActorContext) => Promise<boolean>;
  classifyReply?: (
    ctx: ActorContext,
    input: { subject: string; body: string },
  ) => Promise<{ classification: string; confidence: number }>;
};

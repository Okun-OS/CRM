import { parseCsv } from "@/lib/csv";
import type { ProspectCandidate, ProspectingProvider } from "./types";

/**
 * Tabellenimport.
 *
 * Keine Suche, sondern eine Übernahme: Der Aufrufer reicht den Inhalt und die
 * Spaltenzuordnung herein. Die Quelle steht hier trotzdem, damit importierte
 * Datensätze dieselbe dokumentierte Herkunft tragen wie alle anderen.
 */
export const csvProvider: ProspectingProvider = {
  key: "csv",
  label: "Tabelle (CSV)",
  description: "Aus einer Tabelle übernommen. Herkunft: die importierte Datei.",
  available: async () => true,
  capabilities: [],
  search: async () => ({
    candidates: [],
    note: "Diese Quelle durchsucht nichts — sie übernimmt Datensätze aus einer hochgeladenen Tabelle.",
  }),
};

/** Feldnamen, auf die eine Spalte zeigen darf. */
export const CSV_PROSPECT_FIELDS = [
  "companyName",
  "domain",
  "website",
  "industry",
  "employeeCount",
  "street",
  "postalCode",
  "city",
  "country",
  "phone",
  "firstName",
  "lastName",
  "email",
  "jobTitle",
  "linkedinUrl",
] as const;

export type CsvProspectField = (typeof CSV_PROSPECT_FIELDS)[number];

/**
 * Macht aus Tabelleninhalt und Spaltenzuordnung Kandidaten.
 *
 * Zeilen ohne Firmennamen werden übersprungen statt mit einem Platzhalter
 * gefüllt — ein Prospect ohne Unternehmen ist kein Prospect.
 */
export function candidatesFromCsv(
  content: string,
  mapping: Record<string, string>,
  filename: string,
): { candidates: ProspectCandidate[]; skipped: number } {
  const parsed = parseCsv(content);
  const columns = parsed.headers
    .map((name, index) => ({ field: mapping[name], index }))
    .filter((entry): entry is { field: string; index: number } => Boolean(entry.field));
  if (columns.length === 0) return { candidates: [], skipped: 0 };
  const body = parsed.rows;

  const candidates: ProspectCandidate[] = [];
  let skipped = 0;

  for (const row of body) {
    const record: Record<string, string> = {};
    for (const column of columns) {
      const value = (row[column.index] ?? "").trim();
      if (value) record[column.field] = value;
    }
    if (!record.companyName) {
      skipped += 1;
      continue;
    }

    const employeeCount = record.employeeCount ? Number.parseInt(record.employeeCount, 10) : null;
    candidates.push({
      companyName: record.companyName,
      domain: record.domain ?? null,
      website: record.website ?? null,
      industry: record.industry ?? null,
      employeeCount: Number.isFinite(employeeCount) ? employeeCount : null,
      street: record.street ?? null,
      postalCode: record.postalCode ?? null,
      city: record.city ?? null,
      country: record.country ?? null,
      phone: record.phone ?? null,
      firstName: record.firstName ?? null,
      lastName: record.lastName ?? null,
      email: record.email ?? null,
      jobTitle: record.jobTitle ?? null,
      linkedinUrl: record.linkedinUrl ?? null,
      provenance: Object.keys(record).map((field) => ({ field, reference: filename })),
    });
  }

  return { candidates, skipped };
}

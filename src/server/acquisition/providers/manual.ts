import type { ProspectingProvider } from "./types";

/**
 * Eingabe von Hand.
 *
 * Keine Suche — die Quelle existiert, damit ein von Hand angelegter Prospect
 * dieselbe dokumentierte Herkunft bekommt wie jeder andere. „Von einem
 * Menschen eingetragen" ist eine Herkunft, und zwar eine gute.
 */
export const manualProvider: ProspectingProvider = {
  key: "manual",
  label: "Manuelle Eingabe",
  description: "Von Hand angelegt. Herkunft: die Person, die den Datensatz eingetragen hat.",
  available: async () => true,
  capabilities: [],
  search: async () => ({
    candidates: [],
    note: "Diese Quelle durchsucht nichts — sie dokumentiert die Herkunft von Hand angelegter Datensätze.",
  }),
};

import type { ActorContext } from "@/lib/context";
import { manualProvider } from "./manual";
import { crmProvider } from "./crm";
import { csvProvider } from "./csv";
import type { EnrichmentProvider, IntelligenceProvider, ProspectingProvider } from "./types";

/**
 * Welche Quellen es gibt — und welche wirklich etwas tun.
 *
 * Ausgeliefert wird nur, was liefert. Externe Datenanbieter, Enrichment-APIs
 * und eine Intelligence-Schicht haben eine Schnittstelle (`./types.ts`), aber
 * keine Implementierung. Sie tauchen deshalb hier nicht auf und erscheinen in
 * der Oberfläche nicht als verfügbare Funktion.
 *
 * Wer einen Anbieter anschließt, trägt ihn hier ein — mehr ist nicht nötig,
 * weil die Geschäftslogik die Quellen nur über diese Registry kennt.
 */
const PROSPECTING: ProspectingProvider[] = [manualProvider, csvProvider, crmProvider];

const ENRICHMENT: EnrichmentProvider[] = [];

const INTELLIGENCE: IntelligenceProvider[] = [];

export function prospectingProviders(): ProspectingProvider[] {
  return PROSPECTING;
}

export function prospectingProvider(key: string): ProspectingProvider | null {
  return PROSPECTING.find((provider) => provider.key === key) ?? null;
}

export function enrichmentProviders(): EnrichmentProvider[] {
  return ENRICHMENT;
}

export function intelligenceProvider(): IntelligenceProvider | null {
  return INTELLIGENCE[0] ?? null;
}

/** Quellen, die in dieser Organisation tatsächlich nutzbar sind. */
export async function availableProspectingProviders(ctx: ActorContext) {
  const entries = await Promise.all(
    PROSPECTING.map(async (provider) => ({
      key: provider.key,
      label: provider.label,
      description: provider.description,
      capabilities: provider.capabilities,
      searchable: provider.capabilities.length > 0,
      available: await provider.available(ctx),
    })),
  );
  return entries.filter((entry) => entry.available);
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Sparkles, X } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { SuggestionDTO } from "@/server/services/suggestions";

/**
 * Vorschläge zur Bestätigung — etwa „Als gewonnen markieren?“, weil Mailwin
 * eine Zusage erkannt hat. Mit Beleg (Zitat, Verlässlichkeit, Link), damit die
 * Entscheidung nicht blind fällt.
 */
const SOURCE_LABELS: Record<string, string> = { mailwin: "Mailwin" };
const FIELD_LABELS: Record<string, string> = {
  firstName: "Vorname",
  lastName: "Nachname",
  phone: "Telefon",
  mobile: "Mobil",
  jobTitle: "Position",
  linkedinUrl: "LinkedIn",
  street: "Straße",
  postalCode: "PLZ",
  city: "Ort",
  country: "Land",
};

export function SuggestionsPanel({ items, canDecide }: { items: SuggestionDTO[]; canDecide: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  if (items.length === 0) return null;

  async function decide(item: SuggestionDTO, action: "accept" | "reject") {
    setBusy(`${item.id}:${action}`);
    try {
      await api.post(`/api/v1/suggestions/${item.id}/${action}`, {});
      toast.success(action === "accept" ? "Übernommen" : "Verworfen", item.title.replace(/\?$/, ""));
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Entscheidung konnte nicht gespeichert werden.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2" aria-label="Vorschläge">
      {items.map((item) => {
        const url = item.evidence?.url && /^https?:\/\//i.test(item.evidence.url) ? item.evidence.url : null;
        const fields = item.kind === "contact.update" ? ((item.payload.fields ?? {}) as Record<string, string>) : null;
        return (
          <div key={item.id} className="rounded-lg border border-brand-200 bg-brand-50/60 p-3.5">
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-brand-700">
              <Sparkles className="h-3 w-3" />
              Vorschlag von {SOURCE_LABELS[item.source] ?? item.source}
            </p>
            <p className="mt-1 text-sm font-semibold text-ink-900">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-700">{item.reason}</p>
            {fields ? (
              <ul className="mt-1.5 space-y-0.5 text-xs text-ink-700">
                {Object.entries(fields).map(([key, value]) => (
                  <li key={key}>
                    <span className="text-ink-500">{FIELD_LABELS[key] ?? key}:</span> {value}
                  </li>
                ))}
              </ul>
            ) : null}
            {item.evidence?.quote ? (
              <blockquote className="mt-2 border-l-2 border-brand-300 pl-2.5 text-xs italic text-ink-600">„{item.evidence.quote}“</blockquote>
            ) : null}
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-500">
              <span>{formatDateTime(item.createdAt)}</span>
              {typeof item.evidence?.confidence === "number" ? <span>Verlässlichkeit {Math.round(item.evidence.confidence * 100)} %</span> : null}
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  Nachricht öffnen
                </a>
              ) : null}
            </p>
            {canDecide ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" icon={<Check className="h-3.5 w-3.5" />} loading={busy === `${item.id}:accept`} onClick={() => void decide(item, "accept")}>
                  Übernehmen
                </Button>
                <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} loading={busy === `${item.id}:reject`} onClick={() => void decide(item, "reject")}>
                  Verwerfen
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

/**
 * Übernahme aus einer Quelle.
 *
 * Nur Quellen, die wirklich etwas liefern, erscheinen zur Auswahl. Quellen
 * ohne Suchfunktion — Tabelle, manuelle Eingabe — werden als solche erklärt,
 * statt eine Suchmaske anzubieten, die ins Leere läuft.
 */
type Source = {
  key: string;
  label: string;
  description: string;
  capabilities: string[];
  searchable: boolean;
};

const FIELDS: { value: string; label: string }[] = [
  { value: "", label: "— nicht übernehmen —" },
  { value: "companyName", label: "Firmenname" },
  { value: "domain", label: "Domain" },
  { value: "website", label: "Website" },
  { value: "industry", label: "Branche" },
  { value: "employeeCount", label: "Mitarbeiter" },
  { value: "street", label: "Straße" },
  { value: "postalCode", label: "PLZ" },
  { value: "city", label: "Ort" },
  { value: "country", label: "Land" },
  { value: "phone", label: "Telefon" },
  { value: "firstName", label: "Vorname" },
  { value: "lastName", label: "Nachname" },
  { value: "email", label: "E-Mail" },
  { value: "jobTitle", label: "Position" },
  { value: "linkedinUrl", label: "LinkedIn" },
];

type Result = { created: number; duplicates: number; suppressed: number; skipped: number; note?: string | null };

export function ProspectImport({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [sourceKey, setSourceKey] = React.useState("csv");
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);

  // CSV
  const [filename, setFilename] = React.useState("");
  const [content, setContent] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});

  // Suche
  const [criteria, setCriteria] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    void (async () => {
      try {
        setSources(await api.get<Source[]>("/api/v1/outreach/sources"));
      } catch {
        setSources([]);
      }
    })();
  }, []);

  const source = sources?.find((entry) => entry.key === sourceKey) ?? null;

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setContent(text);
      setFilename(file.name);
      const firstLine = text.split(/\r?\n/)[0] ?? "";
      const delimiter = [",", ";", "\t", "|"]
        .map((candidate) => ({ candidate, count: firstLine.split(candidate).length }))
        .sort((a, b) => b.count - a.count)[0].candidate;
      const columns = firstLine.split(delimiter).map((name) => name.trim().replace(/^"|"$/g, ""));
      setHeaders(columns);

      // Naheliegende Zuordnung vorschlagen — der Mensch bestätigt sie.
      const guessed: Record<string, string> = {};
      for (const column of columns) {
        const normalised = column.toLowerCase();
        if (/firma|unternehmen|company/.test(normalised)) guessed[column] = "companyName";
        else if (/mail/.test(normalised)) guessed[column] = "email";
        else if (/vorname|first/.test(normalised)) guessed[column] = "firstName";
        else if (/nachname|last|name$/.test(normalised)) guessed[column] = "lastName";
        else if (/ort|stadt|city/.test(normalised)) guessed[column] = "city";
        else if (/domain/.test(normalised)) guessed[column] = "domain";
        else if (/telefon|phone/.test(normalised)) guessed[column] = "phone";
        else if (/branche|industry/.test(normalised)) guessed[column] = "industry";
        else if (/position|titel|title/.test(normalised)) guessed[column] = "jobTitle";
      }
      setMapping(guessed);
    };
    reader.readAsText(file);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const body =
        sourceKey === "csv"
          ? {
              mode: "csv",
              filename: filename || "import.csv",
              content,
              mapping: Object.fromEntries(Object.entries(mapping).filter(([, field]) => field)),
            }
          : {
              mode: "search",
              sourceKey,
              ...Object.fromEntries(Object.entries(criteria).filter(([, value]) => value)),
              limit: 100,
            };
      setResult(await api.post<Result>("/api/v1/prospects/import", body));
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Übernahme ist fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Angelegt" value={result.created} tone="ok" />
          <Figure label="Dubletten" value={result.duplicates} />
          <Figure label="Gesperrt" value={result.suppressed} />
          <Figure label="Übersprungen" value={result.skipped} />
        </div>
        <p className="rounded-md bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          Dubletten wurden erkannt und nicht doppelt angelegt. Gesperrte Adressen sind als Prospect vorhanden, aber
          auf &bdquo;Keine Kontaktaufnahme&ldquo; gesetzt — sie lassen sich nicht in eine Sequenz aufnehmen.
          {result.note ? ` ${result.note}` : ""}
        </p>
        <div className="flex justify-end border-t border-ink-200 pt-4">
          <Button variant="primary" onClick={onDone}>
            Fertig
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Quelle" htmlFor="sourceKey">
        <Select id="sourceKey" value={sourceKey} onChange={(event) => setSourceKey(event.target.value)}>
          {(sources ?? []).map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>

      {source ? <p className="-mt-1 text-xs text-ink-500">{source.description}</p> : null}

      {sourceKey === "csv" ? (
        <>
          <Field label="Datei" htmlFor="csvFile">
            <input
              id="csvFile"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file);
              }}
              className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-sm file:text-ink-700 hover:file:bg-ink-200"
            />
          </Field>

          {headers.length > 0 ? (
            <div className="space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Spalten zuordnen</p>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-ink-200 p-3">
                {headers.map((column) => (
                  <div key={column} className="grid grid-cols-2 items-center gap-3">
                    <span className="truncate text-sm text-ink-700">{column}</span>
                    <Select
                      value={mapping[column] ?? ""}
                      onChange={(event) => setMapping((current) => ({ ...current, [column]: event.target.value }))}
                      aria-label={`Zuordnung für ${column}`}
                    >
                      {FIELDS.map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-500">
                Zeilen ohne Firmenname werden übersprungen. Jede übernommene Spalte behält die Datei als Herkunft.
              </p>
            </div>
          ) : null}
        </>
      ) : source?.searchable ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {source.capabilities.includes("freeText") ? (
            <Field label="Suchbegriff" htmlFor="freeText" className="sm:col-span-2">
              <Input id="freeText" value={criteria.freeText ?? ""} onChange={(e) => setCriteria((c) => ({ ...c, freeText: e.target.value }))} />
            </Field>
          ) : null}
          {source.capabilities.includes("industry") ? (
            <Field label="Branche" htmlFor="industry">
              <Input id="industry" value={criteria.industry ?? ""} onChange={(e) => setCriteria((c) => ({ ...c, industry: e.target.value }))} />
            </Field>
          ) : null}
          {source.capabilities.includes("location") ? (
            <Field label="Ort" htmlFor="location">
              <Input id="location" value={criteria.location ?? ""} onChange={(e) => setCriteria((c) => ({ ...c, location: e.target.value }))} />
            </Field>
          ) : null}
          {source.capabilities.includes("employeeCount") ? (
            <>
              <Field label="Mitarbeiter ab" htmlFor="minEmployees">
                <Input id="minEmployees" type="number" min={0} value={criteria.minEmployees ?? ""} onChange={(e) => setCriteria((c) => ({ ...c, minEmployees: e.target.value }))} />
              </Field>
              <Field label="Mitarbeiter bis" htmlFor="maxEmployees">
                <Input id="maxEmployees" type="number" min={0} value={criteria.maxEmployees ?? ""} onChange={(e) => setCriteria((c) => ({ ...c, maxEmployees: e.target.value }))} />
              </Field>
            </>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          Diese Quelle durchsucht nichts. Wählen Sie &bdquo;Tabelle&ldquo;, um Datensätze zu übernehmen, oder legen Sie einen
          Prospect von Hand an.
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          disabled={sourceKey === "csv" ? !content || !Object.values(mapping).includes("companyName") : !source?.searchable}
        >
          Übernehmen
        </Button>
      </div>
    </form>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "ok" }) {
  return (
    <div className="rounded-md border border-ink-200 px-3 py-2">
      <p className="text-2xs font-medium uppercase tracking-wider text-ink-400">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone === "ok" ? "text-success-700" : "text-ink-900"}`}>
        {value}
      </p>
    </div>
  );
}

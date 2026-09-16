"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/field";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/crm/forms/form-kit";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

type ObjectType = "CONTACT" | "COMPANY" | "LEAD";

type Analysis = {
  headers: string[];
  delimiter: string;
  totalRows: number;
  preview: Record<string, string>[];
  suggestedMapping: Record<string, string>;
  targets: { fields: { key: string; label: string; required: boolean }[]; required: string[] };
  truncated: boolean;
};

type ImportResult = {
  id: string;
  totalRows: number;
  imported: number;
  updated: number;
  skipped: number;
  errorCount: number;
  errors: { row: number; message: string }[];
};

type Job = {
  id: string;
  objectType: string;
  filename: string;
  status: string;
  totalRows: number;
  importedRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  createdAt: string;
};

const LABELS: Record<ObjectType, string> = { CONTACT: "Kontakte", COMPANY: "Unternehmen", LEAD: "Leads" };

/** Upload → mapping → preview → import → report. */
export function ImportWizard({ initialObjectType, jobs }: { initialObjectType: ObjectType; jobs: Job[] }) {
  const router = useRouter();
  const toast = useToast();
  const [objectType, setObjectType] = React.useState<ObjectType>(initialObjectType);
  const [filename, setFilename] = React.useState("");
  const [content, setContent] = React.useState("");
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = React.useState<"SKIP" | "UPDATE" | "CREATE_ANYWAY">("SKIP");
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    const text = await file.text();
    setFilename(file.name);
    setContent(text);
    setPending(true);
    try {
      const data = await api.post<Analysis>("/api/v1/imports/analyze", { objectType, filename: file.name, content: text });
      setAnalysis(data);
      setMapping(data.suggestedMapping);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Datei konnte nicht gelesen werden.");
      setAnalysis(null);
    } finally {
      setPending(false);
    }
  }

  async function runImport() {
    setPending(true);
    setError(null);
    try {
      const data = await api.post<ImportResult>("/api/v1/imports/run", {
        objectType,
        filename,
        content,
        mapping,
        duplicateStrategy,
      });
      setResult(data);
      toast.success(`${data.imported} importiert, ${data.updated} aktualisiert.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Der Import ist fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  const missingRequired = analysis
    ? analysis.targets.required.filter((field) => !Object.values(mapping).includes(field))
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="1 · Datei auswählen" />
        <CardBody className="space-y-4">
          <FormError message={error} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Zielobjekt" htmlFor="import-object">
              <Select
                id="import-object"
                value={objectType}
                onChange={(event) => {
                  setObjectType(event.target.value as ObjectType);
                  setAnalysis(null);
                  setResult(null);
                }}
              >
                {(Object.keys(LABELS) as ObjectType[]).map((key) => (
                  <option key={key} value={key}>
                    {LABELS[key]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Duplikate" htmlFor="import-duplicates" hint="Kontakte werden über die E-Mail, Unternehmen über Domain oder Name erkannt.">
              <Select
                id="import-duplicates"
                value={duplicateStrategy}
                onChange={(event) => setDuplicateStrategy(event.target.value as typeof duplicateStrategy)}
              >
                <option value="SKIP">Überspringen</option>
                <option value="UPDATE">Bestehenden Datensatz aktualisieren</option>
                <option value="CREATE_ANYWAY">Trotzdem neu anlegen</option>
              </Select>
            </Field>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} loading={pending && !analysis} onClick={() => inputRef.current?.click()}>
            CSV-Datei auswählen
          </Button>
          {filename ? <p className="text-xs text-ink-600">Gewählt: {filename}</p> : null}
        </CardBody>
      </Card>

      {analysis ? (
        <>
          <Card>
            <CardHeader
              title="2 · Spalten zuordnen"
              description={`${analysis.totalRows} Zeilen erkannt · Trennzeichen "${analysis.delimiter === "\t" ? "Tab" : analysis.delimiter}"`}
            />
            <CardBody className="space-y-3">
              {analysis.truncated ? (
                <p className="rounded-md border border-warning-500/30 bg-warning-50 px-3 py-2 text-xs text-warning-700">
                  Die Datei wurde auf die maximale Zeilenzahl gekürzt. Bitte in kleineren Teilen importieren.
                </p>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                {analysis.headers.map((header) => (
                  <Field key={header} label={header} htmlFor={`map-${header}`}>
                    <Select
                      id={`map-${header}`}
                      value={mapping[header] ?? ""}
                      onChange={(event) =>
                        setMapping((current) => {
                          const next = { ...current };
                          if (event.target.value) next[header] = event.target.value;
                          else delete next[header];
                          return next;
                        })
                      }
                    >
                      <option value="">— nicht importieren —</option>
                      {analysis.targets.fields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                          {field.required ? " *" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>

              {missingRequired.length > 0 ? (
                <p className="flex items-center gap-2 rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-xs text-danger-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Pflichtfelder fehlen: {missingRequired.join(", ")}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="3 · Vorschau" description="Die ersten Zeilen so, wie sie importiert würden." />
            <DataTable>
              <thead>
                <tr>
                  {analysis.headers.map((header) => (
                    <Th key={header}>
                      {header}
                      {mapping[header] ? (
                        <span className="ml-1 font-normal normal-case text-brand-600">→ {mapping[header]}</span>
                      ) : (
                        <span className="ml-1 font-normal normal-case text-ink-400">ignoriert</span>
                      )}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.preview.map((row, index) => (
                  <Tr key={index}>
                    {analysis.headers.map((header) => (
                      <Td key={header}>{row[header] || <span className="text-ink-300">—</span>}</Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </DataTable>
            <div className="flex justify-end border-t border-ink-200 px-4 py-3">
              <Button
                variant="primary"
                icon={<Upload className="h-4 w-4" />}
                loading={pending}
                disabled={missingRequired.length > 0}
                onClick={runImport}
              >
                {analysis.totalRows} Zeilen importieren
              </Button>
            </div>
          </Card>
        </>
      ) : null}

      {result ? (
        <Card>
          <CardHeader title="4 · Ergebnis" />
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Importiert" value={result.imported} tone="success" />
              <Stat label="Aktualisiert" value={result.updated} />
              <Stat label="Übersprungen" value={result.skipped} />
              <Stat label="Fehler" value={result.errorCount} tone={result.errorCount > 0 ? "danger" : undefined} />
            </div>

            {result.errors.length > 0 ? (
              <div className="rounded-md border border-danger-500/20 bg-danger-50/60 p-3">
                <p className="text-xs font-medium text-danger-700">Fehlerhafte Zeilen</p>
                <ul className="mt-1 space-y-0.5">
                  {result.errors.map((rowError) => (
                    <li key={rowError.row} className="text-2xs text-danger-700">
                      Zeile {rowError.row}: {rowError.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-xs text-success-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Alle Zeilen konnten verarbeitet werden.
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader title="Letzte Importe" />
        {jobs.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-ink-500">Noch keine Importe ausgeführt.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-xs text-ink-800">{job.filename}</span>
                <span className="text-2xs text-ink-500">
                  {LABELS[job.objectType as ObjectType] ?? job.objectType} · {job.importedRows} neu · {job.updatedRows} aktualisiert ·{" "}
                  {job.skippedRows} übersprungen · {job.errorRows} Fehler
                </span>
                <span className="text-2xs text-ink-400">{formatDateTime(job.createdAt)}</span>
                <Badge tone={job.status === "COMPLETED" ? "success" : job.status === "FAILED" ? "danger" : "neutral"}>
                  {job.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" }) {
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50/50 px-3 py-2.5">
      <p className="text-2xs text-ink-500">{label}</p>
      <p
        className={`mt-0.5 text-xl font-semibold tabular-nums ${
          tone === "success" ? "text-success-700" : tone === "danger" ? "text-danger-600" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

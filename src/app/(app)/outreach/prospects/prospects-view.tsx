"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { DataTable, Pagination, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Field, Input, Select } from "@/components/ui/field";
import { Drawer } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { ProspectImport } from "./prospect-import";

export const STAGE_LABELS: Record<string, string> = {
  NEW: "Neu",
  RESEARCHING: "In Recherche",
  QUALIFIED: "Qualifiziert",
  READY: "Bereit",
  IN_SEQUENCE: "In Sequenz",
  REPLIED: "Hat geantwortet",
  INTERESTED: "Interessiert",
  NOT_INTERESTED: "Kein Interesse",
  MEETING: "Termin",
  CONVERTED: "Übernommen",
  DISQUALIFIED: "Aussortiert",
  DO_NOT_CONTACT: "Keine Kontaktaufnahme",
};

export const STAGE_TONES: Record<string, BadgeTone> = {
  NEW: "neutral",
  RESEARCHING: "neutral",
  QUALIFIED: "brand",
  READY: "brand",
  IN_SEQUENCE: "accent",
  REPLIED: "accent",
  INTERESTED: "success",
  NOT_INTERESTED: "neutral",
  MEETING: "success",
  CONVERTED: "success",
  DISQUALIFIED: "neutral",
  DO_NOT_CONTACT: "danger",
};

type Prospect = {
  id: string;
  stage: string;
  companyName: string;
  domain: string | null;
  city: string | null;
  industry: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  sourceKey: string;
  owner: { id: string; name: string } | null;
  updatedAt: string;
};

type Page = { items: Prospect[]; total: number; page: number; pageSize: number; totalPages: number };

export function ProspectsView({ canWrite, canEnroll }: { canWrite: boolean; canEnroll: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();

  const [result, setResult] = React.useState<Page | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [stage, setStage] = React.useState(params.get("stage") ?? "");
  const [page, setPage] = React.useState(1);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (debounced) query.set("search", debounced);
      if (stage) query.set("stage", stage);
      setResult(await api.get(`/api/v1/prospects?${query}`));
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Prospects konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [debounced, page, stage, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1" data-tour="prospect-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Prospects durchsuchen…"
            className="pl-9"
            aria-label="Suche"
          />
        </div>

        <Select
          value={stage}
          onChange={(event) => {
            setStage(event.target.value);
            setPage(1);
          }}
          aria-label="Stufe"
          className="w-48"
        >
          <option value="">Alle Stufen</option>
          {Object.entries(STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        {canWrite ? (
          <>
            <Button icon={<Upload className="h-4 w-4" />} onClick={() => setShowImport(true)}>
              Importieren
            </Button>
            <Button
              variant="primary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setShowCreate(true)}
              data-tour="prospect-create"
            >
              Prospect anlegen
            </Button>
          </>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {loading && !result ? (
          <SkeletonTable />
        ) : result && result.items.length === 0 ? (
          <EmptyState
            title={debounced || stage ? "Keine Treffer" : "Noch keine Prospects"}
            description={
              debounced || stage
                ? "Für diese Suche gibt es keine Datensätze."
                : "Legen Sie einen an oder übernehmen Sie welche aus einer Tabelle oder Ihrem eigenen Bestand."
            }
            actions={
              canWrite ? (
                <Button variant="primary" onClick={() => setShowImport(true)}>
                  Prospects übernehmen
                </Button>
              ) : null
            }
          />
        ) : result ? (
          <>
            <DataTable>
              <thead>
                <tr>
                  <Th>Unternehmen</Th>
                  <Th>Ansprechpartner</Th>
                  <Th>Stufe</Th>
                  <Th>Ort</Th>
                  <Th>Quelle</Th>
                  <Th>Zuletzt</Th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((prospect) => (
                  <Tr key={prospect.id}>
                    <Td>
                      <Link
                        href={`/outreach/prospects/${prospect.id}`}
                        className="font-medium text-ink-900 hover:text-brand-600"
                      >
                        {prospect.companyName}
                      </Link>
                      {prospect.domain ? <p className="text-2xs text-ink-400">{prospect.domain}</p> : null}
                    </Td>
                    <Td>
                      {prospect.firstName || prospect.lastName ? (
                        <>
                          <p className="text-ink-800">{[prospect.firstName, prospect.lastName].filter(Boolean).join(" ")}</p>
                          {prospect.email ? <p className="text-2xs text-ink-400">{prospect.email}</p> : null}
                        </>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STAGE_TONES[prospect.stage] ?? "neutral"}>
                        {STAGE_LABELS[prospect.stage] ?? prospect.stage}
                      </Badge>
                    </Td>
                    <Td>{prospect.city ?? <span className="text-ink-400">—</span>}</Td>
                    <Td className="text-ink-500">{prospect.sourceKey}</Td>
                    <Td className="text-ink-500">{formatDate(prospect.updatedAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              totalPages={result.totalPages}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </Card>

      <Drawer open={showCreate} onClose={() => setShowCreate(false)} title="Prospect anlegen">
        <ProspectForm
          onDone={(id) => {
            setShowCreate(false);
            toast.success("Prospect angelegt.");
            router.push(`/outreach/prospects/${id}`);
          }}
          onCancel={() => setShowCreate(false)}
        />
      </Drawer>

      <Drawer open={showImport} onClose={() => setShowImport(false)} title="Prospects übernehmen" width="lg">
        <ProspectImport
          onDone={() => {
            setShowImport(false);
            void load();
          }}
          onCancel={() => setShowImport(false)}
        />
      </Drawer>

      {canEnroll ? null : null}
    </div>
  );
}

function ProspectForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const toast = useToast();
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFieldErrors({});
    try {
      const created = await api.post<{ id: string }>("/api/v1/prospects", {
        ...values,
        employeeCount: values.employeeCount ? Number(values.employeeCount) : undefined,
      });
      onDone(created.id);
    } catch (cause) {
      if (cause instanceof ApiError) setFieldErrors(cause.fields);
      toast.error(cause instanceof ApiError ? cause.message : "Der Prospect konnte nicht angelegt werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Firmenname" htmlFor="companyName" error={fieldErrors.companyName} required className="sm:col-span-2">
          <Input id="companyName" value={values.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} autoFocus required />
        </Field>
        <Field label="Domain" htmlFor="domain" error={fieldErrors.domain}>
          <Input id="domain" placeholder="beispiel.de" value={values.domain ?? ""} onChange={(e) => set("domain", e.target.value)} />
        </Field>
        <Field label="Branche" htmlFor="industry">
          <Input id="industry" value={values.industry ?? ""} onChange={(e) => set("industry", e.target.value)} />
        </Field>
        <Field label="Ort" htmlFor="city">
          <Input id="city" value={values.city ?? ""} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="Mitarbeiter" htmlFor="employeeCount">
          <Input id="employeeCount" type="number" min={0} value={values.employeeCount ?? ""} onChange={(e) => set("employeeCount", e.target.value)} />
        </Field>
      </div>

      <div className="border-t border-ink-200 pt-4">
        <p className="mb-3 text-2xs font-semibold uppercase tracking-wider text-ink-400">Ansprechpartner</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vorname" htmlFor="firstName">
            <Input id="firstName" value={values.firstName ?? ""} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Nachname" htmlFor="lastName">
            <Input id="lastName" value={values.lastName ?? ""} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="E-Mail" htmlFor="email" error={fieldErrors.email}>
            <Input id="email" type="email" value={values.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Position" htmlFor="jobTitle">
            <Input id="jobTitle" value={values.jobTitle ?? ""} onChange={(e) => set("jobTitle", e.target.value)} />
          </Field>
        </div>
      </div>

      <p className="rounded-md bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-500">
        Ohne E-Mail-Adresse lässt sich der Prospect recherchieren und qualifizieren, aber nicht in eine Sequenz
        aufnehmen. Die Herkunft wird als &bdquo;manuell angelegt&ldquo; festgehalten.
      </p>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Prospect anlegen
        </Button>
      </div>
    </form>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { Filter, ListChecks, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Drawer, ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";

type ProspectList = {
  id: string;
  name: string;
  description: string | null;
  kind: "STATIC" | "DYNAMIC";
  count: number;
  owner: { id: string; name: string } | null;
};

const FILTER_FIELDS = [
  { value: "city", label: "Ort" },
  { value: "industry", label: "Branche" },
  { value: "country", label: "Land" },
  { value: "domain", label: "Domain" },
  { value: "companyName", label: "Firmenname" },
  { value: "jobTitle", label: "Position" },
  { value: "stage", label: "Stufe" },
  { value: "sourceKey", label: "Quelle" },
  { value: "employeeCount", label: "Mitarbeiter" },
  { value: "score", label: "Bewertung" },
];

const OPERATORS = [
  { value: "eq", label: "ist gleich" },
  { value: "neq", label: "ist nicht" },
  { value: "contains", label: "enthält" },
  { value: "starts_with", label: "beginnt mit" },
  { value: "gte", label: "mindestens" },
  { value: "lte", label: "höchstens" },
  { value: "known", label: "ist bekannt" },
  { value: "unknown", label: "ist unbekannt" },
];

export function ListsView({ canWrite }: { canWrite: boolean }) {
  const toast = useToast();
  const [lists, setLists] = React.useState<ProspectList[] | null>(null);
  const [editing, setEditing] = React.useState<"new" | ProspectList | null>(null);
  const [deleting, setDeleting] = React.useState<ProspectList | null>(null);

  const load = React.useCallback(async () => {
    try {
      setLists(await api.get<ProspectList[]>("/api/v1/prospect-lists"));
    } catch {
      setLists([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function archive() {
    if (!deleting) return;
    try {
      await api.delete(`/api/v1/prospect-lists/${deleting.id}`);
      toast.success("Liste archiviert.");
      setDeleting(null);
      void load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Liste konnte nicht archiviert werden.");
    }
  }

  if (!lists) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
            Liste erstellen
          </Button>
        </div>
      ) : null}

      {lists.length === 0 ? (
        <Card>
          <EmptyState
            title="Noch keine Listen"
            description="Eine Liste bündelt Prospects für Recherche und Ansprache. Für eine laufende Kampagne ist eine statische Liste richtig — sonst stünden morgen andere Menschen darin als gestern."
            actions={canWrite ? <Button variant="primary" onClick={() => setEditing("new")}>Liste erstellen</Button> : null}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <Card key={list.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/outreach/prospects?listId=${list.id}`}
                    className="truncate font-medium text-ink-900 hover:text-brand-600"
                  >
                    {list.name}
                  </Link>
                  {list.description ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{list.description}</p> : null}
                </div>
                <Badge tone={list.kind === "DYNAMIC" ? "accent" : "neutral"}>
                  {list.kind === "DYNAMIC" ? "dynamisch" : "statisch"}
                </Badge>
              </div>

              <p className="mt-3 flex items-baseline gap-1.5 text-sm text-ink-600">
                <ListChecks className="h-4 w-4 text-ink-400" />
                <span className="font-medium tabular-nums text-ink-900">{formatNumber(list.count)}</span>
                Prospects
              </p>

              {canWrite ? (
                <div className="mt-3 flex items-center gap-1 border-t border-ink-100 pt-3">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(list)}>
                    Bearbeiten
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(list)} aria-label="Archivieren">
                    <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                  </Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Liste erstellen" : "Liste bearbeiten"}
      >
        {editing ? (
          <ListForm
            list={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              void load();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={archive}
        title="Liste archivieren"
        description="Die Prospects bleiben erhalten — nur die Liste verschwindet aus der Übersicht."
        confirmLabel="Archivieren"
      />
    </div>
  );
}

function ListForm({
  list,
  onDone,
  onCancel,
}: {
  list: ProspectList | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(list?.name ?? "");
  const [description, setDescription] = React.useState(list?.description ?? "");
  const [kind, setKind] = React.useState<"STATIC" | "DYNAMIC">(list?.kind ?? "STATIC");
  const [conditions, setConditions] = React.useState<{ field: string; operator: string; value: string }[]>([
    { field: "city", operator: "eq", value: "" },
  ]);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const body = {
        name,
        description: description || undefined,
        kind,
        filter:
          kind === "DYNAMIC"
            ? {
                combinator: "AND",
                conditions: conditions
                  .filter((entry) => entry.field && (entry.value || ["known", "unknown"].includes(entry.operator)))
                  .map((entry) => ({ field: entry.field, operator: entry.operator, value: entry.value })),
              }
            : undefined,
      };
      if (list) await api.put(`/api/v1/prospect-lists/${list.id}`, body);
      else await api.post("/api/v1/prospect-lists", body);
      toast.success(list ? "Liste gespeichert." : "Liste erstellt.");
      onDone();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Liste konnte nicht gespeichert werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name" htmlFor="listName" required>
        <Input id="listName" value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
      </Field>
      <Field label="Beschreibung" htmlFor="listDescription">
        <Textarea id="listDescription" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>

      <Field label="Art" htmlFor="listKind">
        <Select id="listKind" value={kind} onChange={(event) => setKind(event.target.value as "STATIC" | "DYNAMIC")}>
          <option value="STATIC">Statisch — feste Auswahl</option>
          <option value="DYNAMIC">Dynamisch — ergibt sich aus einem Filter</option>
        </Select>
      </Field>

      <p className="rounded-md bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
        {kind === "STATIC"
          ? "Die Mitglieder ändern sich nur, wenn jemand sie ändert. Für eine laufende Kampagne ist das die richtige Wahl."
          : "Die Mitglieder ergeben sich jedes Mal neu aus dem Filter. Praktisch für Recherche — für eine Kampagne heikel, weil morgen andere Menschen darin stehen können."}
      </p>

      {kind === "DYNAMIC" ? (
        <div className="space-y-2">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Filter</p>
          {conditions.map((condition, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
              <Select
                value={condition.field}
                onChange={(event) =>
                  setConditions((current) => current.map((entry, i) => (i === index ? { ...entry, field: event.target.value } : entry)))
                }
                aria-label="Feld"
              >
                {FILTER_FIELDS.map((field) => (
                  <option key={field.value} value={field.value}>{field.label}</option>
                ))}
              </Select>
              <Select
                value={condition.operator}
                onChange={(event) =>
                  setConditions((current) => current.map((entry, i) => (i === index ? { ...entry, operator: event.target.value } : entry)))
                }
                aria-label="Vergleich"
              >
                {OPERATORS.map((operator) => (
                  <option key={operator.value} value={operator.value}>{operator.label}</option>
                ))}
              </Select>
              <Input
                value={condition.value}
                onChange={(event) =>
                  setConditions((current) => current.map((entry, i) => (i === index ? { ...entry, value: event.target.value } : entry)))
                }
                disabled={["known", "unknown"].includes(condition.operator)}
                aria-label="Wert"
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setConditions((current) => current.filter((_, i) => i !== index))}
                disabled={conditions.length === 1}
                aria-label="Bedingung entfernen"
              >
                <Trash2 className="h-3.5 w-3.5 text-ink-400" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            icon={<Filter className="h-3.5 w-3.5" />}
            onClick={() => setConditions((current) => [...current, { field: "city", operator: "eq", value: "" }])}
          >
            Bedingung hinzufügen
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>Abbrechen</Button>
        <Button type="submit" variant="primary" loading={pending}>
          {list ? "Änderungen speichern" : "Liste erstellen"}
        </Button>
      </div>
    </form>
  );
}

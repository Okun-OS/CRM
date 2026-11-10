"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { auditActionLabel, auditChanges, auditEntityHref, auditEntityLabel } from "@/lib/audit-labels";

type Entry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string; name: string } | null;
  actorEmail: string | null;
  origin: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
};

type Page = { items: Entry[]; page: number; pageSize: number; total: number; totalPages: number };

export function AuditView({ initial, members }: { initial: Page; members: { id: string; name: string }[] }) {
  const [data, setData] = React.useState(initial);
  const [page, setPage] = React.useState(1);
  const [actorId, setActorId] = React.useState("");
  const [action, setAction] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Zeitpunkte erst im Browser formatieren: Der Server rechnet in UTC, der
  // Browser in Ortszeit — sonst passten die erste Darstellung und die im
  // Browser nicht zusammen.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);

  const load = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (actorId) params.set("actorId", actorId);
    if (action) params.set("action", action);
    try {
      setData(await api.get<Page>(`/api/v1/audit?${params.toString()}`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Das Audit Log konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [page, actorId, action]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={actorId}
          onChange={(event) => {
            setActorId(event.target.value);
            setPage(1);
          }}
          className="h-9 w-52"
          aria-label="Benutzer"
        >
          <option value="">Alle Benutzer</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
        <Input
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
          placeholder="Technischer Name, z. B. deal.stage_changed"
          className="h-9 max-w-xs"
          aria-label="Aktion"
        />
        <Button variant="ghost" onClick={() => void load()} loading={loading}>
          Aktualisieren
        </Button>
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="Fehler beim Laden" description={error} />
        ) : data.items.length === 0 ? (
          <EmptyState title="Keine Einträge" description="Für die gewählten Filter gibt es keine Protokolleinträge." compact />
        ) : (
          <>
            <ul className="divide-y divide-ink-100">
              {data.items.map((entry) => {
                const changes = hydrated ? auditChanges(entry.before, entry.after) : [];
                const href = auditEntityHref(entry.entityType, entry.entityId);
                return (
                  <li key={entry.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-xs font-medium text-ink-900">
                        {auditActionLabel(entry.action)}
                        <span className="ml-2 font-normal text-ink-500">
                          {auditEntityLabel(entry.entityType)}
                          {href ? (
                            <>
                              {" · "}
                              <Link href={href} className="text-brand-600 hover:text-brand-700">
                                öffnen
                              </Link>
                            </>
                          ) : null}
                        </span>
                      </p>
                      <span className="text-2xs text-ink-400">
                        {entry.origin === "mailwin" ? (
                          <span className="mr-1.5 rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">über Mailwin</span>
                        ) : null}
                        {entry.actor?.name ?? entry.actorEmail ?? "System"}
                        {hydrated ? ` · ${formatDateTime(entry.createdAt)}` : ""}
                        {entry.ip ? ` · ${entry.ip}` : ""}
                      </span>
                    </div>
                    {changes.length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5 text-2xs text-ink-600">
                        {changes.slice(0, 8).map((change) => (
                          <li key={change.field}>
                            <span className="text-ink-500">{change.label}:</span>{" "}
                            {change.before !== null && change.after !== null ? (
                              <>
                                <span className="text-ink-500 line-through decoration-ink-300">{change.before}</span> → {change.after}
                              </>
                            ) : (
                              (change.after ?? change.before)
                            )}
                          </li>
                        ))}
                        {changes.length > 8 ? <li className="text-ink-400">… und {changes.length - 8} weitere Felder</li> : null}
                      </ul>
                    ) : null}
                    <details className="mt-1 text-2xs text-ink-400">
                      <summary className="cursor-pointer select-none hover:text-ink-600">Technische Details</summary>
                      <p className="mt-1">
                        <code className="font-mono">{entry.action}</code> · {entry.entityType}
                        {entry.entityId ? ` · ${entry.entityId}` : ""}
                      </p>
                      {entry.before || entry.after ? (
                        <pre className="mt-1 overflow-x-auto rounded bg-ink-50 p-2 leading-relaxed text-ink-600">
                          {JSON.stringify({ vorher: entry.before ?? null, nachher: entry.after ?? null }, null, 2)}
                        </pre>
                      ) : null}
                    </details>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}

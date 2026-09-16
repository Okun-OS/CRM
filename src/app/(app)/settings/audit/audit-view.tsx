"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

type Entry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string; name: string } | null;
  actorEmail: string | null;
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
          placeholder="Aktion filtern, z. B. deal.stage_changed"
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
              {data.items.map((entry) => (
                <li key={entry.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-ink-900">
                      <code className="font-mono">{entry.action}</code>
                      <span className="ml-2 font-normal text-ink-500">
                        {entry.entityType}
                        {entry.entityId ? ` · ${entry.entityId.slice(0, 10)}…` : ""}
                      </span>
                    </p>
                    <span className="text-2xs text-ink-400">
                      {entry.actor?.name ?? entry.actorEmail ?? "System"} · {formatDateTime(entry.createdAt)}
                      {entry.ip ? ` · ${entry.ip}` : ""}
                    </span>
                  </div>
                  {entry.before || entry.after ? (
                    <pre className="mt-1.5 overflow-x-auto rounded bg-ink-50 p-2 text-2xs leading-relaxed text-ink-600">
                      {JSON.stringify({ vorher: entry.before ?? null, nachher: entry.after ?? null }, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
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

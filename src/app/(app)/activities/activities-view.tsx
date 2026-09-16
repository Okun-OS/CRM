"use client";

import * as React from "react";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Pagination } from "@/components/ui/table";
import { SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Drawer } from "@/components/ui/modal";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { ActivityForm } from "@/components/crm/forms/simple-forms";
import { useReference } from "@/components/app/reference-provider";
import { api, ApiError } from "@/lib/api-client";
import type { ActivityDTO } from "@/server/services/activities";

const TYPES = [
  { key: "", label: "Alle Typen" },
  { key: "CALL", label: "Anrufe" },
  { key: "EMAIL", label: "E-Mails" },
  { key: "MEETING", label: "Meetings" },
  { key: "NOTE", label: "Notizen" },
  { key: "TASK", label: "Aufgaben" },
  { key: "SYSTEM", label: "Systemereignisse" },
];

/** Organization-wide activity feed with type and owner filters. */
export function ActivitiesView({ canLog, currentUserId }: { canLog: boolean; currentUserId: string }) {
  const { data: reference } = useReference();
  const [type, setType] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [result, setResult] = React.useState<{
    items: ActivityDTO[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [logging, setLogging] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (type) params.set("type", type);
    if (ownerId) params.set("ownerId", ownerId);
    try {
      setResult(await api.get(`/api/v1/activities?${params.toString()}`));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Aktivitäten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [page, type, ownerId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
          className="h-9 w-48"
          aria-label="Aktivitätstyp"
        >
          {TYPES.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </Select>

        <Select
          value={ownerId}
          onChange={(event) => {
            setOwnerId(event.target.value);
            setPage(1);
          }}
          className="h-9 w-48"
          aria-label="Benutzer"
        >
          <option value="">Alle Benutzer</option>
          <option value={currentUserId}>Nur meine</option>
          {reference?.members
            .filter((member) => member.id !== currentUserId)
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
        </Select>

        <div className="flex-1" />

        {canLog ? (
          <Button variant="primary" icon={<PhoneCall className="h-4 w-4" />} onClick={() => setLogging(true)}>
            Aktivität protokollieren
          </Button>
        ) : null}
      </div>

      <Card>
        <div className="p-4">
          {loading && !result ? (
            <SkeletonText lines={8} />
          ) : error ? (
            <EmptyState title="Fehler beim Laden" description={error} actions={<Button onClick={() => void load()}>Erneut versuchen</Button>} />
          ) : result && result.items.length === 0 ? (
            <EmptyState
              title="Noch keine Aktivitäten"
              description="Sobald Anrufe, E-Mails, Meetings oder Notizen erfasst werden, erscheinen sie hier."
              compact
            />
          ) : (
            <ActivityTimeline items={result?.items ?? []} />
          )}
        </div>
        {result && result.total > 0 ? (
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            totalPages={result.totalPages}
            onPageChange={setPage}
          />
        ) : null}
      </Card>

      <Drawer open={logging} onClose={() => setLogging(false)} title="Aktivität protokollieren">
        <ActivityForm
          links={{}}
          onDone={() => {
            setLogging(false);
            void load();
          }}
          onCancel={() => setLogging(false)}
        />
      </Drawer>
    </div>
  );
}

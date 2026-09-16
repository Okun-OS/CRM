"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Clock, Loader2, RefreshCw, Sparkles, Target, UserRound } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatRelative } from "@/lib/format";
import {
  MOMENTUM_LABELS,
  MOMENTUM_TONE,
  NEXT_ACTION_LABELS,
  OPERATIONAL_STATE_LABELS,
  OPERATIONAL_STATE_TONE,
  PRIORITY,
  type ActionBucketKey,
} from "@/lib/crm/active";
import type { Momentum, NextActionType, OperationalState } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

type ActionItem = {
  id: string;
  type: NextActionType;
  title: string;
  reason: string;
  ruleKey: string | null;
  isManual: boolean;
  dueAt: string | null;
  priority: number;
  owner: { id: string; name: string } | null;
  record: { kind: "DEAL" | "LEAD"; id: string; label: string; amount: number | null; currency: string | null };
  operationalState: OperationalState;
  momentum: Momentum;
  taskId: string | null;
};

type Bucket = { key: ActionBucketKey; label: string; description: string; items: ActionItem[] };
type ActionCenterData = { generatedAt: string; total: number; buckets: Bucket[] };

export function ActionCenter({
  currentUser,
  canEdit,
}: {
  currentUser: { id: string; name: string };
  canEdit: boolean;
}) {
  const toast = useToast();
  const [scope, setScope] = React.useState<"mine" | "team">("mine");
  const [data, setData] = React.useState<ActionCenterData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<ActionCenterData>(`/api/v1/action-center?scope=${scope}`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Das Action Center konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function complete(item: ActionItem) {
    setBusyId(item.id);
    try {
      await api.post(`/api/v1/next-actions/${item.id}/complete`, {});
      toast.success("Erledigt", item.title);
      await load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Aktion konnte nicht abgeschlossen werden.");
    } finally {
      setBusyId(null);
    }
  }

  const filled = data?.buckets.filter((bucket) => bucket.items.length > 0) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { key: "mine", label: "Meine Aktionen", count: scope === "mine" ? data?.total : undefined },
            { key: "team", label: "Gesamtes Team", count: scope === "team" ? data?.total : undefined },
          ]}
          active={scope}
          onChange={(key) => setScope(key as "mine" | "team")}
          className="border-b-0"
        />
        <div className="flex items-center gap-3 text-2xs text-ink-500">
          {data ? <span>Stand {formatDate(data.generatedAt)}</span> : null}
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load()}>
            Aktualisieren
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-8 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Aktionen werden geladen …
        </div>
      ) : error ? (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-4 text-sm text-danger-700">{error}</div>
      ) : filled.length === 0 ? (
        <EmptyState
          icon={<Check className="h-6 w-6" />}
          title="Nichts offen"
          description={
            scope === "mine"
              ? `Für ${currentUser.name} ist aktuell keine Aktion fällig. Sobald sich an einem Deal oder Lead etwas ändert, erscheint hier der nächste Schritt.`
              : "Für das Team ist aktuell keine Aktion offen."
          }
        />
      ) : (
        <div className="space-y-5">
          {filled.map((bucket) => (
            <section key={bucket.key}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-ink-900">{bucket.label}</h2>
                <span className="rounded-full bg-ink-100 px-2 py-0.5 text-2xs font-medium tabular-nums text-ink-600">
                  {bucket.items.length}
                </span>
                <p className="truncate text-2xs text-ink-500">{bucket.description}</p>
              </div>

              <ul className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-200 bg-white">
                {bucket.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3 transition-colors hover:bg-ink-50/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={item.record.kind === "DEAL" ? `/deals/${item.record.id}` : `/leads/${item.record.id}`}
                          className="truncate text-sm font-medium text-ink-900 hover:text-brand-600"
                        >
                          {item.record.label}
                        </Link>
                        <Badge tone={OPERATIONAL_STATE_TONE[item.operationalState]}>
                          {OPERATIONAL_STATE_LABELS[item.operationalState]}
                        </Badge>
                        <Badge tone={MOMENTUM_TONE[item.momentum]}>{MOMENTUM_LABELS[item.momentum]}</Badge>
                        {item.priority >= PRIORITY.CRITICAL ? <Badge tone="danger">Dringend</Badge> : null}
                      </div>

                      <p className="mt-1 text-sm text-ink-800">
                        <span className="text-ink-500">{NEXT_ACTION_LABELS[item.type]}:</span> {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">{item.reason}</p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-500">
                        <span className={cn("inline-flex items-center gap-1", isOverdue(item.dueAt) && "font-semibold text-danger-600")}>
                          <Clock className="h-3 w-3" />
                          {item.dueAt ? `${formatDate(item.dueAt)} · ${formatRelative(item.dueAt)}` : "ohne Fälligkeit"}
                        </span>
                        {item.record.amount !== null ? (
                          <span className="inline-flex items-center gap-1">
                            <Target className="h-3 w-3" />
                            {formatCurrency(item.record.amount, item.record.currency ?? "EUR")}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="h-3 w-3" /> {item.owner?.name ?? "nicht zugewiesen"}
                        </span>
                        <span className="inline-flex items-center gap-1 text-ink-400">
                          <Sparkles className="h-3 w-3" />
                          {item.isManual ? "manuell festgelegt" : `Regel ${item.ruleKey}`}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={item.record.kind === "DEAL" ? `/deals/${item.record.id}` : `/leads/${item.record.id}`}
                        className="text-xs text-brand-600 hover:text-brand-700"
                      >
                        Öffnen
                      </Link>
                      {canEdit ? (
                        <Button
                          size="sm"
                          icon={<Check className="h-3.5 w-3.5" />}
                          loading={busyId === item.id}
                          onClick={() => void complete(item)}
                        >
                          Erledigt
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function isOverdue(dueAt: string | null): boolean {
  return dueAt !== null && new Date(dueAt).getTime() < Date.now();
}

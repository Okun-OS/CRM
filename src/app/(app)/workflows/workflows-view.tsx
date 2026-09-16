"use client";

import * as React from "react";
import { Pencil, Plus, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Drawer, ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { WorkflowBuilder } from "./workflow-builder";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime, formatRelative } from "@/lib/format";
import { TRIGGER_LABELS, ACTION_LABELS } from "@/server/workflows/types";
import { OBJECT_LABELS } from "@/lib/crm/fields";
import type { CrmObjectType } from "@/generated/prisma/enums";

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  objectType: CrmObjectType;
  triggerType: keyof typeof TRIGGER_LABELS;
  triggerConfig: Record<string, unknown>;
  conditions: unknown;
  actions: { type: keyof typeof ACTION_LABELS }[];
  isActive: boolean;
  runCount: number;
  lastRunAt: string | null;
  createdBy: { id: string; name: string } | null;
};

type Execution = {
  id: string;
  workflow: { id: string; name: string };
  entityType: string;
  entityId: string;
  status: string;
  steps: { action: string; status: string; detail?: string }[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const EXECUTION_TONE: Record<string, BadgeTone> = {
  SUCCEEDED: "success",
  FAILED: "danger",
  SKIPPED: "neutral",
  RUNNING: "brand",
};

export function WorkflowsView({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const [tab, setTab] = React.useState("workflows");
  const [workflows, setWorkflows] = React.useState<Workflow[]>([]);
  const [executions, setExecutions] = React.useState<Execution[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Workflow | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<Workflow | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [workflowList, executionList] = await Promise.all([
        api.get<Workflow[]>("/api/v1/workflows"),
        api.get<{ items: Execution[] }>("/api/v1/workflows/executions?pageSize=25"),
      ]);
      setWorkflows(workflowList);
      setExecutions(executionList.items);
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Workflows konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function toggle(workflow: Workflow) {
    try {
      await api.patch(`/api/v1/workflows/${workflow.id}`, { isActive: !workflow.isActive });
      toast.success(workflow.isActive ? "Workflow deaktiviert." : "Workflow aktiviert.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Status konnte nicht geändert werden.");
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api.delete(`/api/v1/workflows/${deleting.id}`);
      toast.success("Workflow gelöscht.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Workflow konnte nicht gelöscht werden.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "workflows", label: "Workflows", count: workflows.length },
            { key: "executions", label: "Ausführungen", count: executions.length },
          ]}
        />
        {canManage ? (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
            Workflow erstellen
          </Button>
        ) : null}
      </div>

      {loading ? (
        <Card>
          <div className="p-4">
            <SkeletonText lines={5} />
          </div>
        </Card>
      ) : tab === "workflows" ? (
        workflows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<WorkflowIcon className="h-5 w-5" />}
              title="Noch keine Workflows"
              description="Automatisiere wiederkehrende Schritte: etwa eine Folgeaufgabe, sobald ein Deal in die Angebotsphase wechselt."
              actions={
                canManage ? (
                  <Button variant="primary" onClick={() => setEditing("new")}>
                    Workflow erstellen
                  </Button>
                ) : null
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflows.map((workflow) => (
              <Card key={workflow.id}>
                <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">{workflow.name}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {OBJECT_LABELS[workflow.objectType].singular} · {TRIGGER_LABELS[workflow.triggerType]}
                    </p>
                  </div>
                  <Badge tone={workflow.isActive ? "success" : "neutral"} dot>
                    {workflow.isActive ? "Aktiv" : "Inaktiv"}
                  </Badge>
                </div>

                <div className="space-y-2 px-4 py-3">
                  {workflow.description ? <p className="text-xs text-ink-600">{workflow.description}</p> : null}
                  <div className="flex flex-wrap gap-1.5">
                    {workflow.actions.map((action, index) => (
                      <Badge key={`${action.type}-${index}`} tone="brand">
                        {ACTION_LABELS[action.type] ?? action.type}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-2xs text-ink-400">
                    {workflow.runCount} Ausführungen
                    {workflow.lastRunAt ? ` · zuletzt ${formatRelative(workflow.lastRunAt)}` : ""}
                  </p>
                </div>

                {canManage ? (
                  <div className="flex items-center justify-between gap-2 border-t border-ink-200/70 px-4 py-2.5">
                    <Button size="sm" variant={workflow.isActive ? "secondary" : "primary"} onClick={() => toggle(workflow)}>
                      {workflow.isActive ? "Deaktivieren" : "Aktivieren"}
                    </Button>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(workflow)} aria-label="Bearbeiten">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(workflow)} aria-label="Löschen">
                        <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )
      ) : executions.length === 0 ? (
        <Card>
          <EmptyState
            title="Noch keine Ausführungen"
            description="Sobald ein aktiver Workflow durch ein Ereignis ausgelöst wird, erscheint hier das Protokoll mit jedem Schritt."
            compact
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {executions.map((execution) => (
              <li key={execution.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">{execution.workflow.name}</p>
                  <div className="flex items-center gap-2">
                    <Badge tone={EXECUTION_TONE[execution.status] ?? "neutral"}>{execution.status}</Badge>
                    <span className="text-2xs text-ink-400">{formatDateTime(execution.startedAt)}</span>
                  </div>
                </div>
                {execution.steps.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {execution.steps.map((step, index) => (
                      <li key={index} className="text-2xs text-ink-600">
                        <span
                          className={
                            step.status === "failed"
                              ? "text-danger-600"
                              : step.status === "skipped"
                                ? "text-ink-400"
                                : "text-success-700"
                          }
                        >
                          ●
                        </span>{" "}
                        {ACTION_LABELS[step.action as keyof typeof ACTION_LABELS] ?? step.action}
                        {step.detail ? ` — ${step.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {execution.error ? <p className="mt-1 text-2xs text-danger-600">{execution.error}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Workflow erstellen" : "Workflow bearbeiten"}
        width="lg"
      >
        {editing ? (
          <WorkflowBuilder
            workflow={editing === "new" ? null : editing}
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
        onConfirm={remove}
        title="Workflow löschen?"
        description={`„${deleting?.name ?? ""}" wird gelöscht. Bereits ausgeführte Aktionen bleiben bestehen.`}
      />
    </div>
  );
}

"use client";

import * as React from "react";
import { Clock, Mail, Pause, Phone, Play, Plus, Settings2, Trash2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { SequenceBuilder } from "./sequence-builder";

export type Step = {
  id?: string;
  type: string;
  delayDays: number;
  delayHours: number;
  templateId?: string | null;
  subject?: string | null;
  bodyHtml?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
};

export type Sequence = {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  stopOnReply: boolean;
  stopOnMeeting: boolean;
  sendingAccount: { id: string; label: string; fromEmail: string; status: string } | null;
  enrollmentCount: number;
  steps: Step[];
};

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Entwurf", tone: "neutral" },
  ACTIVE: { label: "Aktiv", tone: "success" },
  PAUSED: { label: "Pausiert", tone: "warning" },
  ARCHIVED: { label: "Archiviert", tone: "neutral" },
};

export const STEP_LABELS: Record<string, string> = {
  AUTOMATED_EMAIL: "E-Mail (automatisch)",
  MANUAL_EMAIL: "E-Mail (von Hand)",
  TASK: "Aufgabe",
  CALL_TASK: "Anruf",
  WAIT: "Warten",
  CONDITION: "Bedingung",
  CRM_ACTION: "CRM-Aktion",
};

function StepIcon({ type }: { type: string }) {
  if (type === "AUTOMATED_EMAIL" || type === "MANUAL_EMAIL") return <Mail className="h-3.5 w-3.5" />;
  if (type === "CALL_TASK") return <Phone className="h-3.5 w-3.5" />;
  if (type === "WAIT") return <Clock className="h-3.5 w-3.5" />;
  return <Workflow className="h-3.5 w-3.5" />;
}

export function SequencesView({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const [sequences, setSequences] = React.useState<Sequence[] | null>(null);
  const [editing, setEditing] = React.useState<"new" | Sequence | null>(null);

  const load = React.useCallback(async () => {
    try {
      setSequences(await api.get<Sequence[]>("/api/v1/outreach/sequences"));
    } catch {
      setSequences([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(sequence: Sequence, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
    try {
      await api.post(`/api/v1/outreach/sequences/${sequence.id}/status`, { status });
      toast.success(
        status === "ACTIVE" ? "Sequenz ist aktiv." : status === "PAUSED" ? "Sequenz pausiert." : "Sequenz archiviert.",
      );
      void load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Status konnte nicht geändert werden.");
    }
  }

  if (!sequences) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button
            variant="primary"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setEditing("new")}
            data-tour="sequence-create"
          >
            Sequenz erstellen
          </Button>
        </div>
      ) : null}

      {sequences.length === 0 ? (
        <Card>
          <EmptyState
            title="Noch keine Sequenzen"
            description="Eine Sequenz führt über Tage durch mehrere Schritte — E-Mail, Warten, Nachfassen, Anruf. Neu angelegte Sequenzen sind zunächst Entwurf und senden nichts."
            actions={canManage ? <Button variant="primary" onClick={() => setEditing("new")}>Sequenz erstellen</Button> : null}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {sequences.map((sequence) => (
            <Card key={sequence.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-ink-900">{sequence.name}</h3>
                    <Badge tone={STATUS[sequence.status]?.tone ?? "neutral"}>{STATUS[sequence.status]?.label}</Badge>
                  </div>
                  {sequence.description ? <p className="mt-1 text-sm text-ink-500">{sequence.description}</p> : null}
                  <p className="mt-1.5 text-xs text-ink-500">
                    {sequence.steps.length} Schritte · {sequence.enrollmentCount} Einschreibungen
                    {sequence.sendingAccount ? ` · Versand über ${sequence.sendingAccount.fromEmail}` : " · kein Konto gewählt"}
                  </p>
                </div>

                {canManage ? (
                  <div className="flex items-center gap-1.5">
                    {sequence.status === "ACTIVE" ? (
                      <Button size="sm" icon={<Pause className="h-3.5 w-3.5" />} onClick={() => setStatus(sequence, "PAUSED")}>
                        Pausieren
                      </Button>
                    ) : sequence.status !== "ARCHIVED" ? (
                      <Button size="sm" variant="primary" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setStatus(sequence, "ACTIVE")}>
                        Aktivieren
                      </Button>
                    ) : null}
                    <Button size="icon" variant="ghost" onClick={() => setEditing(sequence)} aria-label="Bearbeiten">
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                    {sequence.status !== "ARCHIVED" ? (
                      <Button size="icon" variant="ghost" onClick={() => setStatus(sequence, "ARCHIVED")} aria-label="Archivieren">
                        <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <ol className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-3">
                {sequence.steps.map((step, index) => (
                  <li key={step.id ?? index} className="flex items-center gap-1.5">
                    {index > 0 ? <span className="text-2xs text-ink-300">→</span> : null}
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-ink-50 px-2 py-1 text-2xs text-ink-700">
                      <StepIcon type={step.type} />
                      {STEP_LABELS[step.type] ?? step.type}
                      {step.delayDays > 0 || step.delayHours > 0 ? (
                        <span className="text-ink-400">
                          +{step.delayDays > 0 ? `${step.delayDays} T` : ""}
                          {step.delayHours > 0 ? ` ${step.delayHours} h` : ""}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Sequenz erstellen" : "Sequenz bearbeiten"}
        width="lg"
      >
        {editing ? (
          <SequenceBuilder
            sequence={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              void load();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

"use client";

import * as React from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  Loader2,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import {
  AUTOMATION_STATUS_LABELS,
  AUTOMATION_TYPE_LABELS,
  CRM_EVENT_LABELS,
  MOMENTUM_LABELS,
  MOMENTUM_TONE,
  NEXT_ACTION_LABELS,
  NEXT_ACTION_STATUS_LABELS,
  OPERATIONAL_STATE_LABELS,
  OPERATIONAL_STATE_TONE,
} from "@/lib/crm/active";
import type {
  AutomationStatus,
  AutomationType,
  CrmEventType,
  Momentum,
  NextActionStatus,
  NextActionType,
  OperationalState,
} from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * The Next Action panel — the part of the record that answers, at a glance:
 * what happens next, when, who does it, and why the system thinks so.
 *
 * Every recommendation shows its reason, and every override the user makes is
 * written to the timeline. Nothing here decides silently.
 */
type Signal = { label: string; weight: number };

type RecordState = {
  state: {
    operationalState: OperationalState;
    momentum: Momentum;
    momentumSignals: unknown;
    nextActionAt: string | null;
    nextActionTitle: string | null;
    nextActionType: NextActionType | null;
    stalledSince: string | null;
    automationPausedUntil: string | null;
    automationPausedReason: string | null;
    lastOutboundAt: string | null;
    lastCustomerResponseAt: string | null;
    nextMeetingAt: string | null;
    offerSentAt?: string | null;
  } | null;
  current: {
    id: string;
    type: NextActionType;
    title: string;
    reason: string;
    ruleKey: string | null;
    isManual: boolean;
    dueAt: string | null;
    priority: number;
    owner: { id: string; name: string } | null;
    taskId: string | null;
  } | null;
  history: {
    id: string;
    title: string;
    reason: string;
    status: NextActionStatus;
    isManual: boolean;
    completedAt: string | null;
    dismissedAt: string | null;
    dismissReason: string | null;
    createdAt: string;
  }[];
  automations: {
    id: string;
    type: AutomationType;
    status: AutomationStatus;
    scheduledFor: string;
    reason: string;
    outcomeReason: string | null;
    executedAt: string | null;
  }[];
  events: {
    id: string;
    type: CrmEventType;
    source: string;
    occurredAt: string;
    actor: { id: string; name: string } | null;
  }[];
};

type Dialog = "manual" | "snooze" | "dismiss" | "recall" | "pause" | null;

const ACTION_TYPES = Object.keys(NEXT_ACTION_LABELS) as NextActionType[];

function toSignals(value: unknown): Signal[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Signal =>
      typeof entry === "object" && entry !== null && typeof (entry as Signal).label === "string",
  );
}

function dateInputValue(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export function NextActionPanel({
  kind,
  id,
  canEdit,
}: {
  kind: "deal" | "lead";
  id: string;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [data, setData] = React.useState<RecordState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [error, setError] = React.useState<string | null>(null);

  const base = `/api/v1/records/${kind}/${id}`;

  const load = React.useCallback(async () => {
    try {
      setData(await api.get<RecordState>(base));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Der Status konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [base]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function run(operation: () => Promise<RecordState>, message: string) {
    setBusy(true);
    try {
      setData(await operation());
      setDialog(null);
      toast.success(message);
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Aktion ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-6 text-xs text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Status wird geladen …
      </div>
    );
  }

  if (error || !data?.state) {
    return (
      <div className="rounded-lg border border-ink-200 bg-white px-4 py-5 text-xs text-ink-600">
        {error ?? "Für diesen Datensatz liegt kein Status vor."}
      </div>
    );
  }

  const { state, current } = data;
  const signals = toSignals(state.momentumSignals);
  const overdue = current?.dueAt ? new Date(current.dueAt).getTime() < Date.now() : false;
  const paused = state.automationPausedUntil ? new Date(state.automationPausedUntil) > new Date() : false;
  const pending = data.automations.filter((automation) => automation.status === "PENDING");
  const settled = data.automations.filter((automation) => automation.status !== "PENDING").slice(0, 4);

  return (
    <div className="space-y-3" data-tour="next-action">
      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-white",
          state.operationalState === "NO_NEXT_ACTION" ? "border-danger-200" : "border-ink-200",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50/70 px-4 py-2.5">
          <Badge tone={OPERATIONAL_STATE_TONE[state.operationalState]} dot>
            {OPERATIONAL_STATE_LABELS[state.operationalState]}
          </Badge>
          <Badge tone={MOMENTUM_TONE[state.momentum]}>Momentum: {MOMENTUM_LABELS[state.momentum]}</Badge>
          {state.stalledSince ? (
            <span className="inline-flex items-center gap-1 text-2xs text-danger-600">
              <AlertTriangle className="h-3 w-3" /> stagniert seit {formatDate(state.stalledSince)}
            </span>
          ) : null}
        </div>

        <div className="px-4 py-4">
          {current ? (
            <>
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Nächste Aktion</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{current.title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{current.reason}</p>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-ink-500">
                <span className={cn("inline-flex items-center gap-1", overdue && "font-semibold text-danger-600")}>
                  <Clock className="h-3 w-3" />
                  {current.dueAt ? `Fällig ${formatDate(current.dueAt)} (${formatRelative(current.dueAt)})` : "Ohne Fälligkeit"}
                </span>
                <span>Verantwortlich: {current.owner?.name ?? "nicht zugewiesen"}</span>
                <span className="inline-flex items-center gap-1">
                  {current.isManual ? (
                    <>
                      <PenLine className="h-3 w-3" /> manuell festgelegt
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3" /> Regel: {current.ruleKey}
                    </>
                  )}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-ink-600">Für diesen Datensatz ist derzeit keine nächste Aktion offen.</p>
          )}

          {canEdit ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {current ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Check className="h-3.5 w-3.5" />}
                  loading={busy}
                  onClick={() =>
                    run(() => api.post<RecordState>(`/api/v1/next-actions/${current.id}/complete`, {}), "Aktion erledigt.")
                  }
                >
                  Erledigt
                </Button>
              ) : null}
              {current ? (
                <Button size="sm" icon={<Clock className="h-3.5 w-3.5" />} onClick={() => setDialog("snooze")}>
                  Verschieben
                </Button>
              ) : null}
              <Button size="sm" icon={<PenLine className="h-3.5 w-3.5" />} onClick={() => setDialog("manual")}>
                Eigene Aktion
              </Button>
              <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setDialog("recall")}>
                Wiedervorlage
              </Button>
              {current && !current.isManual ? (
                <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setDialog("dismiss")}>
                  Empfehlung verwerfen
                </Button>
              ) : null}
              {paused ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Play className="h-3.5 w-3.5" />}
                  loading={busy}
                  onClick={() => run(() => api.post<RecordState>(`${base}/automation`, { action: "resume" }), "Automation fortgesetzt.")}
                >
                  Automation fortsetzen
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon={<Pause className="h-3.5 w-3.5" />} onClick={() => setDialog("pause")}>
                  Automation pausieren
                </Button>
              )}
            </div>
          ) : null}

          {paused ? (
            <p className="mt-3 rounded-md bg-warning-50 px-3 py-2 text-2xs text-warning-700">
              Automation pausiert bis {formatDate(state.automationPausedUntil)}
              {state.automationPausedReason ? ` — ${state.automationPausedReason}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {signals.length > 0 ? (
        <Panel title="Warum dieser Status">
          <ul className="space-y-1.5">
            {signals.map((signal, index) => (
              <li key={index} className="flex items-start gap-2 text-xs text-ink-700">
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-4 w-6 shrink-0 items-center justify-center rounded text-2xs font-semibold tabular-nums",
                    signal.weight > 0
                      ? "bg-success-50 text-success-700"
                      : signal.weight < 0
                        ? "bg-danger-50 text-danger-700"
                        : "bg-ink-100 text-ink-600",
                  )}
                >
                  {signal.weight > 0 ? `+${signal.weight}` : signal.weight}
                </span>
                <span>{signal.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-ink-100 pt-2 text-2xs text-ink-500">
            Das Momentum ist die Summe dieser Signale — keine geschätzte Abschlusswahrscheinlichkeit.
          </p>
        </Panel>
      ) : null}

      {pending.length > 0 || settled.length > 0 ? (
        <Panel title="Automatisierung">
          <ul className="space-y-2">
            {pending.map((automation) => (
              <li key={automation.id} className="rounded-md border border-ink-100 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink-800">{AUTOMATION_TYPE_LABELS[automation.type]}</span>
                  <Badge tone="brand">{AUTOMATION_STATUS_LABELS[automation.status]}</Badge>
                </div>
                <p className="mt-1 text-2xs text-ink-500">
                  geplant für {formatDateTime(automation.scheduledFor)} — {automation.reason}
                </p>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1.5 h-6 px-2"
                    loading={busy}
                    onClick={() =>
                      run(
                        () =>
                          api.post<RecordState>(`${base}/automation`, {
                            action: "cancel",
                            automationId: automation.id,
                            reason: "Manuell gestoppt.",
                          }),
                        "Automation gestoppt.",
                      )
                    }
                  >
                    Stoppen
                  </Button>
                ) : null}
              </li>
            ))}
            {settled.map((automation) => (
              <li key={automation.id} className="px-3 py-1.5 text-2xs text-ink-500">
                <span className="text-ink-700">{AUTOMATION_TYPE_LABELS[automation.type]}</span>{" "}
                {AUTOMATION_STATUS_LABELS[automation.status].toLowerCase()}
                {automation.outcomeReason ? ` — ${automation.outcomeReason}` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {data.events.length > 0 ? (
        <Panel title="Was das System automatisch erkannt hat">
          <ul className="space-y-1.5">
            {data.events.slice(0, 8).map((event) => (
              <li key={event.id} className="flex items-start gap-2 text-2xs text-ink-600">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-success-500" />
                <span>
                  <span className="text-ink-800">{CRM_EVENT_LABELS[event.type]}</span> · {formatDateTime(event.occurredAt)}
                  {event.actor ? ` · ${event.actor.name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {data.history.length > 0 ? (
        <Panel title="Verlauf der nächsten Aktionen">
          <ul className="space-y-2">
            {data.history.slice(0, 6).map((entry) => (
              <li key={entry.id} className="text-2xs">
                <p className="text-ink-800">
                  {entry.title} · <span className="text-ink-500">{NEXT_ACTION_STATUS_LABELS[entry.status]}</span>
                </p>
                <p className="text-ink-500">
                  {entry.dismissReason ?? entry.reason} ·{" "}
                  {formatDate(entry.completedAt ?? entry.dismissedAt ?? entry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <ManualDialog
        open={dialog === "manual"}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(payload) => run(() => api.put<RecordState>(`${base}/next-action`, payload), "Nächste Aktion festgelegt.")}
      />
      <ReasonDateDialog
        open={dialog === "snooze"}
        busy={busy}
        title="Aktion verschieben"
        description="Die Aktion bleibt bestehen und wird zum gewählten Zeitpunkt wieder fällig."
        dateLabel="Wieder fällig am"
        reasonLabel="Grund (optional)"
        reasonRequired={false}
        onClose={() => setDialog(null)}
        onSubmit={(payload) =>
          run(
            () => api.post<RecordState>(`/api/v1/next-actions/${current?.id}/snooze`, { until: payload.date, reason: payload.reason }),
            "Aktion verschoben.",
          )
        }
      />
      <ReasonDateDialog
        open={dialog === "recall"}
        busy={busy}
        title="Wiedervorlage setzen"
        description="Zum gewählten Zeitpunkt erinnert OKUN CRM automatisch an diesen Datensatz."
        dateLabel="Wiedervorlage am"
        reasonLabel="Grund"
        reasonRequired
        defaultDays={30}
        onClose={() => setDialog(null)}
        onSubmit={(payload) =>
          run(() => api.post<RecordState>(`${base}/recall`, { at: payload.date, reason: payload.reason }), "Wiedervorlage gesetzt.")
        }
      />
      <ReasonDateDialog
        open={dialog === "pause"}
        busy={busy}
        title="Automation pausieren"
        description="Bis zu diesem Datum führt das System für diesen Datensatz nichts automatisch aus."
        dateLabel="Pausieren bis"
        reasonLabel="Grund"
        reasonRequired
        defaultDays={14}
        onClose={() => setDialog(null)}
        onSubmit={(payload) =>
          run(
            () => api.post<RecordState>(`${base}/automation`, { action: "pause", until: payload.date, reason: payload.reason }),
            "Automation pausiert.",
          )
        }
      />
      <DismissDialog
        open={dialog === "dismiss"}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(reason) =>
          run(() => api.post<RecordState>(`/api/v1/next-actions/${current?.id}/dismiss`, { reason }), "Empfehlung verworfen.")
        }
      />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3.5">
      <p className="mb-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">{title}</p>
      {children}
    </div>
  );
}

function ManualDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { type: NextActionType; title: string; reason: string; dueAt: string | null }) => void;
}) {
  const [type, setType] = React.useState<NextActionType>("FOLLOW_UP");
  const [title, setTitle] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [dueAt, setDueAt] = React.useState(dateInputValue(3));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Eigene nächste Aktion"
      description="Eine selbst gesetzte Aktion hat Vorrang vor jeder Empfehlung des Systems."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!title.trim() || !reason.trim()}
            onClick={() => onSubmit({ type, title: title.trim(), reason: reason.trim(), dueAt: dueAt || null })}
          >
            Festlegen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Art der Aktion" htmlFor="next-action-type">
          <Select id="next-action-type" value={type} onChange={(event) => setType(event.target.value as NextActionType)}>
            {ACTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {NEXT_ACTION_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Titel" htmlFor="next-action-title" required>
          <Input
            id="next-action-title"
            value={title}
            maxLength={160}
            placeholder="z. B. Entscheider persönlich anrufen"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Begründung" htmlFor="next-action-reason" required hint="Wird im Datensatz und im Action Center angezeigt.">
          <Textarea
            id="next-action-reason"
            rows={3}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Field label="Fällig am" htmlFor="next-action-due">
          <Input id="next-action-due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ReasonDateDialog({
  open,
  busy,
  title,
  description,
  dateLabel,
  reasonLabel,
  reasonRequired,
  defaultDays = 7,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  title: string;
  description: string;
  dateLabel: string;
  reasonLabel: string;
  reasonRequired: boolean;
  defaultDays?: number;
  onClose: () => void;
  onSubmit: (payload: { date: string; reason: string }) => void;
}) {
  const [date, setDate] = React.useState(dateInputValue(defaultDays));
  const [reason, setReason] = React.useState("");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!date || (reasonRequired && !reason.trim())}
            onClick={() => onSubmit({ date, reason: reason.trim() })}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={dateLabel} htmlFor="action-date" required>
          <Input id="action-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label={reasonLabel} htmlFor="action-reason" required={reasonRequired}>
          <Textarea id="action-reason" rows={2} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function DismissDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Empfehlung verwerfen"
      description="Die Begründung hilft dabei, die Regeln zu verbessern, und bleibt am Datensatz sichtbar."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>
            Verwerfen
          </Button>
        </>
      }
    >
      <Field label="Warum passt die Empfehlung nicht?" htmlFor="dismiss-reason" required>
        <Textarea id="dismiss-reason" rows={3} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </Modal>
  );
}

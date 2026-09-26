"use client";

import * as React from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { STEP_LABELS, type Sequence, type Step } from "./sequences-view";

/**
 * Der Sequenzbaukasten.
 *
 * Jeder Schritt zeigt nur die Felder, die sein Typ wirklich braucht — sonst
 * stünde man vor zwölf Eingabefeldern, von denen zehn nichts tun.
 */
type Template = { id: string; name: string; subject: string };
type Account = { id: string; label: string; fromEmail: string; status: string };

const ADDABLE: { type: string; hint: string }[] = [
  { type: "AUTOMATED_EMAIL", hint: "Wird zur geplanten Zeit automatisch versendet." },
  { type: "MANUAL_EMAIL", hint: "Wird als Aufgabe vorbereitet — versendet wird von Hand." },
  { type: "TASK", hint: "Erzeugt eine Aufgabe für den Owner." },
  { type: "CALL_TASK", hint: "Erzeugt eine Anrufaufgabe mit hoher Priorität." },
  { type: "WAIT", hint: "Pausiert die Sequenz um die angegebene Zeit." },
];

export function SequenceBuilder({
  sequence,
  onDone,
  onCancel,
}: {
  sequence: Sequence | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(sequence?.name ?? "");
  const [description, setDescription] = React.useState(sequence?.description ?? "");
  const [sendingAccountId, setSendingAccountId] = React.useState(sequence?.sendingAccount?.id ?? "");
  const [stopOnReply, setStopOnReply] = React.useState(sequence?.stopOnReply ?? true);
  const [steps, setSteps] = React.useState<Step[]>(
    sequence?.steps ?? [{ type: "AUTOMATED_EMAIL", delayDays: 0, delayHours: 0, subject: "", bodyHtml: "" }],
  );
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [pending, setPending] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    void (async () => {
      const [t, a] = await Promise.all([
        api.get<Template[]>("/api/v1/templates").catch(() => []),
        api.get<Account[]>("/api/v1/outreach/sending-accounts").catch(() => []),
      ]);
      setTemplates(t);
      setAccounts(a);
    })();
  }, []);

  const patch = (index: number, changes: Partial<Step>) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...changes } : step)));

  const move = (index: number, direction: -1 | 1) =>
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFieldErrors({});
    try {
      const body = {
        name,
        description: description || undefined,
        sendingAccountId: sendingAccountId || undefined,
        stopOnReply,
        stopOnMeeting: true,
        steps: steps.map((step) => ({
          id: step.id,
          type: step.type,
          delayDays: step.delayDays,
          delayHours: step.delayHours,
          templateId: step.templateId || undefined,
          subject: step.subject || undefined,
          bodyHtml: step.bodyHtml || undefined,
          taskTitle: step.taskTitle || undefined,
          taskDescription: step.taskDescription || undefined,
        })),
      };
      if (sequence) await api.put(`/api/v1/outreach/sequences/${sequence.id}`, body);
      else await api.post("/api/v1/outreach/sequences", body);
      toast.success(sequence ? "Sequenz gespeichert." : "Sequenz erstellt — sie ist zunächst Entwurf.");
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) setFieldErrors(cause.fields);
      toast.error(cause instanceof ApiError ? cause.message : "Die Sequenz konnte nicht gespeichert werden.");
    } finally {
      setPending(false);
    }
  }

  const needsAccount = steps.some((step) => step.type === "AUTOMATED_EMAIL");

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-3">
        <Field label="Name" htmlFor="sequenceName" error={fieldErrors.name} required>
          <Input id="sequenceName" value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
        </Field>
        <Field label="Beschreibung" htmlFor="sequenceDescription">
          <Textarea
            id="sequenceDescription"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Wofür diese Sequenz da ist — in einem halben Jahr der einzige Hinweis darauf."
          />
        </Field>

        {needsAccount ? (
          <Field label="Versandkonto" htmlFor="sendingAccountId">
            <Select id="sendingAccountId" value={sendingAccountId} onChange={(event) => setSendingAccountId(event.target.value)}>
              <option value="">— automatisch wählen —</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label} ({account.fromEmail}){account.status !== "ACTIVE" ? " — pausiert" : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
          <Checkbox checked={stopOnReply} onChange={(event) => setStopOnReply(event.target.checked)} />
          Bei einer Antwort anhalten
        </label>
        <p className="-mt-1 text-xs text-ink-500">
          Empfohlen. Eine Abwesenheitsnotiz gilt dabei nicht als Antwort — sie hält die Sequenz nicht an.
        </p>
      </div>

      <div className="space-y-2 border-t border-ink-200 pt-4">
        <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Schritte</p>

        {steps.map((step, index) => (
          <div key={index} className="rounded-md border border-ink-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-ink-800">
                <GripVertical className="h-4 w-4 text-ink-300" />
                Schritt {index + 1}: {STEP_LABELS[step.type] ?? step.type}
              </span>
              <span className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Nach oben">
                  ↑
                </Button>
                <Button size="icon" variant="ghost" onClick={() => move(index, 1)} disabled={index === steps.length - 1} aria-label="Nach unten">
                  ↓
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                  disabled={steps.length === 1}
                  aria-label="Schritt entfernen"
                >
                  <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                </Button>
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Wartezeit in Tagen" htmlFor={`delay-${index}`}>
                <Input
                  id={`delay-${index}`}
                  type="number"
                  min={0}
                  value={step.delayDays}
                  onChange={(event) => patch(index, { delayDays: Number(event.target.value) })}
                />
              </Field>
              <Field label="zusätzlich Stunden" htmlFor={`delayh-${index}`}>
                <Input
                  id={`delayh-${index}`}
                  type="number"
                  min={0}
                  max={23}
                  value={step.delayHours}
                  onChange={(event) => patch(index, { delayHours: Number(event.target.value) })}
                />
              </Field>

              {step.type === "AUTOMATED_EMAIL" || step.type === "MANUAL_EMAIL" ? (
                <>
                  <Field label="Vorlage" htmlFor={`template-${index}`} className="sm:col-span-2">
                    <Select
                      id={`template-${index}`}
                      value={step.templateId ?? ""}
                      onChange={(event) => patch(index, { templateId: event.target.value })}
                    >
                      <option value="">— eigener Text —</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </Select>
                  </Field>
                  {!step.templateId ? (
                    <>
                      <Field label="Betreff" htmlFor={`subject-${index}`} className="sm:col-span-2">
                        <Input
                          id={`subject-${index}`}
                          value={step.subject ?? ""}
                          onChange={(event) => patch(index, { subject: event.target.value })}
                          placeholder="Kurze Frage zu {{prospect.companyName}}"
                        />
                      </Field>
                      <Field label="Inhalt" htmlFor={`body-${index}`} className="sm:col-span-2">
                        <Textarea
                          id={`body-${index}`}
                          rows={5}
                          value={step.bodyHtml ?? ""}
                          onChange={(event) => patch(index, { bodyHtml: event.target.value })}
                          placeholder="Guten Tag {{prospect.firstName}}, …"
                        />
                      </Field>
                      <p className="text-2xs leading-relaxed text-ink-400 sm:col-span-2">
                        Platzhalter: {"{{prospect.firstName}}"}, {"{{prospect.companyName}}"}, {"{{prospect.city}}"},{" "}
                        {"{{sender.name}}"}
                      </p>
                    </>
                  ) : null}
                </>
              ) : null}

              {step.type === "TASK" || step.type === "CALL_TASK" ? (
                <>
                  <Field label="Titel der Aufgabe" htmlFor={`taskTitle-${index}`} className="sm:col-span-2">
                    <Input
                      id={`taskTitle-${index}`}
                      value={step.taskTitle ?? ""}
                      onChange={(event) => patch(index, { taskTitle: event.target.value })}
                    />
                  </Field>
                  <Field label="Beschreibung" htmlFor={`taskDesc-${index}`} className="sm:col-span-2">
                    <Textarea
                      id={`taskDesc-${index}`}
                      rows={2}
                      value={step.taskDescription ?? ""}
                      onChange={(event) => patch(index, { taskDescription: event.target.value })}
                    />
                  </Field>
                </>
              ) : null}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-1.5">
          {ADDABLE.map((entry) => (
            <Button
              key={entry.type}
              size="sm"
              variant="secondary"
              icon={<Plus className="h-3.5 w-3.5" />}
              title={entry.hint}
              onClick={() =>
                setSteps((current) => [
                  ...current,
                  { type: entry.type, delayDays: entry.type === "WAIT" ? 3 : 2, delayHours: 0 },
                ])
              }
            >
              {STEP_LABELS[entry.type]}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>Abbrechen</Button>
        <Button type="submit" variant="primary" loading={pending}>
          {sequence ? "Änderungen speichern" : "Sequenz erstellen"}
        </Button>
      </div>
    </form>
  );
}

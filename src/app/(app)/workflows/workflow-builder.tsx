"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { FormError, FormSection } from "@/components/crm/forms/form-kit";
import { useReference } from "@/components/app/reference-provider";
import { api, ApiError } from "@/lib/api-client";
import { EMPTY_FILTER, type FilterGroup } from "@/lib/filters";
import { ACTION_LABELS, TRIGGER_LABELS } from "@/server/workflows/types";
import { OBJECT_LABELS } from "@/lib/crm/fields";

/**
 * Workflow builder: TRIGGER + CONDITIONS + ACTIONS.
 *
 * The condition editor is the same filter builder the lists use, so a condition
 * means exactly what a filter means — including custom properties.
 */
type ActionDraft = Record<string, unknown> & { type: string };

type WorkflowDraft = {
  id?: string;
  name: string;
  description: string;
  objectType: CrmObjectType;
  triggerType: keyof typeof TRIGGER_LABELS;
  triggerConfig: Record<string, unknown>;
  conditions: FilterGroup;
  actions: ActionDraft[];
  isActive: boolean;
};

const TRIGGERS_FOR: Record<CrmObjectType, (keyof typeof TRIGGER_LABELS)[]> = {
  CONTACT: ["RECORD_CREATED", "PROPERTY_CHANGED"],
  COMPANY: ["RECORD_CREATED", "PROPERTY_CHANGED"],
  LEAD: ["RECORD_CREATED", "PROPERTY_CHANGED", "LEAD_STATUS_CHANGED"],
  DEAL: ["RECORD_CREATED", "PROPERTY_CHANGED", "DEAL_STAGE_CHANGED"],
};

export function WorkflowBuilder({
  workflow,
  onDone,
  onCancel,
}: {
  workflow: {
    id: string;
    name: string;
    description: string | null;
    objectType: CrmObjectType;
    triggerType: keyof typeof TRIGGER_LABELS;
    triggerConfig: Record<string, unknown>;
    conditions: unknown;
    actions: { type: string }[];
    isActive: boolean;
  } | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const { data: reference } = useReference();
  const [templates, setTemplates] = React.useState<{ id: string; name: string }[]>([]);
  const [endpoints, setEndpoints] = React.useState<{ id: string; url: string }[]>([]);

  const [draft, setDraft] = React.useState<WorkflowDraft>(() => ({
    id: workflow?.id,
    name: workflow?.name ?? "",
    description: workflow?.description ?? "",
    objectType: workflow?.objectType ?? "DEAL",
    triggerType: workflow?.triggerType ?? "RECORD_CREATED",
    triggerConfig: workflow?.triggerConfig ?? {},
    conditions: (workflow?.conditions as FilterGroup) ?? EMPTY_FILTER,
    actions: (workflow?.actions as ActionDraft[]) ?? [],
    isActive: workflow?.isActive ?? false,
  }));

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    api
      .get<{ id: string; name: string }[]>("/api/v1/templates")
      .then(setTemplates)
      .catch(() => undefined);
    api
      .get<{ id: string; url: string }[]>("/api/v1/webhooks")
      .then(setEndpoints)
      .catch(() => undefined);
  }, []);

  const stages = reference?.pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => ({ id: stage.id, label: `${pipeline.name} · ${stage.name}` })),
  );

  function addAction(type: string) {
    const defaults: Record<string, ActionDraft> = {
      set_property: { type, field: "", value: "" },
      set_owner: { type, ownerId: reference?.members[0]?.id ?? "" },
      create_task: { type, title: "", dueInDays: 3, priority: "MEDIUM", assignToOwner: true },
      create_note: { type, body: "" },
      send_notification: { type, userId: reference?.members[0]?.id ?? "", title: "" },
      send_email: { type, templateId: templates[0]?.id ?? "", toField: "contact.email" },
      trigger_webhook: { type, endpointId: endpoints[0]?.id ?? "" },
    };
    setDraft((current) => ({ ...current, actions: [...current.actions, defaults[type]] }));
  }

  function updateAction(index: number, patch: Record<string, unknown>) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action, i) => (i === index ? { ...action, ...patch } : action)),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        name: draft.name,
        description: draft.description || undefined,
        objectType: draft.objectType,
        triggerType: draft.triggerType,
        triggerConfig: draft.triggerConfig,
        conditions: draft.conditions,
        actions: draft.actions,
        isActive: draft.isActive,
      };
      if (draft.id) await api.put(`/api/v1/workflows/${draft.id}`, payload);
      else await api.post("/api/v1/workflows", payload);
      toast.success(draft.id ? "Workflow gespeichert." : "Workflow erstellt.");
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else {
        setError("Der Workflow konnte nicht gespeichert werden.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <FormError message={error} />

      <FormSection title="Grunddaten">
        <Field label="Name" htmlFor="workflow-name" error={fieldErrors.name} required>
          <Input
            id="workflow-name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            autoFocus
            required
          />
        </Field>
        <Field label="Beschreibung" htmlFor="workflow-description">
          <Textarea
            id="workflow-description"
            rows={2}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>
      </FormSection>

      <FormSection title="Trigger" description="Wann soll der Workflow starten?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Objekt" htmlFor="workflow-object">
            <Select
              id="workflow-object"
              value={draft.objectType}
              onChange={(event) => {
                const objectType = event.target.value as CrmObjectType;
                setDraft({
                  ...draft,
                  objectType,
                  triggerType: TRIGGERS_FOR[objectType][0],
                  triggerConfig: {},
                  conditions: EMPTY_FILTER,
                });
              }}
            >
              {(Object.keys(OBJECT_LABELS) as CrmObjectType[]).map((key) => (
                <option key={key} value={key}>
                  {OBJECT_LABELS[key].singular}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Auslöser" htmlFor="workflow-trigger">
            <Select
              id="workflow-trigger"
              value={draft.triggerType}
              onChange={(event) =>
                setDraft({ ...draft, triggerType: event.target.value as keyof typeof TRIGGER_LABELS, triggerConfig: {} })
              }
            >
              {TRIGGERS_FOR[draft.objectType].map((trigger) => (
                <option key={trigger} value={trigger}>
                  {TRIGGER_LABELS[trigger]}
                </option>
              ))}
            </Select>
          </Field>

          {draft.triggerType === "DEAL_STAGE_CHANGED" ? (
            <Field label="Nur bei Wechsel in Stage" htmlFor="trigger-stage" className="sm:col-span-2">
              <Select
                id="trigger-stage"
                value={String(draft.triggerConfig.stageId ?? "")}
                onChange={(event) => setDraft({ ...draft, triggerConfig: { stageId: event.target.value || undefined } })}
              >
                <option value="">Jeder Stage-Wechsel</option>
                {stages?.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {draft.triggerType === "LEAD_STATUS_CHANGED" ? (
            <Field label="Nur bei Status" htmlFor="trigger-status" className="sm:col-span-2">
              <Select
                id="trigger-status"
                value={String(draft.triggerConfig.statusKey ?? "")}
                onChange={(event) => setDraft({ ...draft, triggerConfig: { statusKey: event.target.value || undefined } })}
              >
                <option value="">Jeder Statuswechsel</option>
                {reference?.leadStatuses.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {draft.triggerType === "PROPERTY_CHANGED" ? (
            <Field
              label="Nur bei Änderung des Feldes"
              htmlFor="trigger-property"
              className="sm:col-span-2"
              hint="Leer lassen, um bei jeder Änderung auszulösen."
            >
              <Input
                id="trigger-property"
                value={String(draft.triggerConfig.propertyKey ?? "")}
                onChange={(event) => setDraft({ ...draft, triggerConfig: { propertyKey: event.target.value || undefined } })}
                placeholder="z. B. ownerId oder property:budget"
              />
            </Field>
          ) : null}
        </div>
      </FormSection>

      <FormSection title="Bedingungen" description="Der Workflow läuft nur, wenn der Datensatz diesen Filtern entspricht.">
        <div className="rounded-md border border-ink-200">
          <FilterBuilder
            objectType={draft.objectType}
            value={draft.conditions}
            onChange={(conditions) => setDraft({ ...draft, conditions })}
          />
        </div>
      </FormSection>

      <FormSection title="Aktionen" description="Was soll passieren?">
        <div className="space-y-2">
          {draft.actions.map((action, index) => (
            <div key={index} className="rounded-md border border-ink-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-ink-800">
                  {ACTION_LABELS[action.type as keyof typeof ACTION_LABELS] ?? action.type}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, i) => i !== index) })}
                  aria-label="Aktion entfernen"
                >
                  <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                </Button>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {action.type === "set_property" ? (
                  <>
                    <Field label="Feld" htmlFor={`action-field-${index}`}>
                      <Input
                        id={`action-field-${index}`}
                        value={String(action.field ?? "")}
                        onChange={(event) => updateAction(index, { field: event.target.value })}
                        placeholder="z. B. lifecycleStage"
                      />
                    </Field>
                    <Field label="Wert" htmlFor={`action-value-${index}`}>
                      <Input
                        id={`action-value-${index}`}
                        value={String(action.value ?? "")}
                        onChange={(event) => updateAction(index, { value: event.target.value })}
                      />
                    </Field>
                  </>
                ) : null}

                {action.type === "set_owner" || action.type === "send_notification" ? (
                  <Field label="Person" htmlFor={`action-user-${index}`}>
                    <Select
                      id={`action-user-${index}`}
                      value={String(action.ownerId ?? action.userId ?? "")}
                      onChange={(event) =>
                        updateAction(
                          index,
                          action.type === "set_owner" ? { ownerId: event.target.value } : { userId: event.target.value },
                        )
                      }
                    >
                      {reference?.members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {action.type === "send_notification" ? (
                  <Field label="Titel" htmlFor={`action-title-${index}`}>
                    <Input
                      id={`action-title-${index}`}
                      value={String(action.title ?? "")}
                      onChange={(event) => updateAction(index, { title: event.target.value })}
                    />
                  </Field>
                ) : null}

                {action.type === "create_task" ? (
                  <>
                    <Field label="Titel" htmlFor={`action-task-${index}`} className="sm:col-span-2">
                      <Input
                        id={`action-task-${index}`}
                        value={String(action.title ?? "")}
                        onChange={(event) => updateAction(index, { title: event.target.value })}
                      />
                    </Field>
                    <Field label="Fällig in Tagen" htmlFor={`action-due-${index}`}>
                      <Input
                        id={`action-due-${index}`}
                        type="number"
                        min={0}
                        value={Number(action.dueInDays ?? 3)}
                        onChange={(event) => updateAction(index, { dueInDays: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Priorität" htmlFor={`action-priority-${index}`}>
                      <Select
                        id={`action-priority-${index}`}
                        value={String(action.priority ?? "MEDIUM")}
                        onChange={(event) => updateAction(index, { priority: event.target.value })}
                      >
                        <option value="LOW">Niedrig</option>
                        <option value="MEDIUM">Mittel</option>
                        <option value="HIGH">Hoch</option>
                        <option value="URGENT">Dringend</option>
                      </Select>
                    </Field>
                  </>
                ) : null}

                {action.type === "create_note" ? (
                  <Field label="Notiztext" htmlFor={`action-note-${index}`} className="sm:col-span-2">
                    <Textarea
                      id={`action-note-${index}`}
                      rows={2}
                      value={String(action.body ?? "")}
                      onChange={(event) => updateAction(index, { body: event.target.value })}
                    />
                  </Field>
                ) : null}

                {action.type === "send_email" ? (
                  <Field
                    label="Vorlage"
                    htmlFor={`action-template-${index}`}
                    className="sm:col-span-2"
                    hint="Der Versand erfolgt nur, wenn ein E-Mail-Postausgang verbunden ist."
                  >
                    <Select
                      id={`action-template-${index}`}
                      value={String(action.templateId ?? "")}
                      onChange={(event) => updateAction(index, { templateId: event.target.value })}
                    >
                      <option value="">— Vorlage wählen —</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {action.type === "trigger_webhook" ? (
                  <Field label="Webhook" htmlFor={`action-webhook-${index}`} className="sm:col-span-2">
                    <Select
                      id={`action-webhook-${index}`}
                      value={String(action.endpointId ?? "")}
                      onChange={(event) => updateAction(index, { endpointId: event.target.value })}
                    >
                      <option value="">— Webhook wählen —</option>
                      {endpoints.map((endpoint) => (
                        <option key={endpoint.id} value={endpoint.id}>
                          {endpoint.url}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(ACTION_LABELS).map(([type, label]) => (
            <Button key={type} size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addAction(type)}>
              {label}
            </Button>
          ))}
        </div>
        {fieldErrors.actions ? <p className="text-xs text-danger-600">{fieldErrors.actions}</p> : null}
      </FormSection>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <Checkbox checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
        Workflow sofort aktivieren
      </label>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" loading={pending} disabled={draft.actions.length === 0}>
          {draft.id ? "Änderungen speichern" : "Workflow erstellen"}
        </Button>
      </div>
    </form>
  );
}

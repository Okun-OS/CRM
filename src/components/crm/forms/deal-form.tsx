"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useReference, useCompanyOptions } from "@/components/app/reference-provider";
import { PropertyFields } from "@/components/crm/property-fields";
import { api } from "@/lib/api-client";
import { cleanPayload, FormError, FormSection, useRecordForm } from "./form-kit";

export type DealFormValues = {
  id?: string;
  name?: string;
  pipelineId?: string;
  stageId?: string;
  amount?: number;
  currency?: string;
  probability?: number | null;
  expectedCloseDate?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  contactIds?: string[];
  source?: string | null;
  description?: string | null;
  ownerId?: string | null;
  properties?: Record<string, unknown>;
};

export function DealForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: DealFormValues;
  onDone: (deal: { id: string }) => void;
  onCancel?: () => void;
}) {
  const { data } = useReference();
  const [values, setValues] = React.useState<DealFormValues>(initial ?? { amount: 0 });
  const [properties, setProperties] = React.useState<Record<string, unknown>>(initial?.properties ?? {});
  const [companySearch, setCompanySearch] = React.useState("");
  const companies = useCompanyOptions(companySearch);

  const pipelines = data?.pipelines ?? [];
  const pipeline = pipelines.find((item) => item.id === values.pipelineId) ?? pipelines[0];

  // Preselect the default pipeline and its first stage.
  React.useEffect(() => {
    if (!values.pipelineId && pipeline) {
      setValues((current) => ({
        ...current,
        pipelineId: pipeline.id,
        stageId: current.stageId ?? pipeline.stages[0]?.id,
      }));
    }
  }, [pipeline, values.pipelineId]);

  const set = <K extends keyof DealFormValues>(key: K, value: DealFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const { pending, formError, fieldErrors, handleSubmit } = useRecordForm({
    submit: async () => {
      const payload = {
        ...cleanPayload({ ...values, id: undefined, companyName: undefined }),
        amount: values.amount ?? 0,
        properties,
      };
      return initial?.id
        ? api.patch<{ id: string }>(`/api/v1/deals/${initial.id}`, payload)
        : api.post<{ id: string }>("/api/v1/deals", payload);
    },
    onSuccess: onDone,
    successMessage: initial?.id ? "Deal aktualisiert." : "Deal erstellt.",
  });

  const companyOptions = React.useMemo(() => {
    const options = [...companies];
    if (values.companyId && !options.some((option) => option.id === values.companyId)) {
      options.unshift({ id: values.companyId, name: initial?.companyName ?? "Aktuelles Unternehmen" });
    }
    return options;
  }, [companies, values.companyId, initial?.companyName]);

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <FormError message={formError} />

      <FormSection title="Deal">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dealname" htmlFor="name" error={fieldErrors.name} required className="sm:col-span-2">
            <Input id="name" value={values.name ?? ""} onChange={(event) => set("name", event.target.value)} autoFocus required />
          </Field>

          <Field label="Wert" htmlFor="amount" error={fieldErrors.amount}>
            <Input
              id="amount"
              type="number"
              min={0}
              step="0.01"
              value={values.amount ?? 0}
              onChange={(event) => set("amount", Number(event.target.value))}
            />
          </Field>

          <Field label="Erwarteter Abschluss" htmlFor="expectedCloseDate" error={fieldErrors.expectedCloseDate}>
            <Input
              id="expectedCloseDate"
              type="date"
              value={values.expectedCloseDate ? String(values.expectedCloseDate).slice(0, 10) : ""}
              onChange={(event) => set("expectedCloseDate", event.target.value || null)}
            />
          </Field>

          <Field label="Pipeline" htmlFor="pipelineId" error={fieldErrors.pipelineId} required>
            <Select
              id="pipelineId"
              value={values.pipelineId ?? ""}
              onChange={(event) => {
                const next = pipelines.find((item) => item.id === event.target.value);
                setValues((current) => ({
                  ...current,
                  pipelineId: event.target.value,
                  stageId: next?.stages[0]?.id,
                }));
              }}
              required
            >
              {pipelines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Stage" htmlFor="stageId" error={fieldErrors.stageId} required>
            <Select id="stageId" value={values.stageId ?? ""} onChange={(event) => set("stageId", event.target.value)} required>
              {pipeline?.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Wahrscheinlichkeit"
            htmlFor="probability"
            error={fieldErrors.probability}
            hint="Leer lassen, um die Wahrscheinlichkeit der Stage zu verwenden."
          >
            <Input
              id="probability"
              type="number"
              min={0}
              max={100}
              value={values.probability ?? ""}
              onChange={(event) => set("probability", event.target.value === "" ? null : Number(event.target.value))}
            />
          </Field>

          <Field label="Quelle" htmlFor="source" error={fieldErrors.source}>
            <Input id="source" value={values.source ?? ""} onChange={(event) => set("source", event.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Zuordnung">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Unternehmen" htmlFor="companyId" error={fieldErrors.companyId}>
            <div className="space-y-1.5">
              <Input
                placeholder="Unternehmen suchen…"
                value={companySearch}
                onChange={(event) => setCompanySearch(event.target.value)}
              />
              <Select
                id="companyId"
                value={values.companyId ?? ""}
                onChange={(event) => set("companyId", event.target.value || null)}
              >
                <option value="">— kein Unternehmen —</option>
                {companyOptions.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </Select>
            </div>
          </Field>

          <Field label="Owner" htmlFor="ownerId" error={fieldErrors.ownerId}>
            <Select id="ownerId" value={values.ownerId ?? ""} onChange={(event) => set("ownerId", event.target.value || null)}>
              <option value="">— mir zuweisen —</option>
              {data?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </FormSection>

      <Field label="Beschreibung" htmlFor="description">
        <Textarea id="description" value={values.description ?? ""} onChange={(event) => set("description", event.target.value)} />
      </Field>

      {data?.properties.DEAL.length ? (
        <PropertyFields
          definitions={data.properties.DEAL}
          values={properties}
          errors={fieldErrors}
          onChange={(key, value) => setProperties((current) => ({ ...current, [key]: value }))}
        />
      ) : null}

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        {onCancel ? (
          <Button onClick={onCancel} disabled={pending}>
            Abbrechen
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={pending}>
          {initial?.id ? "Änderungen speichern" : "Deal erstellen"}
        </Button>
      </div>
    </form>
  );
}

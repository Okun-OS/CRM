"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useReference } from "@/components/app/reference-provider";
import { PropertyFields } from "@/components/crm/property-fields";
import { api } from "@/lib/api-client";
import { cleanPayload, FormError, FormSection, useRecordForm } from "./form-kit";

export type LeadFormValues = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  source?: string | null;
  status?: string;
  score?: number | null;
  qualification?: string | null;
  nextStepAt?: string | null;
  ownerId?: string | null;
  properties?: Record<string, unknown>;
};

export function LeadForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: LeadFormValues;
  onDone: (lead: { id: string }) => void;
  onCancel?: () => void;
}) {
  const { data } = useReference();
  const [values, setValues] = React.useState<LeadFormValues>(initial ?? {});
  const [properties, setProperties] = React.useState<Record<string, unknown>>(initial?.properties ?? {});

  // Default to the first configured status so the form is valid on open.
  React.useEffect(() => {
    if (!values.status && data?.leadStatuses[0]) {
      setValues((current) => ({ ...current, status: data.leadStatuses[0].key }));
    }
  }, [data, values.status]);

  const set = <K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const { pending, formError, fieldErrors, handleSubmit } = useRecordForm({
    submit: async () => {
      const payload = { ...cleanPayload({ ...values, id: undefined }), properties };
      return initial?.id
        ? api.patch<{ id: string }>(`/api/v1/leads/${initial.id}`, payload)
        : api.post<{ id: string }>("/api/v1/leads", payload);
    },
    onSuccess: onDone,
    successMessage: initial?.id ? "Lead aktualisiert." : "Lead erstellt.",
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <FormError message={formError} />

      <FormSection title="Kontaktdaten" description="Mindestens Name, Unternehmen, E-Mail oder Telefon angeben.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vorname" htmlFor="firstName" error={fieldErrors.firstName}>
            <Input id="firstName" value={values.firstName ?? ""} onChange={(event) => set("firstName", event.target.value)} autoFocus />
          </Field>
          <Field label="Nachname" htmlFor="lastName" error={fieldErrors.lastName}>
            <Input id="lastName" value={values.lastName ?? ""} onChange={(event) => set("lastName", event.target.value)} />
          </Field>
          <Field label="E-Mail" htmlFor="email" error={fieldErrors.email}>
            <Input id="email" type="email" value={values.email ?? ""} onChange={(event) => set("email", event.target.value)} />
          </Field>
          <Field label="Telefon" htmlFor="phone" error={fieldErrors.phone}>
            <Input id="phone" value={values.phone ?? ""} onChange={(event) => set("phone", event.target.value)} />
          </Field>
          <Field label="Unternehmen" htmlFor="companyName" error={fieldErrors.companyName}>
            <Input id="companyName" value={values.companyName ?? ""} onChange={(event) => set("companyName", event.target.value)} />
          </Field>
          <Field label="Position" htmlFor="jobTitle" error={fieldErrors.jobTitle}>
            <Input id="jobTitle" value={values.jobTitle ?? ""} onChange={(event) => set("jobTitle", event.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Qualifizierung">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" htmlFor="status" error={fieldErrors.status} required>
            <Select id="status" value={values.status ?? ""} onChange={(event) => set("status", event.target.value)} required>
              {data?.leadStatuses.map((status) => (
                <option key={status.key} value={status.key}>
                  {status.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bewertung (0–100)" htmlFor="score" error={fieldErrors.score}>
            <Input
              id="score"
              type="number"
              min={0}
              max={100}
              value={values.score ?? ""}
              onChange={(event) => set("score", event.target.value === "" ? null : Number(event.target.value))}
            />
          </Field>
          <Field label="Quelle" htmlFor="source" error={fieldErrors.source}>
            <Input id="source" value={values.source ?? ""} onChange={(event) => set("source", event.target.value)} />
          </Field>
          <Field label="Nächster Schritt" htmlFor="nextStepAt" error={fieldErrors.nextStepAt}>
            <Input
              id="nextStepAt"
              type="datetime-local"
              value={values.nextStepAt ? String(values.nextStepAt).slice(0, 16) : ""}
              onChange={(event) => set("nextStepAt", event.target.value || null)}
            />
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
        <Field label="Qualifizierungsnotiz" htmlFor="qualification" error={fieldErrors.qualification}>
          <Textarea
            id="qualification"
            rows={3}
            value={values.qualification ?? ""}
            onChange={(event) => set("qualification", event.target.value)}
          />
        </Field>
      </FormSection>

      {data?.properties.LEAD.length ? (
        <PropertyFields
          definitions={data.properties.LEAD}
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
          {initial?.id ? "Änderungen speichern" : "Lead erstellen"}
        </Button>
      </div>
    </form>
  );
}

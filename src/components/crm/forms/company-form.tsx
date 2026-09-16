"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useReference } from "@/components/app/reference-provider";
import { PropertyFields } from "@/components/crm/property-fields";
import { api } from "@/lib/api-client";
import { cleanPayload, FormError, FormSection, useRecordForm } from "./form-kit";

export type CompanyFormValues = {
  id?: string;
  name?: string;
  domain?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  annualRevenue?: number | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  lifecycleStage?: string | null;
  source?: string | null;
  description?: string | null;
  ownerId?: string | null;
  properties?: Record<string, unknown>;
};

export function CompanyForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: CompanyFormValues;
  onDone: (company: { id: string }) => void;
  onCancel?: () => void;
}) {
  const { data } = useReference();
  const [values, setValues] = React.useState<CompanyFormValues>(initial ?? {});
  const [properties, setProperties] = React.useState<Record<string, unknown>>(initial?.properties ?? {});

  const set = <K extends keyof CompanyFormValues>(key: K, value: CompanyFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const { pending, formError, fieldErrors, handleSubmit } = useRecordForm({
    submit: async () => {
      const payload = { ...cleanPayload({ ...values, id: undefined }), properties };
      return initial?.id
        ? api.patch<{ id: string }>(`/api/v1/companies/${initial.id}`, payload)
        : api.post<{ id: string }>("/api/v1/companies", payload);
    },
    onSuccess: onDone,
    successMessage: initial?.id ? "Unternehmen aktualisiert." : "Unternehmen erstellt.",
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <FormError message={formError} />

      <FormSection title="Unternehmen">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Firmenname" htmlFor="name" error={fieldErrors.name} required className="sm:col-span-2">
            <Input id="name" value={values.name ?? ""} onChange={(event) => set("name", event.target.value)} autoFocus required />
          </Field>
          <Field label="Domain" htmlFor="domain" error={fieldErrors.domain} hint="Ohne https:// – z. B. beispiel.de">
            <Input id="domain" value={values.domain ?? ""} onChange={(event) => set("domain", event.target.value)} />
          </Field>
          <Field label="Branche" htmlFor="industry" error={fieldErrors.industry}>
            <Input id="industry" value={values.industry ?? ""} onChange={(event) => set("industry", event.target.value)} />
          </Field>
          <Field label="Mitarbeiter" htmlFor="employeeCount" error={fieldErrors.employeeCount}>
            <Input
              id="employeeCount"
              type="number"
              min={0}
              value={values.employeeCount ?? ""}
              onChange={(event) => set("employeeCount", event.target.value === "" ? null : Number(event.target.value))}
            />
          </Field>
          <Field label="Jahresumsatz" htmlFor="annualRevenue" error={fieldErrors.annualRevenue}>
            <Input
              id="annualRevenue"
              type="number"
              min={0}
              step="0.01"
              value={values.annualRevenue ?? ""}
              onChange={(event) => set("annualRevenue", event.target.value === "" ? null : Number(event.target.value))}
            />
          </Field>
          <Field label="Telefon" htmlFor="phone" error={fieldErrors.phone}>
            <Input id="phone" value={values.phone ?? ""} onChange={(event) => set("phone", event.target.value)} />
          </Field>
          <Field label="E-Mail" htmlFor="email" error={fieldErrors.email}>
            <Input id="email" type="email" value={values.email ?? ""} onChange={(event) => set("email", event.target.value)} />
          </Field>
          <Field label="Website" htmlFor="website" error={fieldErrors.website} className="sm:col-span-2">
            <Input
              id="website"
              type="url"
              placeholder="https://…"
              value={values.website ?? ""}
              onChange={(event) => set("website", event.target.value)}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Zuordnung">
        <div className="grid gap-3 sm:grid-cols-2">
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
          <Field label="Lifecycle Stage" htmlFor="lifecycleStage" error={fieldErrors.lifecycleStage}>
            <Select
              id="lifecycleStage"
              value={values.lifecycleStage ?? ""}
              onChange={(event) => set("lifecycleStage", event.target.value || null)}
            >
              <option value="">— nicht gesetzt —</option>
              {data?.lifecycleStages.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quelle" htmlFor="source" error={fieldErrors.source}>
            <Input id="source" value={values.source ?? ""} onChange={(event) => set("source", event.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Adresse">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Straße" htmlFor="street" className="sm:col-span-2">
            <Input id="street" value={values.street ?? ""} onChange={(event) => set("street", event.target.value)} />
          </Field>
          <Field label="PLZ" htmlFor="postalCode">
            <Input id="postalCode" value={values.postalCode ?? ""} onChange={(event) => set("postalCode", event.target.value)} />
          </Field>
          <Field label="Stadt" htmlFor="city">
            <Input id="city" value={values.city ?? ""} onChange={(event) => set("city", event.target.value)} />
          </Field>
          <Field label="Land" htmlFor="country">
            <Input id="country" value={values.country ?? ""} onChange={(event) => set("country", event.target.value)} />
          </Field>
        </div>
      </FormSection>

      <Field label="Beschreibung" htmlFor="description">
        <Textarea
          id="description"
          value={values.description ?? ""}
          onChange={(event) => set("description", event.target.value)}
        />
      </Field>

      {data?.properties.COMPANY.length ? (
        <PropertyFields
          definitions={data.properties.COMPANY}
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
          {initial?.id ? "Änderungen speichern" : "Unternehmen erstellen"}
        </Button>
      </div>
    </form>
  );
}

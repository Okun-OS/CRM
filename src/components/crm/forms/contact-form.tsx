"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useReference, useCompanyOptions } from "@/components/app/reference-provider";
import { PropertyFields } from "@/components/crm/property-fields";
import { api } from "@/lib/api-client";
import { cleanPayload, FormError, FormSection, useRecordForm } from "./form-kit";

export type ContactFormValues = {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  jobTitle?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  lifecycleStage?: string | null;
  leadStatus?: string | null;
  source?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  description?: string | null;
  ownerId?: string | null;
  properties?: Record<string, unknown>;
};

export function ContactForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: ContactFormValues;
  onDone: (contact: { id: string }) => void;
  onCancel?: () => void;
}) {
  const { data } = useReference();
  const [values, setValues] = React.useState<ContactFormValues>(initial ?? {});
  const [properties, setProperties] = React.useState<Record<string, unknown>>(initial?.properties ?? {});
  const [companySearch, setCompanySearch] = React.useState("");
  const companies = useCompanyOptions(companySearch);

  const set = <K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const { pending, formError, fieldErrors, handleSubmit } = useRecordForm({
    submit: async () => {
      const payload = { ...cleanPayload({ ...values, companyName: undefined, id: undefined }), properties };
      return initial?.id
        ? api.patch<{ id: string }>(`/api/v1/contacts/${initial.id}`, payload)
        : api.post<{ id: string }>("/api/v1/contacts", payload);
    },
    onSuccess: onDone,
    successMessage: initial?.id ? "Kontakt aktualisiert." : "Kontakt erstellt.",
  });

  // Keep the chosen company visible in the picker even before a search runs.
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

      <FormSection title="Person">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vorname" htmlFor="firstName" error={fieldErrors.firstName} required>
            <Input
              id="firstName"
              value={values.firstName ?? ""}
              onChange={(event) => set("firstName", event.target.value)}
              autoFocus
              required
            />
          </Field>
          <Field label="Nachname" htmlFor="lastName" error={fieldErrors.lastName} required>
            <Input
              id="lastName"
              value={values.lastName ?? ""}
              onChange={(event) => set("lastName", event.target.value)}
              required
            />
          </Field>
          <Field label="E-Mail" htmlFor="email" error={fieldErrors.email}>
            <Input id="email" type="email" value={values.email ?? ""} onChange={(event) => set("email", event.target.value)} />
          </Field>
          <Field label="Position" htmlFor="jobTitle" error={fieldErrors.jobTitle}>
            <Input id="jobTitle" value={values.jobTitle ?? ""} onChange={(event) => set("jobTitle", event.target.value)} />
          </Field>
          <Field label="Telefon" htmlFor="phone" error={fieldErrors.phone}>
            <Input id="phone" value={values.phone ?? ""} onChange={(event) => set("phone", event.target.value)} />
          </Field>
          <Field label="Mobil" htmlFor="mobile" error={fieldErrors.mobile}>
            <Input id="mobile" value={values.mobile ?? ""} onChange={(event) => set("mobile", event.target.value)} />
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

          <Field label="Lead-Status" htmlFor="leadStatus" error={fieldErrors.leadStatus}>
            <Select
              id="leadStatus"
              value={values.leadStatus ?? ""}
              onChange={(event) => set("leadStatus", event.target.value || null)}
            >
              <option value="">— nicht gesetzt —</option>
              {data?.leadStatuses.map((status) => (
                <option key={status.key} value={status.key}>
                  {status.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Quelle" htmlFor="source" error={fieldErrors.source}>
            <Input id="source" value={values.source ?? ""} onChange={(event) => set("source", event.target.value)} />
          </Field>

          <Field label="LinkedIn" htmlFor="linkedinUrl" error={fieldErrors.linkedinUrl}>
            <Input
              id="linkedinUrl"
              type="url"
              placeholder="https://…"
              value={values.linkedinUrl ?? ""}
              onChange={(event) => set("linkedinUrl", event.target.value)}
            />
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

      <FormSection title="Notiz">
        <Field label="Beschreibung" htmlFor="description">
          <Textarea
            id="description"
            value={values.description ?? ""}
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>
      </FormSection>

      {data?.properties.CONTACT.length ? (
        <PropertyFields
          definitions={data.properties.CONTACT}
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
          {initial?.id ? "Änderungen speichern" : "Kontakt erstellen"}
        </Button>
      </div>
    </form>
  );
}

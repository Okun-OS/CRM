"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/crm/forms/form-kit";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, formatNumber } from "@/lib/format";
import { BRAND } from "@/lib/brand/config";
import { PoweredByOkunSoftware } from "@/components/brand/marks";

type Organization = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  industry: string | null;
  currency: string;
  timezone: string;
  locale: string;
  createdAt: string;
  counts: { members: number; contacts: number; companies: number; deals: number };
};

export function OrganizationForm({ organization }: { organization: Organization }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = React.useState({
    name: organization.name,
    domain: organization.domain ?? "",
    industry: organization.industry ?? "",
    currency: organization.currency,
    timezone: organization.timezone,
    locale: organization.locale,
  });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.patch("/api/v1/organization", values);
      toast.success("Organisationsdaten gespeichert.");
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else {
        setError("Die Daten konnten nicht gespeichert werden.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Stammdaten" />
        <CardBody>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError message={error} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="org-name" error={fieldErrors.name} required>
                <Input id="org-name" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} required />
              </Field>
              <Field label="Domain" htmlFor="org-domain" error={fieldErrors.domain}>
                <Input id="org-domain" value={values.domain} onChange={(event) => setValues({ ...values, domain: event.target.value })} placeholder="beispiel.de" />
              </Field>
              <Field label="Branche" htmlFor="org-industry" error={fieldErrors.industry}>
                <Input id="org-industry" value={values.industry} onChange={(event) => setValues({ ...values, industry: event.target.value })} />
              </Field>
              <Field label="Währung" htmlFor="org-currency" error={fieldErrors.currency}>
                <Select id="org-currency" value={values.currency} onChange={(event) => setValues({ ...values, currency: event.target.value })}>
                  <option value="EUR">Euro (EUR)</option>
                  <option value="CHF">Schweizer Franken (CHF)</option>
                  <option value="USD">US-Dollar (USD)</option>
                  <option value="GBP">Britisches Pfund (GBP)</option>
                </Select>
              </Field>
              <Field label="Zeitzone" htmlFor="org-timezone" error={fieldErrors.timezone}>
                <Select id="org-timezone" value={values.timezone} onChange={(event) => setValues({ ...values, timezone: event.target.value })}>
                  {["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/London", "UTC"].map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sprache" htmlFor="org-locale" error={fieldErrors.locale}>
                <Select id="org-locale" value={values.locale} onChange={(event) => setValues({ ...values, locale: event.target.value })}>
                  <option value="de-DE">Deutsch</option>
                  <option value="en-US">English</option>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={pending}>
                Speichern
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Überblick" description="Bestand dieser Organisation" />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-4">
            {[
              ["Mitglieder", organization.counts.members],
              ["Kontakte", organization.counts.contacts],
              ["Unternehmen", organization.counts.companies],
              ["Deals", organization.counts.deals],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-2xs uppercase tracking-wide text-ink-400">{label}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">{formatNumber(Number(value))}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 border-t border-ink-100 pt-3 text-2xs text-ink-500">
            Organisations-ID <code className="rounded bg-ink-100 px-1 py-0.5 font-mono">{organization.slug}</code> · angelegt am{" "}
            {formatDate(organization.createdAt)}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Produkt & Marke" />
        <CardBody className="space-y-3 text-xs leading-relaxed text-ink-600">
          <p>
            Dieses CRM ist <span className="font-medium text-ink-900">{BRAND.productName}</span> – ein Produkt von{" "}
            <span className="font-medium text-ink-900">{BRAND.vendorName}</span>.
          </p>
          <PoweredByOkunSoftware />
          <p>
            Die Markenführung (Farben, Logos, Typografie) liegt zentral in{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 font-mono">src/lib/brand/config.ts</code> und den Brand-Assets unter{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 font-mono">public/brand/</code>. Damit ist eine spätere
            White-Label-Fähigkeit vorbereitet, ohne die aktuelle Produktqualität zu verwässern.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

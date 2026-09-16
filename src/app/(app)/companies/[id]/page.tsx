import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Globe, Mail, Phone } from "lucide-react";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { AppError } from "@/lib/api/errors";
import { getCompany } from "@/server/services/companies";
import { listLifecycleStages } from "@/server/services/settings";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, PropertyList, RecordDetailLayout, RelatedList, Section } from "@/components/crm/record-detail";
import { RecordTabs } from "@/components/crm/record-tabs";
import { RecordActions } from "@/components/crm/record-actions";
import { CompanyForm } from "@/components/crm/forms/company-form";
import { formatCurrency, formatDate, formatNumber, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const actor = await getActor();
  if (!actor) return { title: "Unternehmen" };
  try {
    return { title: (await getCompany(actor, (await params).id)).name };
  } catch {
    return { title: "Unternehmen" };
  }
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return null;
  const { id } = await params;

  let company;
  try {
    company = await getCompany(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const lifecycleStages = await listLifecycleStages(actor);
  const lifecycleLabel = lifecycleStages.find((stage) => stage.key === company.lifecycleStage)?.label;
  const openDeals = company.deals.filter((deal) => deal.status === "OPEN");
  const openValue = openDeals.reduce((sum, deal) => sum + deal.amount, 0);

  return (
    <RecordDetailLayout
      header={
        <div className="space-y-3">
          <Breadcrumb items={[{ label: "Unternehmen", href: "/companies" }, { label: company.name }]} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-ink-900">{company.name}</h1>
              <p className="mt-0.5 text-sm text-ink-500">
                {[company.industry, company.city].filter(Boolean).join(" · ") || "Keine Branche hinterlegt"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {lifecycleLabel ? <Badge tone="brand">{lifecycleLabel}</Badge> : null}
                {company.tags.map((tag) => (
                  <Badge key={tag.id}>{tag.name}</Badge>
                ))}
              </div>
            </div>

            <RecordActions
              recordId={company.id}
              endpoint="/api/v1/companies"
              listHref="/companies"
              editTitle="Unternehmen bearbeiten"
              canEdit={can(actor, "companies.write")}
              canDelete={can(actor, "companies.delete")}
              deleteTitle="Unternehmen löschen?"
              deleteDescription={`„${company.name}" wird als gelöscht markiert. Kontakte und Deals bleiben erhalten.`}
              renderForm={(close) => (
                <CompanyForm
                  initial={{
                    id: company.id,
                    name: company.name,
                    domain: company.domain,
                    industry: company.industry,
                    employeeCount: company.employeeCount,
                    annualRevenue: company.annualRevenue,
                    phone: company.phone,
                    email: company.email,
                    website: company.website,
                    street: company.street,
                    postalCode: company.postalCode,
                    city: company.city,
                    country: company.country,
                    lifecycleStage: company.lifecycleStage,
                    source: company.source,
                    description: company.description,
                    ownerId: company.owner?.id ?? null,
                    properties: company.properties,
                  }}
                  onDone={() => close(true)}
                  onCancel={() => close(false)}
                />
              )}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-ink-600">
            {company.domain ? (
              <a
                href={`https://${company.domain}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 hover:text-brand-600"
              >
                <Globe className="h-3.5 w-3.5" /> {company.domain}
              </a>
            ) : null}
            {company.email ? (
              <a href={`mailto:${company.email}`} className="inline-flex items-center gap-1.5 hover:text-brand-600">
                <Mail className="h-3.5 w-3.5" /> {company.email}
              </a>
            ) : null}
            {company.phone ? (
              <a href={`tel:${company.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-600">
                <Phone className="h-3.5 w-3.5" /> {company.phone}
              </a>
            ) : null}
          </div>
        </div>
      }
      left={
        <>
          <Section title="Eigenschaften">
            <PropertyList
              items={[
                { label: "Owner", value: company.owner?.name ?? "—" },
                { label: "Branche", value: company.industry ?? "—" },
                { label: "Mitarbeiter", value: company.employeeCount ? formatNumber(company.employeeCount) : "—" },
                { label: "Jahresumsatz", value: company.annualRevenue ? formatCurrency(company.annualRevenue) : "—" },
                { label: "Lifecycle", value: lifecycleLabel ?? "—" },
                { label: "Quelle", value: company.source ?? "—" },
                {
                  label: "Adresse",
                  value:
                    [company.street, [company.postalCode, company.city].filter(Boolean).join(" "), company.country]
                      .filter(Boolean)
                      .join(", ") || "—",
                },
                { label: "Erstellt", value: formatDate(company.createdAt) },
                { label: "Letzte Aktivität", value: company.lastActivityAt ? formatRelative(company.lastActivityAt) : "—" },
              ]}
            />
          </Section>

          {company.propertyDefinitions.length > 0 ? (
            <Section title="Weitere Eigenschaften">
              <PropertyList
                items={company.propertyDefinitions.map((definition) => ({
                  label: definition.label,
                  value: formatPropertyValue(company.properties[definition.key]),
                }))}
              />
            </Section>
          ) : null}
        </>
      }
      center={
        <RecordTabs
          links={{ companyId: company.id }}
          permissions={{
            canLogActivity: can(actor, "activities.write"),
            canWriteNotes: can(actor, "notes.write"),
            canWriteTasks: can(actor, "tasks.write"),
            canWriteMeetings: can(actor, "meetings.write"),
            canUploadFiles: can(actor, "files.write"),
            canDeleteFiles: can(actor, "files.delete"),
          }}
        />
      }
      right={
        <>
          <Section title={`Kontakte (${company.contacts.length})`}>
            <RelatedList
              emptyMessage="Diesem Unternehmen ist noch kein Kontakt zugeordnet."
              items={company.contacts.map((contact) => ({
                id: contact.id,
                href: `/contacts/${contact.id}`,
                title: contact.name,
                subtitle: contact.jobTitle ?? contact.email,
              }))}
            />
          </Section>

          <Section title={`Deals (${company.deals.length})`}>
            <RelatedList
              emptyMessage="Noch keine Deals mit diesem Unternehmen."
              items={company.deals.map((deal) => ({
                id: deal.id,
                href: `/deals/${deal.id}`,
                title: deal.name,
                subtitle: deal.stage.name,
                meta: formatCurrency(deal.amount, deal.currency),
              }))}
            />
          </Section>

          <Section title="Auf einen Blick">
            <PropertyList
              items={[
                { label: "Offene Deals", value: String(openDeals.length) },
                { label: "Offener Wert", value: formatCurrency(openValue) },
                { label: "Offene Aufgaben", value: String(company.openTasks) },
              ]}
            />
          </Section>
        </>
      }
    />
  );
}

function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  return String(value);
}

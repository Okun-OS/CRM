import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Mail, Phone } from "lucide-react";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { AppError } from "@/lib/api/errors";
import { getContact } from "@/server/services/contacts";
import { listLifecycleStages, listLeadStatuses } from "@/server/services/settings";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Breadcrumb, PropertyList, RecordDetailLayout, RelatedList, Section } from "@/components/crm/record-detail";
import { RecordTabs } from "@/components/crm/record-tabs";
import { RecordActions } from "@/components/crm/record-actions";
import { formatCurrency, formatDate, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const actor = await getActor();
  if (!actor) return { title: "Kontakt" };
  try {
    const contact = await getContact(actor, (await params).id);
    return { title: contact.name };
  } catch {
    return { title: "Kontakt" };
  }
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return null;
  const { id } = await params;

  let contact;
  try {
    contact = await getContact(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [lifecycleStages, leadStatuses] = await Promise.all([listLifecycleStages(actor), listLeadStatuses(actor)]);
  const lifecycleLabel = lifecycleStages.find((stage) => stage.key === contact.lifecycleStage)?.label;
  const leadStatusLabel = leadStatuses.find((status) => status.key === contact.leadStatus)?.label;

  return (
    <RecordDetailLayout
      header={
        <div className="space-y-3">
          <Breadcrumb items={[{ label: "Kontakte", href: "/contacts" }, { label: contact.name }]} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Avatar name={contact.name} size="lg" />
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-ink-900">{contact.name}</h1>
                <p className="mt-0.5 text-sm text-ink-500">
                  {[contact.jobTitle, contact.company?.name].filter(Boolean).join(" · ") || "Keine Position hinterlegt"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {lifecycleLabel ? <Badge tone="brand">{lifecycleLabel}</Badge> : null}
                  {leadStatusLabel ? <Badge>{leadStatusLabel}</Badge> : null}
                  {contact.tags.map((tag) => (
                    <Badge key={tag.id} tone="neutral">
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <RecordActions
              recordId={contact.id}
              endpoint="/api/v1/contacts"
              listHref="/contacts"
              editTitle="Kontakt bearbeiten"
              canEdit={can(actor, "contacts.write")}
              canDelete={can(actor, "contacts.delete")}
              deleteTitle="Kontakt löschen?"
              deleteDescription={`„${contact.name}" wird als gelöscht markiert. Aktivitäten und Deals bleiben erhalten.`}
              editor={{
                kind: "contact",
                initial: {
                  id: contact.id,
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                  email: contact.email,
                  phone: contact.phone,
                  mobile: contact.mobile,
                  jobTitle: contact.jobTitle,
                  companyId: contact.company?.id ?? null,
                  companyName: contact.company?.name ?? null,
                  lifecycleStage: contact.lifecycleStage,
                  leadStatus: contact.leadStatus,
                  source: contact.source,
                  street: contact.street,
                  postalCode: contact.postalCode,
                  city: contact.city,
                  country: contact.country,
                  linkedinUrl: contact.linkedinUrl,
                  description: contact.description,
                  ownerId: contact.owner?.id ?? null,
                  properties: contact.properties,
                },
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-ink-600">
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 hover:text-brand-600">
                <Mail className="h-3.5 w-3.5" /> {contact.email}
              </a>
            ) : null}
            {contact.phone ? (
              <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-600">
                <Phone className="h-3.5 w-3.5" /> {contact.phone}
              </a>
            ) : null}
            {contact.company ? (
              <Link href={`/companies/${contact.company.id}`} className="inline-flex items-center gap-1.5 hover:text-brand-600">
                <Building2 className="h-3.5 w-3.5" /> {contact.company.name}
              </Link>
            ) : null}
          </div>
        </div>
      }
      left={
        <>
          <Section title="Eigenschaften">
            <PropertyList
              items={[
                { label: "Owner", value: contact.owner?.name ?? "—" },
                { label: "E-Mail", value: contact.email ?? "—" },
                { label: "Telefon", value: contact.phone ?? "—" },
                { label: "Mobil", value: contact.mobile ?? "—" },
                { label: "Position", value: contact.jobTitle ?? "—" },
                { label: "Lifecycle", value: lifecycleLabel ?? "—" },
                { label: "Lead-Status", value: leadStatusLabel ?? "—" },
                { label: "Quelle", value: contact.source ?? "—" },
                {
                  label: "Adresse",
                  value:
                    [contact.street, [contact.postalCode, contact.city].filter(Boolean).join(" "), contact.country]
                      .filter(Boolean)
                      .join(", ") || "—",
                },
                { label: "Erstellt", value: formatDate(contact.createdAt) },
                { label: "Letzte Aktivität", value: contact.lastActivityAt ? formatRelative(contact.lastActivityAt) : "—" },
              ]}
            />
          </Section>

          {contact.propertyDefinitions.length > 0 ? (
            <Section title="Weitere Eigenschaften">
              <PropertyList
                items={contact.propertyDefinitions.map((definition) => ({
                  label: definition.label,
                  value: formatPropertyValue(contact.properties[definition.key]),
                }))}
              />
            </Section>
          ) : null}
        </>
      }
      center={
        <RecordTabs
          links={{ contactId: contact.id }}
          refreshKey={contact.updatedAt}
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
          <Section title="Deals">
            <RelatedList
              emptyMessage="Noch keine Deals mit diesem Kontakt."
              items={contact.deals.map((deal) => ({
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
                { label: "Offene Aufgaben", value: String(contact.openTasks) },
                {
                  label: "Nächster Termin",
                  value: contact.upcomingMeeting
                    ? `${contact.upcomingMeeting.title} · ${formatDate(contact.upcomingMeeting.startAt)}`
                    : "—",
                },
                { label: "Offene Deals", value: String(contact.deals.filter((deal) => deal.status === "OPEN").length) },
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

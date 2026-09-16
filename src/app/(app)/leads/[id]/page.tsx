import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { AppError } from "@/lib/api/errors";
import { getLead } from "@/server/services/leads";
import { listLeadStatuses } from "@/server/services/settings";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, PropertyList, RecordDetailLayout, Section } from "@/components/crm/record-detail";
import { RecordTabs } from "@/components/crm/record-tabs";
import { RecordActions } from "@/components/crm/record-actions";
import { ConvertLeadAction } from "./convert-action";
import { formatDate, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const actor = await getActor();
  if (!actor) return { title: "Lead" };
  try {
    return { title: (await getLead(actor, (await params).id)).name };
  } catch {
    return { title: "Lead" };
  }
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return null;
  const { id } = await params;

  let lead;
  try {
    lead = await getLead(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const statuses = await listLeadStatuses(actor);
  const statusLabel = statuses.find((status) => status.key === lead.status)?.label ?? lead.status;

  return (
    <RecordDetailLayout
      header={
        <div className="space-y-3">
          <Breadcrumb items={[{ label: "Leads", href: "/leads" }, { label: lead.name }]} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-ink-900">{lead.name}</h1>
              <p className="mt-0.5 text-sm text-ink-500">
                {[lead.jobTitle, lead.companyName].filter(Boolean).join(" · ") || "Kein Unternehmen hinterlegt"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="brand">{statusLabel}</Badge>
                {lead.score !== null ? <Badge tone={lead.score >= 70 ? "success" : "neutral"}>Score {lead.score}</Badge> : null}
                {lead.convertedAt ? <Badge tone="success">Konvertiert</Badge> : null}
              </div>
            </div>

            <RecordActions
              recordId={lead.id}
              endpoint="/api/v1/leads"
              listHref="/leads"
              editTitle="Lead bearbeiten"
              canEdit={can(actor, "leads.write") && !lead.convertedAt}
              canDelete={can(actor, "leads.delete")}
              deleteTitle="Lead löschen?"
              deleteDescription={`„${lead.name}" wird als gelöscht markiert.`}
              extraActions={
                !lead.convertedAt && can(actor, "leads.write") && can(actor, "contacts.write") ? (
                  <ConvertLeadAction leadId={lead.id} leadName={lead.name} companyName={lead.companyName} />
                ) : null
              }
              editor={{
                kind: "lead",
                initial: {
                  id: lead.id,
                  firstName: lead.firstName,
                  lastName: lead.lastName,
                  email: lead.email,
                  phone: lead.phone,
                  companyName: lead.companyName,
                  jobTitle: lead.jobTitle,
                  source: lead.source,
                  status: lead.status,
                  score: lead.score,
                  qualification: lead.qualification,
                  nextStepAt: lead.nextStepAt,
                  ownerId: lead.owner?.id ?? null,
                  properties: lead.properties,
                },
              }}
            />
          </div>
        </div>
      }
      left={
        <>
          <Section title="Eigenschaften">
            <PropertyList
              items={[
                { label: "Owner", value: lead.owner?.name ?? "—" },
                { label: "Status", value: statusLabel },
                { label: "E-Mail", value: lead.email ?? "—" },
                { label: "Telefon", value: lead.phone ?? "—" },
                { label: "Unternehmen", value: lead.companyName ?? "—" },
                { label: "Quelle", value: lead.source ?? "—" },
                { label: "Bewertung", value: lead.score !== null ? String(lead.score) : "—" },
                { label: "Nächster Schritt", value: lead.nextStepAt ? formatDate(lead.nextStepAt) : "—" },
                { label: "Erstellt", value: formatDate(lead.createdAt) },
                { label: "Letzte Aktivität", value: lead.lastActivityAt ? formatRelative(lead.lastActivityAt) : "—" },
              ]}
            />
          </Section>

          {lead.qualification ? (
            <Section title="Qualifizierung">
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-700">{lead.qualification}</p>
            </Section>
          ) : null}

          {lead.propertyDefinitions.length > 0 ? (
            <Section title="Weitere Eigenschaften">
              <PropertyList
                items={lead.propertyDefinitions.map((definition) => ({
                  label: definition.label,
                  value: formatPropertyValue(lead.properties[definition.key]),
                }))}
              />
            </Section>
          ) : null}
        </>
      }
      center={
        <RecordTabs
          links={{ leadId: lead.id }}
          refreshKey={lead.updatedAt}
          permissions={{
            canLogActivity: can(actor, "activities.write"),
            canWriteNotes: can(actor, "notes.write"),
            canWriteTasks: can(actor, "tasks.write"),
            canWriteMeetings: false,
            canUploadFiles: false,
            canDeleteFiles: false,
          }}
        />
      }
      right={
        lead.convertedAt ? (
          <Section title="Konvertierung">
            <PropertyList
              items={[
                { label: "Konvertiert", value: formatDate(lead.convertedAt) },
                {
                  label: "Kontakt",
                  value: lead.convertedContactId ? (
                    <a href={`/contacts/${lead.convertedContactId}`} className="text-brand-600 hover:text-brand-700">
                      Kontakt öffnen
                    </a>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Unternehmen",
                  value: lead.convertedCompanyId ? (
                    <a href={`/companies/${lead.convertedCompanyId}`} className="text-brand-600 hover:text-brand-700">
                      Unternehmen öffnen
                    </a>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Deal",
                  value: lead.convertedDealId ? (
                    <a href={`/deals/${lead.convertedDealId}`} className="text-brand-600 hover:text-brand-700">
                      Deal öffnen
                    </a>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
          </Section>
        ) : (
          <Section title="Nächster Schritt">
            <p className="text-xs leading-relaxed text-ink-600">
              Wenn dieser Lead qualifiziert ist, erzeugt die Konvertierung daraus einen Kontakt, optional ein
              Unternehmen und einen Deal – alle bleiben mit diesem Lead verknüpft.
            </p>
          </Section>
        )
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

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { AppError } from "@/lib/api/errors";
import { getDeal } from "@/server/services/deals";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, PropertyList, RecordDetailLayout, RelatedList, Section } from "@/components/crm/record-detail";
import { RecordTabs } from "@/components/crm/record-tabs";
import { RecordActions } from "@/components/crm/record-actions";
import { NextActionPanel } from "@/components/crm/next-action-panel";
import { DealStagePicker } from "./stage-picker";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const actor = await getActor();
  if (!actor) return { title: "Deal" };
  try {
    return { title: (await getDeal(actor, (await params).id)).name };
  } catch {
    return { title: "Deal" };
  }
}

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return null;
  const { id } = await params;

  let deal;
  try {
    deal = await getDeal(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const statusTone = deal.status === "WON" ? "success" : deal.status === "LOST" ? "danger" : "brand";
  const statusLabel = deal.status === "WON" ? "Gewonnen" : deal.status === "LOST" ? "Verloren" : "Offen";

  return (
    <RecordDetailLayout
      header={
        <div className="space-y-3">
          <Breadcrumb items={[{ label: "Deals", href: "/deals" }, { label: deal.name }]} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-ink-900">{deal.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                <span className="text-lg font-semibold text-ink-900 tabular-nums">
                  {formatCurrency(deal.amount, deal.currency)}
                </span>
                <Badge tone={statusTone} dot>
                  {statusLabel}
                </Badge>
                {deal.company ? (
                  <Link href={`/companies/${deal.company.id}`} className="inline-flex items-center gap-1.5 hover:text-brand-600">
                    <Building2 className="h-3.5 w-3.5" /> {deal.company.name}
                  </Link>
                ) : null}
              </p>
            </div>

            <RecordActions
              recordId={deal.id}
              endpoint="/api/v1/deals"
              listHref="/deals"
              editTitle="Deal bearbeiten"
              canEdit={can(actor, "deals.write")}
              canDelete={can(actor, "deals.delete")}
              deleteTitle="Deal löschen?"
              deleteDescription={`„${deal.name}" wird als gelöscht markiert. Die Stage-Historie bleibt erhalten.`}
              editor={{
                kind: "deal",
                initial: {
                  id: deal.id,
                  name: deal.name,
                  pipelineId: deal.pipeline.id,
                  stageId: deal.stage.id,
                  amount: deal.amount,
                  currency: deal.currency,
                  probability: deal.probability,
                  expectedCloseDate: deal.expectedCloseDate,
                  companyId: deal.company?.id ?? null,
                  companyName: deal.company?.name ?? null,
                  contactIds: deal.contacts.map((contact) => contact.id),
                  source: deal.source,
                  description: deal.description,
                  ownerId: deal.owner?.id ?? null,
                  properties: deal.properties,
                },
              }}
            />
          </div>

          <DealStagePicker
            dealId={deal.id}
            stages={deal.pipeline.stages}
            currentStageId={deal.stage.id}
            canEdit={can(actor, "deals.write")}
          />
        </div>
      }
      left={
        <>
          <NextActionPanel kind="deal" id={deal.id} canEdit={can(actor, "deals.write")} />

          <Section title="Eigenschaften">
            <PropertyList
              items={[
                { label: "Owner", value: deal.owner?.name ?? "—" },
                { label: "Pipeline", value: deal.pipeline.name },
                { label: "Stage", value: deal.stage.name },
                { label: "Wert", value: formatCurrency(deal.amount, deal.currency) },
                {
                  label: "Wahrscheinlichkeit",
                  value: `${formatNumber(deal.probability ?? deal.stage.probability)} %`,
                },
                { label: "Erwarteter Abschluss", value: deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "—" },
                { label: "Abgeschlossen", value: deal.closedAt ? formatDate(deal.closedAt) : "—" },
                { label: "Quelle", value: deal.source ?? "—" },
                { label: "Erstellt", value: formatDate(deal.createdAt) },
              ]}
            />
          </Section>

          {deal.lostReason ? (
            <Section title="Verlustgrund">
              <p className="text-xs leading-relaxed text-ink-700">{deal.lostReason}</p>
            </Section>
          ) : null}

          {deal.propertyDefinitions.length > 0 ? (
            <Section title="Weitere Eigenschaften">
              <PropertyList
                items={deal.propertyDefinitions.map((definition) => ({
                  label: definition.label,
                  value: formatPropertyValue(deal.properties[definition.key]),
                }))}
              />
            </Section>
          ) : null}
        </>
      }
      center={
        <RecordTabs
          links={{ dealId: deal.id }}
          refreshKey={deal.updatedAt}
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
          <Section title={`Kontakte (${deal.contacts.length})`}>
            <RelatedList
              emptyMessage="Diesem Deal ist noch kein Kontakt zugeordnet."
              items={deal.contacts.map((contact) => ({
                id: contact.id,
                href: `/contacts/${contact.id}`,
                title: contact.name,
                subtitle: contact.jobTitle ?? contact.email,
                meta: contact.isPrimary ? "Primär" : null,
              }))}
            />
          </Section>

          <Section title="Stage-Historie">
            {deal.stageHistory.length === 0 ? (
              <p className="rounded-md bg-ink-50 px-3 py-4 text-center text-xs text-ink-500">Noch keine Stage-Wechsel.</p>
            ) : (
              <ul className="space-y-2">
                {deal.stageHistory.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <p className="text-ink-800">
                      {entry.from ? `${entry.from.name} → ` : ""}
                      <span className="font-medium">{entry.to.name}</span>
                    </p>
                    <p className="text-2xs text-ink-500">
                      {formatDateTime(entry.changedAt)}
                      {entry.changedBy ? ` · ${entry.changedBy.name}` : ""}
                      {entry.durationSeconds ? ` · ${Math.round(entry.durationSeconds / 86400)} Tage in vorheriger Stage` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {deal.lineItems.length > 0 ? (
            <Section title="Positionen">
              <ul className="divide-y divide-ink-100 text-xs">
                {deal.lineItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="truncate text-ink-800">
                      {item.name} <span className="text-ink-400">× {item.quantity}</span>
                    </span>
                    <span className="tabular-nums text-ink-700">{formatCurrency(item.total, deal.currency)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
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

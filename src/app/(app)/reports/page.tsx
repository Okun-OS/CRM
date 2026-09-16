import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import {
  activityBreakdown,
  dealCycleTimes,
  dealsOverTime,
  leadConversion,
  pipelineFunnel,
  salesForecast,
  salesPerformance,
  sourceBreakdown,
} from "@/server/services/reports";
import { getOrganization } from "@/server/services/organizations";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import {
  ActivityMixChart,
  DealsOverTimeChart,
  ForecastChart,
  PipelineFunnelChart,
  SourceChart,
} from "@/components/charts/dashboard-charts";
import { formatCurrency, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/**
 * Reporting. Every chart is computed from this organization's records; where
 * there is nothing to show the section says so instead of inventing numbers.
 */
export default async function ReportsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "reports.read")) {
    return (
      <Card>
        <EmptyState
          title="Keine Berechtigung"
          description="Für Berichte fehlt dir die Berechtigung „reports.read“. Ein Administrator kann sie über die Rollenverwaltung vergeben."
        />
      </Card>
    );
  }

  const [organization, funnel, deals, forecast, sources, performance, cycle, activities, conversion] = await Promise.all([
    getOrganization(actor),
    pipelineFunnel(actor),
    dealsOverTime(actor, {}),
    salesForecast(actor, {}),
    sourceBreakdown(actor),
    salesPerformance(actor, {}),
    dealCycleTimes(actor),
    activityBreakdown(actor, {}),
    leadConversion(actor),
  ]);

  const currency = organization?.currency ?? "EUR";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Auswertungen über Pipeline, Abschlüsse, Quellen und Aktivitäten – auf Basis der tatsächlichen CRM-Daten."
      />

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Deals nach Stage" description={funnel.pipeline?.name ?? "Keine Pipeline"} />
          <CardBody>
            <PipelineFunnelChart stages={funnel.stages} currency={currency} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Deal-Entwicklung" description="Angelegt, gewonnen und verloren je Monat" />
          <CardBody>
            <DealsOverTimeChart data={deals} currency={currency} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sales Forecast" description="Offene Deals nach erwartetem Abschlussmonat" />
          <CardBody>
            <ForecastChart data={forecast} currency={currency} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Aktivitäten" description="Protokollierte Interaktionen der letzten Monate" />
          <CardBody>
            <ActivityMixChart data={activities} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lead-Quellen" description="Woher die Leads kommen" />
          <CardBody>
            <SourceChart data={sources.leads} label="Leads" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Deal-Quellen" description="Woher die Verkaufschancen kommen" />
          <CardBody>
            <SourceChart data={sources.deals} label="Deals" />
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Sales Performance" description="Gewonnene und offene Deals je Person" />
          <CardBody className="p-0">
            {performance.length === 0 ? (
              <EmptyState title="Keine Mitglieder" description="Sobald Deals einer Person zugeordnet sind, erscheint hier der Vergleich." compact />
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <Th>Person</Th>
                    <Th align="right">Gewonnen</Th>
                    <Th align="right">Gewonnener Wert</Th>
                    <Th align="right">Offene Deals</Th>
                    <Th align="right">Offener Wert</Th>
                    <Th align="right">Aktivitäten</Th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((row) => (
                    <Tr key={row.userId}>
                      <Td>{row.name}</Td>
                      <Td align="right">{formatNumber(row.wonDeals)}</Td>
                      <Td align="right">{formatCurrency(row.wonValue, currency)}</Td>
                      <Td align="right">{formatNumber(row.openDeals)}</Td>
                      <Td align="right">{formatCurrency(row.openValue, currency)}</Td>
                      <Td align="right">{formatNumber(row.activities)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Lead-Conversion" />
            <CardBody className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink-500">Leads gesamt</span>
                <span className="text-lg font-semibold tabular-nums text-ink-900">{formatNumber(conversion.total)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink-500">Konvertiert</span>
                <span className="text-lg font-semibold tabular-nums text-ink-900">{formatNumber(conversion.converted)}</span>
              </div>
              <div className="flex items-baseline justify-between border-t border-ink-100 pt-2">
                <span className="text-xs text-ink-500">Conversion Rate</span>
                <span className="text-lg font-semibold tabular-nums text-brand-600">
                  {conversion.conversionRate === null ? "—" : `${conversion.conversionRate} %`}
                </span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Dauer bis Abschluss" />
            <CardBody className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink-500">Ø Tage bis gewonnen</span>
                <span className="text-lg font-semibold tabular-nums text-ink-900">
                  {cycle.averageDaysToWin === null ? "—" : cycle.averageDaysToWin}
                </span>
              </div>
              <p className="text-2xs text-ink-400">
                {cycle.sampleSize > 0
                  ? `Basierend auf ${cycle.sampleSize} gewonnenen Deals.`
                  : "Noch keine gewonnenen Deals ausgewertet."}
              </p>
              {cycle.stages.length > 0 ? (
                <ul className="space-y-1 border-t border-ink-100 pt-2">
                  {cycle.stages.map((stage) => (
                    <li key={stage.stage} className="flex items-center justify-between text-xs">
                      <span className="truncate text-ink-600">{stage.stage}</span>
                      <span className="tabular-nums text-ink-800">{stage.averageDays} Tage</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </section>
    </div>
  );
}

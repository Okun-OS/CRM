"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

type Funnel = {
  prospects: number;
  qualified: number;
  contacted: number;
  replied: number;
  positive: number;
  meetings: number;
  opportunities: number;
  customers: number;
  pipelineValue: number;
  wonValue: number;
  currency: string;
};

type Attention = { key: string; label: string; count: number; href: string; tone: "neutral" | "warning" | "danger" };
type Attribution = { sourceKey: string; prospects: number; opportunities: number; customers: number; revenue: number };

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manuell angelegt",
  csv: "Tabelle",
  crm: "Eigener Bestand",
};

export function OverviewView() {
  const [data, setData] = React.useState<{ funnel: Funnel; attention: Attention[]; attribution: Attribution[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        setData(await api.get("/api/v1/outreach/analytics"));
      } catch {
        setError("Die Auswertung konnte nicht geladen werden.");
      }
    })();
  }, []);

  if (error) {
    return <EmptyState title="Auswertung nicht verfügbar" description={error} />;
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const { funnel, attention, attribution } = data;
  const empty = funnel.prospects === 0;

  return (
    <div className="space-y-5">
      {attention.length > 0 ? <AttentionPanel items={attention} /> : null}

      <Card data-tour="acquisition-funnel">
        <CardHeader
          title="Trichter"
          description="Die letzten 90 Tage. Jede Stufe zählt Prospects, die sie tatsächlich erreicht haben."
        />
        <CardBody>
          {empty ? (
            <EmptyState
              title="Noch keine Prospects"
              description="Sobald Prospects angelegt oder importiert sind, entsteht hier der Trichter von der Ansprache bis zum Umsatz."
              actions={
                <Link href="/outreach/prospects">
                  <Button variant="primary">Zu den Prospects</Button>
                </Link>
              }
            />
          ) : (
            <FunnelBars funnel={funnel} />
          )}
        </CardBody>
      </Card>

      {!empty ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Was daraus entstanden ist" description="Aus der Akquise erzeugte Pipeline und gewonnener Umsatz." />
            <CardBody className="grid grid-cols-2 gap-4">
              <Figure label="Pipeline" value={formatCurrency(funnel.pipelineValue, funnel.currency)} hint={`${funnel.opportunities} Opportunities`} />
              <Figure label="Umsatz" value={formatCurrency(funnel.wonValue, funnel.currency)} hint={`${funnel.customers} gewonnen`} tone="ok" />
            </CardBody>
          </Card>

          <Card data-tour="acquisition-attribution">
            <CardHeader title="Herkunft" description="Woher die Prospects kamen — und was daraus wurde." />
            <CardBody className="p-0">
              {attribution.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-500">Noch keine Herkunftsdaten.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {attribution.map((row) => (
                    <li key={row.sourceKey} className="flex items-baseline justify-between gap-3 px-5 py-3">
                      <span className="text-sm text-ink-800">{SOURCE_LABELS[row.sourceKey] ?? row.sourceKey}</span>
                      <span className="flex items-baseline gap-4 text-xs tabular-nums text-ink-500">
                        <span>{formatNumber(row.prospects)} Prospects</span>
                        <span>{formatNumber(row.customers)} Kunden</span>
                        <span className="font-medium text-ink-800">{formatCurrency(row.revenue, funnel.currency)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function AttentionPanel({ items }: { items: Attention[] }) {
  return (
    <Card data-tour="acquisition-attention">
      <CardHeader title="Braucht eine Entscheidung" description="Nicht was war — was liegen geblieben ist." />
      <CardBody className="p-0">
        <ul className="divide-y divide-ink-100">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-ink-50"
              >
                <span className="flex items-center gap-2.5 text-sm text-ink-800">
                  <AlertTriangle
                    className={cn(
                      "h-4 w-4 shrink-0",
                      item.tone === "danger" ? "text-danger-500" : item.tone === "warning" ? "text-warning-500" : "text-ink-400",
                    )}
                  />
                  {item.label}
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "neutral"}>
                    {item.count}
                  </Badge>
                  <ArrowRight className="h-3.5 w-3.5 text-ink-400" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/**
 * Der Trichter als Balken.
 *
 * Alle Balken teilen sich eine Skala — die Zahl der Prospects. Nur so zeigt
 * die Länge den tatsächlichen Abfall; einzeln normierte Balken sähen nach
 * gleichmäßigem Fortschritt aus, wo in Wahrheit neun Zehntel wegfallen.
 */
function FunnelBars({ funnel }: { funnel: Funnel }) {
  const stages = [
    { label: "Prospects", value: funnel.prospects },
    { label: "Qualifiziert", value: funnel.qualified },
    { label: "Angesprochen", value: funnel.contacted },
    { label: "Antworten", value: funnel.replied },
    { label: "Positive Antworten", value: funnel.positive },
    { label: "Termine", value: funnel.meetings },
    { label: "Opportunities", value: funnel.opportunities },
    { label: "Kunden", value: funnel.customers },
  ];
  const max = Math.max(1, funnel.prospects);

  return (
    <ol className="space-y-2.5">
      {stages.map((stage, index) => {
        const share = stage.value / max;
        const previous = index === 0 ? null : stages[index - 1].value;
        const conversion = previous && previous > 0 ? Math.round((stage.value / previous) * 100) : null;

        return (
          <li key={stage.label} className="grid grid-cols-[9.5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
            <span className="truncate text-sm text-ink-700">{stage.label}</span>
            <div className="h-6 overflow-hidden rounded bg-ink-100">
              <div
                className="h-full rounded bg-gradient-to-r from-brand-500 to-brand-400"
                style={{ width: `${Math.max(share * 100, stage.value > 0 ? 2 : 0)}%` }}
              />
            </div>
            <span className="text-right text-sm tabular-nums text-ink-900">
              {formatNumber(stage.value)}
              {conversion !== null ? (
                <span className="ml-1 text-2xs text-ink-400">{conversion}%</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok";
}) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wider text-ink-400">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "ok" ? "text-success-700" : "text-ink-900")}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

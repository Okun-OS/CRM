import Link from "next/link";
import { AlertTriangle, ArrowRight, Radar } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AcquisitionFunnel, AttentionItem } from "@/server/services/acquisition/analytics";

/**
 * Akquise im Haupt-Dashboard.
 *
 * Der Abschnitt wiederholt nicht die ganze Auswertung aus `/outreach`, sondern
 * beantwortet zwei Fragen an der Stelle, an der der Tag beginnt: Was ist oben
 * im Trichter passiert, und liegt etwas liegen geblieben?
 *
 * Er erscheint nur, wenn es etwas zu zeigen gibt — wer die Akquise nicht
 * nutzt, bekommt keinen Kasten voller Nullen. Und er erscheint nur für
 * Personen mit `prospects.read`; die Prüfung steht in der Dashboard-Seite,
 * bevor überhaupt Daten geladen werden.
 */
export function AcquisitionSection({
  funnel,
  attention,
}: {
  funnel: AcquisitionFunnel;
  attention: AttentionItem[];
}) {
  // Aus dem Trichter kommen hier nur die Stufen, an denen ein Mensch etwas
  // ändern kann. Die vollständige Kette samt Übergangsquoten steht in der
  // Akquise-Übersicht; sie hier zu verdoppeln würde sie nur verkürzen.
  const tiles = [
    { label: "Neue Prospects", value: funnel.prospects },
    { label: "Angesprochen", value: funnel.contacted },
    { label: "Antworten", value: funnel.replied },
    { label: "Termine", value: funnel.meetings },
  ];

  return (
    <Card>
      <CardHeader
        title="Akquise"
        description="Die letzten 90 Tage. Jede Zahl zählt Prospects, die die Stufe tatsächlich erreicht haben."
        action={
          <Link
            href="/outreach"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            Zur Akquise <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {tiles.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={formatNumber(tile.value)} />
          ))}
          <StatTile
            label="Pipeline aus Akquise"
            value={formatCurrency(funnel.pipelineValue, funnel.currency)}
            hint={`${formatNumber(funnel.opportunities)} Opportunities`}
          />
          <StatTile
            label="Umsatz aus Akquise"
            value={formatCurrency(funnel.wonValue, funnel.currency)}
            hint={`${formatNumber(funnel.customers)} gewonnen`}
            tone={funnel.wonValue > 0 ? "success" : "neutral"}
          />
        </div>

        {attention.length > 0 ? (
          <div className="rounded-md border border-ink-200/70">
            <p className="border-b border-ink-200/70 px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-400">
              Braucht eine Entscheidung
            </p>
            <ul className="divide-y divide-ink-100">
              {attention.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-ink-50"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-xs text-ink-800">
                      <AlertTriangle
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          item.tone === "danger"
                            ? "text-danger-500"
                            : item.tone === "warning"
                              ? "text-warning-500"
                              : "text-ink-400",
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "neutral"}>
                        {item.count}
                      </Badge>
                      <ArrowRight className="h-3 w-3 text-ink-400" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-2xs text-ink-500">
            <Radar className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            In der Akquise liegt gerade nichts zur Entscheidung an.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

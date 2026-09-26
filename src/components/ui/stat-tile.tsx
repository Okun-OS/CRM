import { cn } from "@/lib/cn";

/**
 * Eine Kennzahl in einem Kasten.
 *
 * Absichtlich ohne Trend, Pfeil oder Vergleichswert: Ein Pfeil nach oben wäre
 * eine Aussage, die diese Komponente nicht belegen kann. Sie zeigt eine Zahl
 * und sagt, was sie bedeutet.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "danger" | "warning" | "success";
  className?: string;
}) {
  const valueTone =
    tone === "danger"
      ? "text-danger-600"
      : tone === "warning"
        ? "text-warning-700"
        : tone === "success"
          ? "text-success-700"
          : "text-ink-900";

  return (
    <div className={cn("rounded-md border border-ink-200/70 bg-ink-50/50 px-3 py-2.5", className)}>
      <p className="text-2xs text-ink-500">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", valueTone)}>{value}</p>
      {hint ? <p className="mt-0.5 text-2xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

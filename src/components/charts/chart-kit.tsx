"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { CHART_INK } from "@/lib/charts";

/**
 * Shared chart chrome: a consistent frame, an accessible empty state and one
 * tooltip style for every chart in the product.
 */
export function ChartFrame({
  height = 260,
  children,
  className,
}: {
  height?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      {children}
    </div>
  );
}

export function ChartEmpty({ message, height = 260 }: { message: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-ink-200 bg-ink-50/40 px-6 text-center"
      style={{ height }}
    >
      <p className="max-w-xs text-xs leading-relaxed text-ink-500">{message}</p>
    </div>
  );
}

type TooltipRow = { label: string; value: string; color?: string };

export function ChartTooltip({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white px-2.5 py-2 shadow-raised">
      <p className="text-2xs font-semibold text-ink-900">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-2xs text-ink-600">
            {row.color ? <span className="h-2 w-2 rounded-sm" style={{ background: row.color }} /> : null}
            <span className="flex-1">{row.label}</span>
            <span className="font-medium tabular-nums text-ink-900">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend rendered outside the plot; identity is never colour-alone. */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-2xs text-ink-600">
          <span className="h-2 w-2 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export const GRID_PROPS = {
  stroke: CHART_INK.grid,
  strokeDasharray: "3 3",
  vertical: false,
} as const;

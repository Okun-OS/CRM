"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_PROPS, CHART_STATUS, formatMonthLabel, ordinalColor, seriesColor } from "@/lib/charts";
import { formatCurrency, formatNumber } from "@/lib/format";
import { ChartEmpty, ChartFrame, ChartLegend, ChartTooltip, GRID_PROPS } from "./chart-kit";

type FunnelStage = { id: string; name: string; type: string; count: number; amount: number };

/**
 * Pipeline funnel — an ordered magnitude comparison, so a horizontal bar chart
 * with an ordinal blue ramp rather than a decorative funnel shape.
 */
export function PipelineFunnelChart({ stages, currency }: { stages: FunnelStage[]; currency: string }) {
  const open = stages.filter((stage) => stage.type === "OPEN");
  const data = open.length > 0 ? open : stages;
  const hasValues = data.some((stage) => stage.count > 0);

  if (!hasValues) {
    return (
      <ChartEmpty
        height={240}
        message="Noch keine Deals in dieser Pipeline. Sobald Deals angelegt sind, zeigt dieser Funnel Anzahl und Wert je Stage."
      />
    );
  }

  return (
    <ChartFrame height={Math.max(200, data.length * 42)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={8}>
          <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
          <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={104} {...AXIS_PROPS} />
          <Tooltip
            cursor={{ fill: "rgba(37,99,235,0.06)" }}
            content={({ active, payload }) => {
              const stage = payload?.[0]?.payload as FunnelStage | undefined;
              if (!active || !stage) return null;
              return (
                <ChartTooltip
                  title={stage.name}
                  rows={[
                    { label: "Deals", value: formatNumber(stage.count) },
                    { label: "Wert", value: formatCurrency(stage.amount, currency) },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18} label={{ position: "right", fontSize: 11, fill: "#6B7484" }}>
            {data.map((stage, index) => (
              <Cell key={stage.id} fill={ordinalColor(index, data.length)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

type MonthlyDeals = { month: string; created: number; won: number; lost: number; wonValue: number };

/**
 * Deal development. Won and lost are states, so they use the reserved status
 * colours; "erstellt" is the brand series. One axis only — the won value lives
 * in the tooltip rather than on a second scale.
 */
export function DealsOverTimeChart({ data, currency }: { data: MonthlyDeals[]; currency: string }) {
  const hasValues = data.some((row) => row.created + row.won + row.lost > 0);
  if (!hasValues) {
    return (
      <ChartEmpty message="Für den gewählten Zeitraum liegen keine Deal-Bewegungen vor. Angelegte, gewonnene und verlorene Deals erscheinen hier je Monat." />
    );
  }

  const series = [
    { key: "created", label: "Erstellt", color: seriesColor(0) },
    { key: "won", label: "Gewonnen", color: CHART_STATUS.good },
    { key: "lost", label: "Verloren", color: CHART_STATUS.critical },
  ];

  return (
    <div>
      <ChartFrame>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="month" tickFormatter={formatMonthLabel} {...AXIS_PROPS} />
            <YAxis allowDecimals={false} {...AXIS_PROPS} width={32} />
            <Tooltip
              cursor={{ fill: "rgba(37,99,235,0.06)" }}
              content={({ active, payload, label }) => {
                const row = payload?.[0]?.payload as MonthlyDeals | undefined;
                if (!active || !row) return null;
                return (
                  <ChartTooltip
                    title={formatMonthLabel(String(label))}
                    rows={[
                      ...series.map((item) => ({
                        label: item.label,
                        value: formatNumber(row[item.key as "created" | "won" | "lost"]),
                        color: item.color,
                      })),
                      { label: "Gewonnener Wert", value: formatCurrency(row.wonValue, currency) },
                    ]}
                  />
                );
              }}
            />
            {series.map((item) => (
              <Bar key={item.key} dataKey={item.key} fill={item.color} radius={[4, 4, 0, 0]} maxBarSize={18} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartLegend items={series.map((item) => ({ label: item.label, color: item.color }))} />
    </div>
  );
}

type ForecastMonth = { month: string; total: number; weighted: number; count: number };

/** Forecast: open pipeline per expected close month, plus the weighted value. */
export function ForecastChart({ data, currency }: { data: ForecastMonth[]; currency: string }) {
  if (data.length === 0) {
    return (
      <ChartEmpty message="Keine offenen Deals mit erwartetem Abschlussdatum. Sobald Deals ein Abschlussdatum haben, entsteht hier der Forecast." />
    );
  }

  const series = [
    { key: "total", label: "Pipeline-Wert", color: seriesColor(0) },
    { key: "weighted", label: "Gewichtet", color: seriesColor(1) },
  ];

  return (
    <div>
      <ChartFrame>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="month" tickFormatter={formatMonthLabel} {...AXIS_PROPS} />
            <YAxis
              {...AXIS_PROPS}
              width={56}
              tickFormatter={(value: number) => new Intl.NumberFormat("de-DE", { notation: "compact" }).format(value)}
            />
            <Tooltip
              cursor={{ stroke: "#9AA3B2", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) => {
                const row = payload?.[0]?.payload as ForecastMonth | undefined;
                if (!active || !row) return null;
                return (
                  <ChartTooltip
                    title={formatMonthLabel(String(label))}
                    rows={[
                      { label: "Pipeline-Wert", value: formatCurrency(row.total, currency), color: series[0].color },
                      { label: "Gewichtet", value: formatCurrency(row.weighted, currency), color: series[1].color },
                      { label: "Deals", value: formatNumber(row.count) },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="total" fill={series[0].color} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line
              type="monotone"
              dataKey="weighted"
              stroke={series[1].color}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 0, fill: series[1].color }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartLegend items={series.map((item) => ({ label: item.label, color: item.color }))} />
    </div>
  );
}

type SourceRow = { source: string; count: number; amount?: number };

/** Lead and deal sources — identity comparison, one series, sorted by size. */
export function SourceChart({ data, label }: { data: SourceRow[]; label: string }) {
  if (data.length === 0) {
    return (
      <ChartEmpty
        height={200}
        message={`Noch keine Quellen erfasst. Sobald ${label} eine Quelle haben, erscheint hier die Verteilung.`}
      />
    );
  }

  const sorted = [...data].sort((a, b) => b.count - a.count).slice(0, 8);

  return (
    <ChartFrame height={Math.max(180, sorted.length * 36)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }}>
          <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
          <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
          <YAxis type="category" dataKey="source" width={128} {...AXIS_PROPS} />
          <Tooltip
            cursor={{ fill: "rgba(37,99,235,0.06)" }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as SourceRow | undefined;
              if (!active || !row) return null;
              return <ChartTooltip title={row.source} rows={[{ label, value: formatNumber(row.count) }]} />;
            }}
          />
          <Bar
            dataKey="count"
            fill={seriesColor(0)}
            radius={[0, 4, 4, 0]}
            barSize={16}
            label={{ position: "right", fontSize: 11, fill: "#6B7484" }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Activity mix by type. Single series with visible value labels. */
export function ActivityMixChart({ data }: { data: { type: string; count: number }[] }) {
  const labels: Record<string, string> = {
    CALL: "Anrufe",
    EMAIL: "E-Mails",
    MEETING: "Meetings",
    NOTE: "Notizen",
    TASK: "Aufgaben",
    SYSTEM: "System",
  };
  const rows = data
    .filter((row) => row.type !== "SYSTEM")
    .map((row) => ({ ...row, label: labels[row.type] ?? row.type }));

  if (rows.length === 0 || rows.every((row) => row.count === 0)) {
    return <ChartEmpty height={200} message="Noch keine protokollierten Aktivitäten im gewählten Zeitraum." />;
  }

  return (
    <ChartFrame height={200}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 16, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis allowDecimals={false} width={32} {...AXIS_PROPS} />
          <Tooltip
            cursor={{ fill: "rgba(37,99,235,0.06)" }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as { label: string; count: number } | undefined;
              if (!active || !row) return null;
              return <ChartTooltip title={row.label} rows={[{ label: "Aktivitäten", value: formatNumber(row.count) }]} />;
            }}
          />
          <Bar
            dataKey="count"
            fill={seriesColor(0)}
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            label={{ position: "top", fontSize: 11, fill: "#6B7484" }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

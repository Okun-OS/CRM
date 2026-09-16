/**
 * Chart parameters.
 *
 * The categorical order is fixed and validated for colour-vision deficiency
 * (worst adjacent ΔE 9.1 protan / 22.9 normal on a light surface). Slot 1 is the
 * OKUN brand blue, which carries the brand in every single-series chart; the
 * other hues exist so that a reader with deuteranopia or protanopia can still
 * separate the series. A blue-and-cyan-only palette does not pass that test,
 * which is why the brand cyan is reserved for accents in the UI rather than for
 * adjacent data series.
 *
 * Series colours never carry meaning alone: every chart ships a legend or direct
 * labels, and the two lower-contrast slots always have visible value labels.
 */
export const CHART_CATEGORICAL = ["#2563EB", "#EB6834", "#1BAF7A", "#EDA100"] as const;

/** Ordinal blue ramp for ordered stages (pipeline funnel). Light-surface safe. */
export const CHART_ORDINAL_BLUE = [
  "#86B6EF",
  "#5598E7",
  "#3987E5",
  "#2A78D6",
  "#256ABF",
  "#1C5CAB",
  "#184F95",
  "#104281",
] as const;

/** Reserved state colours — never used as a series colour. */
export const CHART_STATUS = {
  good: "#0CA30C",
  warning: "#FAB219",
  serious: "#EC835A",
  critical: "#D03B3B",
} as const;

export const CHART_INK = {
  text: "#374151",
  muted: "#6B7484",
  grid: "#E5E7EB",
  surface: "#FFFFFF",
} as const;

/** Picks an ordinal colour for position `index` out of `count` steps. */
export function ordinalColor(index: number, count: number): string {
  if (count <= 1) return CHART_ORDINAL_BLUE[3];
  const position = Math.round((index / (count - 1)) * (CHART_ORDINAL_BLUE.length - 1));
  return CHART_ORDINAL_BLUE[Math.min(position, CHART_ORDINAL_BLUE.length - 1)];
}

export function seriesColor(index: number): string {
  return CHART_CATEGORICAL[index % CHART_CATEGORICAL.length];
}

/** "2026-03" → "Mär 26" for compact month axes. */
export function formatMonthLabel(month: string): string {
  const [year, monthPart] = month.split("-");
  const date = new Date(Number(year), Number(monthPart) - 1, 1);
  return new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit" }).format(date);
}

export const AXIS_PROPS = {
  stroke: CHART_INK.grid,
  tick: { fill: CHART_INK.muted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHART_INK.grid },
} as const;

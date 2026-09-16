/**
 * Brand configuration.
 *
 * Product identity lives here rather than in components, which keeps the
 * white-label path open: an organization's `brandConfig` can override these
 * values without touching the UI. OKUN CRM by OKUN Software is the default and
 * the primary brand.
 */
export const BRAND = {
  productName: "OKUN CRM",
  vendorName: "OKUN Software",
  tagline: "Kunden. Beziehungen. Wachstum.",
  claim: "Mehr als Kontakte. Echte Möglichkeiten.",
  poweredBy: "Powered by OKUN Software",
  /**
   * Generated from `src/components/brand/marks.tsx` via `pnpm brand:build`.
   * Replace these files with the final brand package when it is available.
   */
  assets: {
    icon: "/brand/okun-crm/icon.svg",
    iconDark: "/brand/okun-crm/icon-dark.svg",
    iconLight: "/brand/okun-crm/icon-light.svg",
    logoHorizontal: "/brand/okun-crm/logo-horizontal.svg",
    logoHorizontalInverse: "/brand/okun-crm/logo-horizontal-inverse.svg",
    logoVertical: "/brand/okun-crm/logo-vertical.svg",
    logoVerticalInverse: "/brand/okun-crm/logo-vertical-inverse.svg",
    vendorWordmark: "/brand/okun-software/wordmark.svg",
    vendorWordmarkInverse: "/brand/okun-software/wordmark-inverse.svg",
    poweredBy: "/brand/okun-software/powered-by.svg",
    poweredByInverse: "/brand/okun-software/powered-by-inverse.svg",
  },
  colors: {
    primaryDark: "#0D1117",
    dark: "#1A1F26",
    primaryBlue: "#2563EB",
    accentCyan: "#06B6D4",
    light: "#E5E7EB",
  },
  /**
   * Chart palette. Slot 1 is the OKUN brand blue; the remaining hues exist so
   * multi-series charts stay distinguishable for colour-blind readers — a
   * blue/cyan-only set fails that test. See src/lib/charts.ts.
   */
  chart: ["#2563EB", "#EB6834", "#1BAF7A", "#EDA100"],
} as const;

export type BrandConfig = typeof BRAND;

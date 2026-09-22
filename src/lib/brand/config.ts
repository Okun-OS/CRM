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
   * Die Originaldateien aus dem Markenpaket von OKUN Software. Die
   * Icon-Größen entstehen durch Verkleinern des Originals, die `-plain`-
   * Fassungen durch Freistellen des eingebrannten Claims (`pnpm brand:build`)
   * — nicht durch Nachzeichnen.
   */
  assets: {
    icon: "/brand/okun-crm/icon-192.png",
    iconLarge: "/brand/okun-crm/icon-512.png",
    iconApple: "/brand/okun-crm/icon-180.png",
    iconSmall: "/brand/okun-crm/icon-32.png",
    logoHorizontalInverse: "/brand/okun-crm/logo-horizontal-inverse-plain.png",
    logoHorizontalInverseWithClaim: "/brand/okun-crm/logo-horizontal-inverse.png",
    logoOnBlack: "/brand/okun-crm/logo-on-black.png",
    vendorIcon: "/brand/okun-software/icon.png",
    vendorLogo: "/brand/okun-software/logo-cutout-plain.png",
    vendorLogoInverse: "/brand/okun-software/logo-inverse-plain.png",
    vendorLogoOnWhite: "/brand/okun-software/logo-plain.png",
    vendorLogoWithClaim: "/brand/okun-software/logo-cutout.png",
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

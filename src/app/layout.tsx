import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/ui/toast";
import { BRAND } from "@/lib/brand/config";
import "./globals.css";

/**
 * Inter, self-hosted.
 *
 * Deliberately not `next/font/google`: that fetches the font while building,
 * which makes every build depend on reaching fonts.googleapis.com. A build
 * container without that route fails — and does so with a misleading error,
 * because the fetch breaks while a page is being rendered. The two variable
 * subsets below cover German and the rest of Western/Central Europe.
 *
 * Inter is licensed under the SIL Open Font License 1.1 (see fonts/OFL.txt).
 */
const inter = localFont({
  src: [
    { path: "./fonts/inter-latin.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/inter-latin-ext.woff2", weight: "100 900", style: "normal" },
  ],
  display: "swap",
  variable: "--font-inter",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.productName} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.productName}`,
  },
  description: `${BRAND.productName} verbindet Menschen, Prozesse und Chancen in einer Plattform. ${BRAND.poweredBy}.`,
  applicationName: BRAND.productName,
  icons: { icon: BRAND.assets.icon },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: BRAND.colors.primaryDark,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={inter.variable}>
      <body className="min-h-dvh antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

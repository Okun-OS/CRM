import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { BRAND } from "@/lib/brand/config";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
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

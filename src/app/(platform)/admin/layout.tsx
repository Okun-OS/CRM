import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPlatformActor } from "@/lib/auth/session";
import { OkunWordmark, PoweredByOkunSoftware } from "@/components/brand/marks";

export const metadata: Metadata = { title: { default: "Betreiberverwaltung", template: "%s · Betreiberverwaltung" } };
export const dynamic = "force-dynamic";

/**
 * Der Betreiberbereich.
 *
 * Absichtlich eine eigene Hülle statt der CRM-Navigation: Wer hier arbeitet,
 * verwaltet Mandanten und sieht keine Kundendaten. Das soll man auch sehen —
 * dunkle Leiste, eigener Name, kein CRM-Menü.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const actor = await getPlatformActor();
  // Kein Hinweis darauf, dass es diesen Bereich gibt: Wer nicht hierher
  // gehört, landet auf der Anmeldung wie bei jeder unbekannten Adresse.
  if (!actor) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <header className="okun-surface-dark border-b border-white/10 text-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex items-center gap-2.5">
              <OkunWordmark className="h-4 w-auto text-white" title="OKUN Software" />
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-2xs font-medium tracking-wide text-white/80">
                Betreiberverwaltung
              </span>
            </Link>
            <nav className="ml-4 hidden items-center gap-1 sm:flex">
              <Link href="/admin" className="rounded-md px-2.5 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white">
                Kunden
              </Link>
              <Link href="/admin/audit" className="rounded-md px-2.5 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white">
                Protokoll
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3 text-2xs text-white/50">
            <span className="hidden sm:inline">{actor.email}</span>
            <Link href="/dashboard" className="rounded-md border border-white/15 px-2.5 py-1.5 text-white/80 transition-colors hover:bg-white/5">
              Zum CRM
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <p className="inline-flex items-center gap-1.5 text-2xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-ink-400" />
            Dieser Bereich zeigt Kennzahlen und Verwaltungsdaten — keine Inhalte der Kundenmandanten.
          </p>
          <PoweredByOkunSoftware />
        </div>
      </footer>
    </div>
  );
}

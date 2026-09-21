import Link from "next/link";
import { OkunCrmLogo, PoweredByOkunSoftware } from "@/components/brand/marks";

export const metadata = { title: "Seite nicht gefunden" };

/**
 * The 404 page.
 *
 * Its absence is why Next fell back to the Pages Router error page during the
 * build; more importantly, a mistyped link used to land on an unbranded
 * default. It says what happened and offers the way back, like every other
 * empty state in the product.
 */
export default function NotFound() {
  return (
    <main className="okun-surface-dark flex min-h-dvh flex-col items-center justify-center px-6 text-center text-white">
      <OkunCrmLogo tone="inverse" className="h-12" />

      <p className="mt-10 text-5xl font-semibold tracking-tight tabular-nums text-white/25">404</p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Diese Seite gibt es nicht</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-white/60">
        Der Link ist veraltet, oder der Datensatz wurde gelöscht. Beides passiert — von hier kommen Sie zurück.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/heute"
          className="inline-flex h-9 items-center rounded-md bg-brand-500 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-600"
        >
          Zum Action Center
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex h-9 items-center rounded-md border border-white/15 px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white"
        >
          Zum Dashboard
        </Link>
      </div>

      <div className="mt-16">
        <PoweredByOkunSoftware tone="inverse" />
      </div>
    </main>
  );
}

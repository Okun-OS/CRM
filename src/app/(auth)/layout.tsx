import Link from "next/link";
import { OkunCrmLogo, PoweredByOkunSoftware } from "@/components/brand/marks";
import { BRAND } from "@/lib/brand/config";

/**
 * Authentication shell: the dark OKUN brand surface on the left, the form on
 * the right. This is the product's strongest brand moment.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="okun-surface-dark relative flex flex-col justify-between overflow-hidden px-8 py-10 text-white lg:w-[46%] lg:px-14 lg:py-14">
        <Link href="/" className="relative z-10 inline-flex">
          <OkunCrmLogo tone="inverse" className="h-12 lg:h-14" />
        </Link>

        <div className="relative z-10 my-12 max-w-lg lg:my-0">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight lg:text-[2.6rem]">
            Mehr als Kontakte.
            <br />
            <span className="okun-gradient-text">Echte Möglichkeiten.</span>
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-white/60 lg:text-base">
            {BRAND.productName} verbindet Menschen, Prozesse und Chancen in einer intelligenten Plattform –
            für nachhaltiges Wachstum.
          </p>
          <dl className="mt-10 grid grid-cols-2 gap-6 text-sm">
            {[
              ["Kundenzentriert", "Stärkere Beziehungen."],
              ["Effizienter", "Klare Prozesse."],
              ["Intelligenter", "Bessere Entscheidungen."],
              ["Sicherer", "Ihre Daten."],
            ].map(([title, description]) => (
              <div key={title}>
                <dt className="font-medium text-white/90">{title}</dt>
                <dd className="mt-0.5 text-xs text-white/50">{description}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative z-10 flex items-center justify-between gap-4">
          <p className="text-2xs uppercase tracking-[0.3em] text-white/40">{BRAND.tagline}</p>
          <PoweredByOkunSoftware tone="inverse" />
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center bg-white px-6 py-12 lg:px-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

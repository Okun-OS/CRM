import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Markenzeichen von OKUN CRM und OKUN Software.
 *
 * Hier wird **nichts nachgebaut**: Alle Zeichen sind die Originaldateien aus
 * dem Markenpaket. Die Komponenten legen nur fest, in welcher Größe und auf
 * welchem Untergrund welche Datei verwendet wird.
 *
 * | Datei | Hintergrund | Wortmarke | Einsatz |
 * | --- | --- | --- | --- |
 * | `okun-crm/icon.png` | transparent | – | überall |
 * | `okun-crm/logo-horizontal-inverse-plain.png` | transparent | hell | dunkle Flächen |
 * | `okun-crm/logo-horizontal-inverse.png` | transparent | hell | nur sehr groß |
 * | `okun-crm/logo-on-black.png` | schwarz | hell | nur auf Schwarz |
 * | `okun-software/logo-plain.png` | weiß | dunkel | helle Flächen |
 *
 * Die `-plain`-Dateien sind dieselben Originale ohne den eingebrannten Claim
 * (`pnpm brand:build` stellt ihn frei, siehe `scripts/build-brand-assets.ts`).
 * Der Claim ist rund 3 % der Bildhöhe hoch und wäre in jeder Größe, die in
 * einer Oberfläche vorkommt, nur noch ein grauer Streifen.
 *
 * Zwei Fassungen fehlen im Markenpaket und werden hier **nicht** ersatzweise
 * erfunden:
 *
 * - ein CRM-Logo mit dunkler Wortmarke für helle Flächen,
 * - ein Logo von OKUN Software für dunkle Flächen.
 *
 * Bis sie vorliegen, steht das jeweilige Original auf einer Platte in der
 * Gegenfarbe. Das ist sichtbar beabsichtigt — die Alternative wäre, fremde
 * Markenzeichen umzufärben.
 */
type MarkProps = {
  className?: string;
  title?: string;
};

/** Produktzeichen von OKUN CRM. Transparent, funktioniert hell wie dunkel. */
export function OkunCrmIcon({ className, title = "OKUN CRM" }: MarkProps) {
  return (
    <Image
      src="/brand/okun-crm/icon.png"
      alt={title}
      width={512}
      height={512}
      priority
      className={cn("h-9 w-9 object-contain", className)}
    />
  );
}

/**
 * Einfarbige Variante. Das Original ist ein Verlauf und lässt sich nicht
 * einfärben — hier steht dasselbe Zeichen, nur reduziert in der Deckkraft.
 */
export function OkunCrmIconMono({ className, title = "OKUN CRM" }: MarkProps) {
  return <OkunCrmIcon className={cn("opacity-70", className)} title={title} />;
}

/** Logo von OKUN Software, Original ohne Claim. Weißer Grund, dunkle Schrift. */
export function OkunWordmark({ className, title = "OKUN Software" }: MarkProps) {
  return (
    <Image
      src="/brand/okun-software/logo-plain.png"
      alt={title}
      width={1417}
      height={478}
      className={cn("h-7 w-auto object-contain", className)}
    />
  );
}

/** Produktschriftzug „CRM" — Teil des Logos, nicht einzeln im Markenpaket. */
export function CrmWordmark({ className, title = "CRM" }: MarkProps) {
  return (
    <span className={cn("text-2xs font-semibold uppercase tracking-[0.35em]", className)} aria-label={title}>
      CRM
    </span>
  );
}

/**
 * Endorsement „Powered by OKUN Software".
 *
 * `tone="inverse"` steht auf dunklen Flächen: Dort liegt das Originallogo auf
 * einer hellen Platte, weil es keine helle Fassung gibt. Die Größe ist so
 * gewählt, dass „OKUN SOFTWARE" lesbar bleibt — kleiner wäre das Zeichen nur
 * noch Dekoration.
 */
export function PoweredByOkunSoftware({
  className,
  tone = "muted",
}: {
  className?: string;
  tone?: "muted" | "inverse";
}) {
  const label = tone === "inverse" ? "text-white/55" : "text-[color:var(--text-muted)]";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={cn("shrink-0 text-2xs font-medium tracking-wide", label)}>Powered by</span>
      <span className={cn("inline-flex items-center", tone === "inverse" ? "rounded-md bg-white px-2 py-1.5" : "")}>
        <OkunWordmark className={tone === "inverse" ? "h-6" : "h-7"} />
      </span>
    </div>
  );
}

/**
 * Vollständiges Produktlogo.
 *
 * Eine vertikale Fassung gibt es im Markenpaket nicht und wird hier nicht
 * konstruiert; `compact` zeigt deshalb das Bildzeichen allein.
 */
export function OkunCrmLogo({
  className,
  variant = "horizontal",
  tone = "inverse",
}: {
  className?: string;
  variant?: "horizontal" | "compact";
  tone?: "default" | "inverse";
}) {
  if (variant === "compact") {
    return <OkunCrmIcon className={className} />;
  }

  const logo = (
    <Image
      src="/brand/okun-crm/logo-horizontal-inverse-plain.png"
      alt="OKUN CRM"
      width={1524}
      height={437}
      priority
      className={cn("h-10 w-auto object-contain", tone === "inverse" && className)}
    />
  );

  if (tone === "inverse") return logo;

  // Auf hellen Flächen fehlt eine Datei mit dunkler Wortmarke. Statt das
  // Zeichen umzufärben, steht das Original auf einer dunklen Platte.
  return (
    <span className={cn("inline-flex items-center rounded-lg bg-[color:var(--color-okun-950)] px-3 py-2", className)}>
      {logo}
    </span>
  );
}

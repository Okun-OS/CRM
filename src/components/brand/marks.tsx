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
 * | `okun-software/logo-cutout-plain.png` | transparent | dunkel | helle Flächen |
 * | `okun-software/logo-inverse-plain.png` | transparent | hell | dunkle Flächen |
 * | `okun-software/logo-plain.png` | weiß | dunkel | Ersatz mit weißem Grund |
 *
 * Die `-plain`-Dateien sind dieselben Originale ohne den eingebrannten Claim
 * (`pnpm brand:build` stellt ihn frei, siehe `scripts/build-brand-assets.ts`).
 * Der Claim ist rund 3 % der Bildhöhe hoch und wäre in jeder Größe, die in
 * einer Oberfläche vorkommt, nur noch ein grauer Streifen.
 *
 * Von OKUN Software liegen beide Fassungen vor — dunkle Tinte für helle
 * Flächen, helle Tinte für dunkle. Das Endorsement steht deshalb überall frei,
 * ohne Platte darunter.
 *
 * Eine Fassung fehlt weiterhin und wird hier **nicht** ersatzweise erfunden:
 * ein CRM-Logo mit dunkler Wortmarke für helle Flächen. Bis es vorliegt, steht
 * das Original dort auf einer dunklen Platte — sichtbar beabsichtigt, statt
 * ein fremdes Markenzeichen umzufärben.
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

/**
 * Logo von OKUN Software — die freigestellte Originaldatei ohne Claim.
 *
 * Transparent, aber mit dunkler Wortmarke: gehört auf helle Flächen.
 */
export function OkunWordmark({ className, title = "OKUN Software" }: MarkProps) {
  return (
    <Image
      src="/brand/okun-software/logo-cutout-plain.png"
      alt={title}
      width={1524}
      height={523}
      className={cn("h-7 w-auto object-contain", className)}
    />
  );
}

/**
 * Logo von OKUN Software für dunkle Flächen — Originaldatei ohne Claim, helle
 * Wortmarke auf transparentem Grund.
 */
export function OkunWordmarkInverse({ className, title = "OKUN Software" }: MarkProps) {
  return (
    <Image
      src="/brand/okun-software/logo-inverse-plain.png"
      alt={title}
      width={1579}
      height={574}
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
 * Beide Untergründe haben ihre eigene Originaldatei, deshalb steht das Zeichen
 * überall frei — keine Platte, kein Rahmen. Die Größe ist so gewählt, dass
 * „OKUN SOFTWARE" lesbar bleibt; kleiner wäre das Zeichen nur Dekoration.
 */
export function PoweredByOkunSoftware({
  className,
  tone = "muted",
}: {
  className?: string;
  tone?: "muted" | "inverse";
}) {
  const inverse = tone === "inverse";
  const label = inverse ? "text-white/55" : "text-[color:var(--text-muted)]";
  const Wordmark = inverse ? OkunWordmarkInverse : OkunWordmark;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={cn("shrink-0 text-2xs font-medium tracking-wide", label)}>Powered by</span>
      <Wordmark className="h-7" />
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

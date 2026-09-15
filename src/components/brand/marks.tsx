/**
 * OKUN brand marks.
 *
 * INTERIM ASSETS — these vector marks are reconstructed from the OKUN CRM brand
 * reference sheet so the product ships fully branded. When the final vector
 * files from the brand package are available, drop them into
 * `public/brand/okun-crm/` and `public/brand/okun-software/` and point
 * `src/lib/brand/config.ts` at them; no component outside this file draws a logo.
 *
 * Geometry lives here once and is reused by `scripts/build-brand-assets.ts`,
 * which renders the static SVG files used for favicons, e-mail and OG images.
 */
import * as React from "react";

type MarkProps = {
  className?: string;
  /** Unique id prefix — required so gradient ids never collide on one page. */
  idPrefix?: string;
  title?: string;
};

function useMarkId(prefix?: string) {
  const reactId = React.useId();
  return (prefix ?? `okun${reactId}`).replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Blue→cyan brand gradient used by the coloured marks. */
function BrandGradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#06B6D4" />
        <stop offset="55%" stopColor="#2563EB" />
        <stop offset="100%" stopColor="#1D4FD8" />
      </linearGradient>
    </defs>
  );
}

/**
 * OKUN CRM product icon: a person (the customer) held by an open ring (the
 * relationship) with ascending bars breaking out of it (growth).
 */
export function OkunCrmIcon({ className, idPrefix, title = "OKUN CRM" }: MarkProps) {
  const id = useMarkId(idPrefix);
  const gradientId = `${id}-grad`;
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title} fill="none">
      <BrandGradient id={gradientId} />
      {/* Open ring — the gap sits at the upper right, where growth breaks out. */}
      <circle
        cx="32"
        cy="32"
        r="24.5"
        stroke={`url(#${gradientId})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="116 38"
        transform="rotate(-4 32 32)"
      />
      {/* Customer */}
      <circle cx="23.5" cy="23" r="6.5" fill={`url(#${gradientId})`} />
      <path
        d="M14 44.5c0-5.25 4.25-9.5 9.5-9.5s9.5 4.25 9.5 9.5v.5a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2z"
        fill={`url(#${gradientId})`}
      />
      {/* Growth */}
      <rect x="36" y="36.5" width="5" height="10.5" rx="2" fill={`url(#${gradientId})`} />
      <rect x="43.5" y="29.5" width="5" height="17.5" rx="2" fill={`url(#${gradientId})`} />
      <rect x="51" y="21" width="5" height="26" rx="2" fill={`url(#${gradientId})`} />
    </svg>
  );
}

/** Single-colour variant for dense UI, favicons and monochrome contexts. */
export function OkunCrmIconMono({ className, title = "OKUN CRM" }: MarkProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title} fill="none">
      <circle
        cx="32"
        cy="32"
        r="24.5"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="116 38"
        transform="rotate(-4 32 32)"
      />
      <circle cx="23.5" cy="23" r="6.5" fill="currentColor" />
      <path
        d="M14 44.5c0-5.25 4.25-9.5 9.5-9.5s9.5 4.25 9.5 9.5v.5a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2z"
        fill="currentColor"
      />
      <rect x="36" y="36.5" width="5" height="10.5" rx="2" fill="currentColor" />
      <rect x="43.5" y="29.5" width="5" height="17.5" rx="2" fill="currentColor" />
      <rect x="51" y="21" width="5" height="26" rx="2" fill="currentColor" />
    </svg>
  );
}

/**
 * The OKUN wordmark. The small dot at the upper right of the "O" is part of the
 * brand identity and must never be dropped.
 */
export function OkunWordmark({ className, title = "OKUN" }: MarkProps) {
  return (
    <svg viewBox="0 0 168 48" className={className} role="img" aria-label={title} fill="none">
      <g stroke="currentColor" strokeWidth="6.5" strokeLinecap="square" fill="none">
        {/* O */}
        <circle cx="21.5" cy="26" r="14.5" />
        {/* K */}
        <path d="M52 8.5v35M52 26.5 71.5 8.5M52 25.5 72.5 43.5" />
        {/* U */}
        <path d="M84 8.5v20.5a11.5 11.5 0 0 0 23 0V8.5" />
        {/* N */}
        <path d="M120 43.5v-35l24.5 35v-35" />
      </g>
      {/* Identity dot — upper right of the O. */}
      <circle cx="36.5" cy="8.5" r="4.2" fill="currentColor" />
    </svg>
  );
}

/** "CRM" product lockup type — wide tracking, drawn to match the wordmark. */
export function CrmWordmark({ className, title = "CRM" }: MarkProps) {
  return (
    <svg viewBox="0 0 150 40" className={className} role="img" aria-label={title} fill="none">
      <g stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* C */}
        <path d="M33 11.5a13.5 13.5 0 1 0 0 17" />
        {/* R */}
        <path d="M60 36V6h11a8.5 8.5 0 0 1 0 17H60M70.5 23 82 36" />
        {/* M */}
        <path d="M100 36V6l12.5 18L125 6v30" />
      </g>
    </svg>
  );
}

/** "Powered by OKUN Software" endorsement, used in brand moments. */
export function PoweredByOkunSoftware({
  className,
  tone = "muted",
}: {
  className?: string;
  tone?: "muted" | "inverse";
}) {
  const label = tone === "inverse" ? "text-white/55" : "text-[color:var(--text-muted)]";
  const mark = tone === "inverse" ? "text-white/80" : "text-[color:var(--color-okun-850)]";
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <span className={`text-2xs font-medium tracking-wide ${label}`}>Powered by</span>
      <span className={`flex items-baseline gap-1.5 ${mark}`}>
        <OkunWordmark className="h-3 w-auto" title="OKUN Software" />
        <span className="text-2xs font-semibold tracking-[0.28em] uppercase opacity-70">Software</span>
      </span>
    </div>
  );
}

/** Full product lockup used in the sidebar, login and brand surfaces. */
export function OkunCrmLogo({
  className,
  variant = "horizontal",
  tone = "default",
}: {
  className?: string;
  variant?: "horizontal" | "vertical" | "compact";
  tone?: "default" | "inverse";
}) {
  const wordTone = tone === "inverse" ? "text-white" : "text-[color:var(--color-okun-950)]";
  const crmTone = tone === "inverse" ? "text-accent-400" : "text-brand-500";

  if (variant === "compact") {
    return <OkunCrmIcon className={className} />;
  }

  if (variant === "vertical") {
    return (
      <div className={`flex flex-col items-center gap-3 ${className ?? ""}`}>
        <OkunCrmIcon className="h-14 w-14" />
        <div className="flex flex-col items-center gap-1">
          <OkunWordmark className={`h-6 w-auto ${wordTone}`} title="OKUN CRM" />
          <CrmWordmark className={`h-3 w-auto ${crmTone}`} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <OkunCrmIcon className="h-9 w-9 shrink-0" />
      <div className="flex flex-col justify-center gap-0.5">
        <OkunWordmark className={`h-[18px] w-auto ${wordTone}`} title="OKUN CRM" />
        <CrmWordmark className={`h-[9px] w-auto ${crmTone}`} />
      </div>
    </div>
  );
}

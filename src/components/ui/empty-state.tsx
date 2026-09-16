import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Empty states always say what the area is for and offer the next action —
 * never just "no data". They never fabricate sample records.
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-xs leading-relaxed text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

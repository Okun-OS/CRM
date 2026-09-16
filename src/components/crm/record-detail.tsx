import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * Detail page frame used by contacts, companies, leads and deals.
 *
 * Left: the record's own properties. Centre: the timeline and everything that
 * happened. Right: relationships and quick actions. The same structure across
 * all four objects is what makes the product learnable.
 */
export function RecordDetailLayout({
  header,
  left,
  center,
  right,
}: {
  header: React.ReactNode;
  left: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      {header}
      <div className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)_19rem]">
        <div className="space-y-4">{left}</div>
        <div className="min-w-0 space-y-4">{center}</div>
        {right ? <div className="space-y-4">{right}</div> : null}
      </div>
    </div>
  );
}

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Brotkrumen" className="flex items-center gap-1 text-xs text-ink-500">
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 ? <ChevronRight className="h-3 w-3 text-ink-300" /> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-brand-600">
              {item.label}
            </Link>
          ) : (
            <span className="text-ink-700">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

/** Read-only property list used in the left column of every detail page. */
export function PropertyList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-ink-100", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-2xs uppercase tracking-wide text-ink-400">{item.label}</dt>
          <dd className="min-w-0 break-words text-right text-xs text-ink-800">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RelatedList({
  items,
  emptyMessage,
}: {
  items: { id: string; href: string; title: string; subtitle?: string | null; meta?: string | null }[];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <p className="rounded-md bg-ink-50 px-3 py-4 text-center text-xs text-ink-500">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={item.href} className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-ink-50">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-ink-800">{item.title}</span>
              {item.subtitle ? <span className="block truncate text-2xs text-ink-500">{item.subtitle}</span> : null}
            </span>
            {item.meta ? <span className="shrink-0 text-2xs tabular-nums text-ink-500">{item.meta}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex items-center justify-between gap-3 border-b border-ink-200/70 px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

/** Data table shell shared by every CRM list view. */
export function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[720px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  sortable,
  sorted,
  onSort,
  className,
  align = "left",
}: {
  children: React.ReactNode;
  sortable?: boolean;
  sorted?: "asc" | "desc" | null;
  onSort?: () => void;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-10 border-b border-ink-200 bg-ink-50/80 px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-ink-500 backdrop-blur",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className="inline-flex items-center gap-1 transition-colors hover:text-ink-800"
        >
          {children}
          {sorted === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : sorted === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-40" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      className={cn(
        "border-b border-ink-100 px-4 py-2.5 text-ink-700",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn("group transition-colors", onClick && "cursor-pointer hover:bg-brand-50/40", className)}
    >
      {children}
    </tr>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 px-4 py-2.5 text-xs text-ink-500">
      <span>
        {first.toLocaleString("de-DE")}–{last.toLocaleString("de-DE")} von {total.toLocaleString("de-DE")}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-7 rounded border border-ink-200 bg-white px-1.5 text-xs text-ink-600"
            aria-label="Zeilen pro Seite"
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} / Seite
              </option>
            ))}
          </select>
        ) : null}
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Vorherige Seite">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Nächste Seite"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { formatCurrency, formatDate, formatNumber, formatRelative } from "@/lib/format";

/**
 * Cell renderers shared by the list views. Keeping them here means a company
 * link, an owner or a currency looks the same in every table.
 */
export function EmptyCell() {
  return <span className="text-ink-400">—</span>;
}

export function TextCell({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <EmptyCell />;
  return <span className="truncate">{String(value)}</span>;
}

export function LinkCell({ href, label, strong }: { href: string; label: string; strong?: boolean }) {
  return (
    <Link
      href={href}
      onClick={(event) => event.stopPropagation()}
      className={strong ? "font-medium text-ink-900 hover:text-brand-600" : "text-ink-700 hover:text-brand-600"}
    >
      {label}
    </Link>
  );
}

export function OwnerCell({ owner }: { owner: { id: string; name: string } | null | undefined }) {
  if (!owner) return <EmptyCell />;
  return (
    <span className="flex items-center gap-2">
      <Avatar name={owner.name} size="xs" />
      <span className="truncate text-xs">{owner.name}</span>
    </span>
  );
}

export function DateCell({ value, relative }: { value: unknown; relative?: boolean }) {
  if (!value) return <EmptyCell />;
  const text = relative ? formatRelative(String(value)) : formatDate(String(value));
  return <span className="whitespace-nowrap text-xs text-ink-600">{text}</span>;
}

export function CurrencyCell({ value, currency }: { value: unknown; currency: string }) {
  if (value === null || value === undefined) return <EmptyCell />;
  return <span className="whitespace-nowrap tabular-nums">{formatCurrency(Number(value), currency)}</span>;
}

export function NumberCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <EmptyCell />;
  return <span className="tabular-nums">{formatNumber(Number(value))}</span>;
}

export function OptionBadge({
  value,
  options,
  tone = "neutral",
}: {
  value: unknown;
  options: { key: string; label: string }[];
  tone?: BadgeTone;
}) {
  if (!value) return <EmptyCell />;
  const label = options.find((option) => option.key === value)?.label ?? String(value);
  return <Badge tone={tone}>{label}</Badge>;
}

const DEAL_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Offen", tone: "brand" },
  WON: { label: "Gewonnen", tone: "success" },
  LOST: { label: "Verloren", tone: "danger" },
};

export function DealStatusBadge({ status }: { status: string }) {
  const meta = DEAL_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function StageBadge({ stage }: { stage: { name: string; type: string } | null | undefined }) {
  if (!stage) return <EmptyCell />;
  const tone: BadgeTone = stage.type === "WON" ? "success" : stage.type === "LOST" ? "danger" : "brand";
  return <Badge tone={tone}>{stage.name}</Badge>;
}

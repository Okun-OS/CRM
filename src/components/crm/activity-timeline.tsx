"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, Mail, MessageSquare, Phone, Settings2, Target, Users, CalendarDays, ListChecks } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { ActivityDTO } from "@/server/services/activities";

/**
 * The CRM timeline. One chronological stream per record, mixing what people did
 * (calls, e-mails, meetings, notes) with what the system did (record created,
 * stage changed, workflow actions) so history is never split across tabs.
 */
const ICONS: Record<string, React.ReactNode> = {
  CALL: <Phone className="h-3.5 w-3.5" />,
  EMAIL: <Mail className="h-3.5 w-3.5" />,
  MEETING: <CalendarDays className="h-3.5 w-3.5" />,
  NOTE: <MessageSquare className="h-3.5 w-3.5" />,
  TASK: <ListChecks className="h-3.5 w-3.5" />,
  SYSTEM: <Settings2 className="h-3.5 w-3.5" />,
};

const TONES: Record<string, string> = {
  CALL: "bg-brand-50 text-brand-600",
  EMAIL: "bg-accent-50 text-accent-700",
  MEETING: "bg-brand-50 text-brand-600",
  NOTE: "bg-ink-100 text-ink-600",
  TASK: "bg-warning-50 text-warning-700",
  SYSTEM: "bg-ink-100 text-ink-500",
};

export function ActivityTimeline({
  items,
  compact,
  emptyMessage,
}: {
  items: ActivityDTO[];
  compact?: boolean;
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-md bg-ink-50 px-4 py-6 text-center text-xs text-ink-500">
        {emptyMessage ?? "Noch keine Aktivitäten erfasst."}
      </p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
          {index < items.length - 1 ? (
            <span className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-ink-200" aria-hidden />
          ) : null}

          <span
            className={cn(
              "z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white",
              TONES[item.type] ?? TONES.SYSTEM,
            )}
          >
            {ICONS[item.type] ?? ICONS.SYSTEM}
          </span>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-xs font-medium text-ink-900">{item.subject ?? typeLabel(item.type)}</p>
              <time className="text-2xs text-ink-400" dateTime={item.occurredAt} title={formatDateTime(item.occurredAt)}>
                {formatRelative(item.occurredAt)}
              </time>
            </div>

            {item.body && !compact ? (
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-600">{item.body}</p>
            ) : null}

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-500">
              {item.actor ? <span>{item.actor.name}</span> : null}
              {item.outcome ? <span className="text-ink-600">Ergebnis: {item.outcome}</span> : null}
              {item.durationMinutes ? <span>{item.durationMinutes} Min.</span> : null}
              {item.contact ? (
                <Link href={`/contacts/${item.contact.id}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                  <Users className="h-3 w-3" />
                  {item.contact.name}
                </Link>
              ) : null}
              {item.company ? (
                <Link href={`/companies/${item.company.id}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                  <Building2 className="h-3 w-3" />
                  {item.company.name}
                </Link>
              ) : null}
              {item.deal ? (
                <Link href={`/deals/${item.deal.id}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                  <Target className="h-3 w-3" />
                  {item.deal.name}
                </Link>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    CALL: "Anruf",
    EMAIL: "E-Mail",
    MEETING: "Meeting",
    NOTE: "Notiz",
    TASK: "Aufgabe",
    SYSTEM: "Systemereignis",
  };
  return labels[type] ?? type;
}

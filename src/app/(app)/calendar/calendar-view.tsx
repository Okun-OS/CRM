"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/misc";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { MeetingForm } from "@/components/crm/forms/simple-forms";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";

type Meeting = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  location: string | null;
  meetingUrl: string | null;
  status: string;
  owner: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  attendees: { id: string; name: string | null; email: string | null; type: string }[];
};

type ViewMode = "day" | "week" | "month" | "list";

/** Day, week, month and list views over the organization's CRM meetings. */
export function CalendarView({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<ViewMode>("week");
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [meetings, setMeetings] = React.useState<Meeting[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<Meeting | null>(null);
  const [editing, setEditing] = React.useState<Meeting | null>(null);
  const [deleting, setDeleting] = React.useState<Meeting | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);
  const toast = useToast();

  async function removeMeeting() {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await api.delete(`/api/v1/meetings/${deleting.id}`);
      toast.success("Termin gelöscht.");
      setDeleting(null);
      setSelected(null);
      void load();
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Termin konnte nicht gelöscht werden.");
    } finally {
      setDeletePending(false);
    }
  }

  const range = React.useMemo(() => rangeFor(mode, anchor), [mode, anchor]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
      setMeetings(await api.get<Meeting[]>(`/api/v1/meetings?${params.toString()}`));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Termine konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function shift(direction: -1 | 1) {
    setAnchor((current) => {
      const next = new Date(current);
      if (mode === "day") next.setDate(next.getDate() + direction);
      else if (mode === "week") next.setDate(next.getDate() + direction * 7);
      else next.setMonth(next.getMonth() + direction);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Zurück">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Weiter">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(new Date())}>
            Heute
          </Button>
          <p className="ml-2 text-sm font-medium text-ink-800">{range.label}</p>
        </div>

        <div className="flex items-center gap-2">
          <Tabs
            className="border-none"
            active={mode}
            onChange={(key) => setMode(key as ViewMode)}
            tabs={[
              { key: "day", label: "Tag" },
              { key: "week", label: "Woche" },
              { key: "month", label: "Monat" },
              { key: "list", label: "Liste" },
            ]}
          />
          {canWrite ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Termin
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden">
        {loading && meetings.length === 0 ? (
          <div className="p-4">
            <SkeletonText lines={6} />
          </div>
        ) : error ? (
          <EmptyState title="Fehler beim Laden" description={error} actions={<Button onClick={() => void load()}>Erneut versuchen</Button>} />
        ) : meetings.length === 0 ? (
          <EmptyState
            title="Keine Termine in diesem Zeitraum"
            description="Plane einen Termin mit einem Kontakt oder zu einem Deal – er erscheint auch in der Timeline des Datensatzes."
            actions={
              canWrite ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                  Termin erstellen
                </Button>
              ) : null
            }
          />
        ) : mode === "month" ? (
          <MonthGrid anchor={anchor} meetings={meetings} onSelect={setSelected} />
        ) : mode === "list" || mode === "day" ? (
          <MeetingList meetings={meetings} onSelect={setSelected} />
        ) : (
          <WeekGrid from={range.from} meetings={meetings} onSelect={setSelected} />
        )}
      </Card>

      <Drawer open={creating} onClose={() => setCreating(false)} title="Termin erstellen">
        <MeetingForm
          onDone={() => {
            setCreating(false);
            void load();
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      </Drawer>

      <Drawer open={selected !== null} onClose={() => setSelected(null)} title={selected?.title ?? "Termin"}>
        {selected ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-400">Zeit</p>
              <p className="text-ink-800">{formatSpan(selected)}</p>
            </div>
            {selected.location ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-400">Ort</p>
                <p className="text-ink-800">{selected.location}</p>
              </div>
            ) : null}
            {selected.meetingUrl ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-400">Meeting-Link</p>
                <a href={selected.meetingUrl} target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:text-brand-700">
                  {selected.meetingUrl}
                </a>
              </div>
            ) : null}
            {selected.description ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-400">Notiz</p>
                <p className="whitespace-pre-wrap text-ink-700">{selected.description}</p>
              </div>
            ) : null}
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-400">Bezug</p>
              <ul className="mt-1 space-y-1 text-xs text-ink-700">
                {selected.contact ? <li>Kontakt: {selected.contact.name}</li> : null}
                {selected.company ? <li>Unternehmen: {selected.company.name}</li> : null}
                {selected.deal ? <li>Deal: {selected.deal.name}</li> : null}
                {selected.owner ? <li>Owner: {selected.owner.name}</li> : null}
              </ul>
            </div>
            {selected.attendees.length > 0 ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-400">Teilnehmer</p>
                <ul className="mt-1 space-y-0.5 text-xs text-ink-700">
                  {selected.attendees.map((attendee) => (
                    <li key={attendee.id}>{attendee.name ?? attendee.email}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canWrite ? (
              <div className="flex gap-2 border-t border-ink-200 pt-4">
                <Button
                  variant="secondary"
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setEditing(selected);
                    setSelected(null);
                  }}
                >
                  Bearbeiten
                </Button>
                <Button variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleting(selected)}>
                  Löschen
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer open={editing !== null} onClose={() => setEditing(null)} title="Termin bearbeiten">
        {editing ? (
          <MeetingForm
            key={editing.id}
            initial={{
              id: editing.id,
              title: editing.title,
              startAt: editing.startAt,
              endAt: editing.endAt,
              location: editing.location,
              meetingUrl: editing.meetingUrl,
              description: editing.description,
              ownerId: editing.owner?.id ?? null,
            }}
            onDone={() => {
              setEditing(null);
              void load();
              router.refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void removeMeeting()}
        loading={deletePending}
        title="Termin löschen?"
        description={deleting ? `„${deleting.title}“ am ${formatDate(deleting.startAt)} wird aus dem Kalender entfernt.` : ""}
      />
    </div>
  );
}

function rangeFor(mode: ViewMode, anchor: Date) {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);

  if (mode === "day") {
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end, label: formatDate(start) };
  }

  if (mode === "month") {
    const from = new Date(start.getFullYear(), start.getMonth(), 1);
    const to = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      from,
      to,
      label: new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(from),
    };
  }

  if (mode === "list") {
    const to = new Date(start);
    to.setDate(to.getDate() + 30);
    return { from: start, to, label: `${formatDate(start)} – ${formatDate(to)}` };
  }

  // Week starting Monday.
  const weekday = (start.getDay() + 6) % 7;
  const from = new Date(start);
  from.setDate(from.getDate() - weekday);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  to.setHours(23, 59, 59, 999);
  return { from, to, label: `${formatDate(from)} – ${formatDate(to)}` };
}

function MeetingList({ meetings, onSelect }: { meetings: Meeting[]; onSelect: (meeting: Meeting) => void }) {
  return (
    <ul className="divide-y divide-ink-100">
      {meetings.map((meeting) => (
        <li key={meeting.id}>
          <button
            type="button"
            onClick={() => onSelect(meeting)}
            className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50/60"
          >
            <span className="w-32 shrink-0 text-xs text-ink-500">
              {formatDate(meeting.startAt)}
              <span className="block text-2xs">
                {multiDay(meeting)
                  ? `${formatTime(meeting.startAt)} – ${formatDate(meeting.endAt)} ${formatTime(meeting.endAt)}`
                  : `${formatTime(meeting.startAt)} – ${formatTime(meeting.endAt)}`}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink-900">{meeting.title}</span>
              <span className="block truncate text-2xs text-ink-500">
                {[meeting.contact?.name, meeting.company?.name, meeting.location].filter(Boolean).join(" · ") || "Ohne Bezug"}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function WeekGrid({ from, meetings, onSelect }: { from: Date; meetings: Meeting[]; onSelect: (meeting: Meeting) => void }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(from);
    date.setDate(date.getDate() + index);
    return date;
  });

  return (
    <div className="grid grid-cols-1 divide-y divide-ink-100 sm:grid-cols-7 sm:divide-x sm:divide-y-0">
      {days.map((day) => {
        const dayMeetings = meetingsOn(meetings, day);
        const isToday = sameDay(day, new Date());
        return (
          <div key={day.toISOString()} className={cn("min-h-[10rem] p-2", isToday && "bg-brand-50/40")}>
            <p className={cn("mb-2 text-2xs font-semibold uppercase tracking-wide", isToday ? "text-brand-600" : "text-ink-400")}>
              {new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit" }).format(day)}
            </p>
            <ul className="space-y-1">
              {dayMeetings.map((meeting) => (
                <li key={meeting.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(meeting)}
                    className="w-full rounded-md border border-brand-200 bg-white px-2 py-1 text-left text-2xs transition-colors hover:border-brand-400"
                  >
                    <span className="block font-medium text-ink-800">{timeOnDay(meeting, day)}</span>
                    <span className="block truncate text-ink-600">{meeting.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid({ anchor, meetings, onSelect }: { anchor: Date; meetings: Meeting[]; onSelect: (meeting: Meeting) => void }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: offset + daysInMonth }, (_, index) =>
    index < offset ? null : new Date(anchor.getFullYear(), anchor.getMonth(), index - offset + 1),
  );

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-ink-200 bg-ink-50/60">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => (
          <div key={day} className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-500">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="min-h-[5.5rem] border-b border-r border-ink-100 bg-ink-50/30" />;
          const dayMeetings = meetingsOn(meetings, day);
          const isToday = sameDay(day, new Date());
          return (
            <div key={day.toISOString()} className={cn("min-h-[5.5rem] border-b border-r border-ink-100 p-1.5", isToday && "bg-brand-50/40")}>
              <p className={cn("text-2xs font-medium", isToday ? "text-brand-600" : "text-ink-500")}>{day.getDate()}</p>
              <ul className="mt-1 space-y-0.5">
                {dayMeetings.slice(0, 3).map((meeting) => (
                  <li key={meeting.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(meeting)}
                      className="w-full truncate rounded bg-brand-500/10 px-1 py-0.5 text-left text-2xs text-brand-700 hover:bg-brand-500/20"
                    >
                      {timeOnDay(meeting, day)} {meeting.title}
                    </button>
                  </li>
                ))}
                {dayMeetings.length > 3 ? (
                  <li className="px-1 text-2xs text-ink-400">+{dayMeetings.length - 3} weitere</li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function multiDay(meeting: Meeting) {
  return !sameDay(new Date(meeting.startAt), new Date(meeting.endAt));
}

/** Termine, die diesen Tag berühren — ein mehrtägiger Termin steht an jedem seiner Tage. */
function meetingsOn(meetings: Meeting[], day: Date) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = dayStart + 86_400_000;
  return meetings.filter((meeting) => {
    const start = new Date(meeting.startAt).getTime();
    const end = new Date(meeting.endAt).getTime();
    return start < dayEnd && (end > dayStart || start >= dayStart);
  });
}

/** „09:00“ am ersten Tag, „bis 11:30“ am letzten, „ganztägig“ dazwischen. */
function timeOnDay(meeting: Meeting, day: Date) {
  const start = new Date(meeting.startAt);
  const end = new Date(meeting.endAt);
  if (sameDay(start, day)) return formatTime(meeting.startAt);
  if (sameDay(end, day)) return `bis ${formatTime(meeting.endAt)}`;
  return "ganztägig";
}

function formatSpan(meeting: Meeting) {
  return multiDay(meeting)
    ? `${formatDateTime(meeting.startAt)} – ${formatDateTime(meeting.endAt)}`
    : `${formatDateTime(meeting.startAt)} – ${formatTime(meeting.endAt)}`;
}

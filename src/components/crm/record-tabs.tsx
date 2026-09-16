"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, FileUp, ListPlus, MessageSquarePlus, PhoneCall, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/misc";
import { Drawer, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ActivityTimeline } from "./activity-timeline";
import { ActivityForm, MeetingForm, NoteForm, TaskForm, type RecordLinks } from "./forms/simple-forms";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime, formatRelative, formatBytes } from "@/lib/format";
import type { ActivityDTO } from "@/server/services/activities";
import { cn } from "@/lib/cn";

/**
 * The engagement surface of a record: timeline, notes, tasks, meetings, e-mails
 * and files. Data is loaded per tab through the same REST API the rest of the
 * product uses.
 */
type TabKey = "timeline" | "notes" | "tasks" | "meetings" | "emails" | "files";

type Permissions = {
  canLogActivity: boolean;
  canWriteNotes: boolean;
  canWriteTasks: boolean;
  canWriteMeetings: boolean;
  canUploadFiles: boolean;
  canDeleteFiles: boolean;
};

export function RecordTabs({
  links,
  permissions,
  refreshKey,
}: {
  links: RecordLinks;
  permissions: Permissions;
  /**
   * Changes whenever the server re-renders the record (its `updatedAt`), so a
   * change made outside the tabs — a stage move, an inline edit — reloads the
   * timeline instead of showing stale data.
   */
  refreshKey?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<TabKey>("timeline");
  const [drawer, setDrawer] = React.useState<null | "activity" | "note" | "task" | "meeting">(null);
  const [localVersion, setLocalVersion] = React.useState(0);
  const version = `${refreshKey ?? ""}:${localVersion}`;

  const query = React.useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(links)) if (value) params.set(key, value);
    return params.toString();
  }, [links]);

  const refresh = () => {
    setDrawer(null);
    setLocalVersion((value) => value + 1);
    router.refresh();
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-1">
        <Tabs
          className="min-w-0 flex-1 border-none"
          active={tab}
          onChange={(key) => setTab(key as TabKey)}
          tabs={[
            { key: "timeline", label: "Aktivitäten" },
            { key: "notes", label: "Notizen" },
            { key: "tasks", label: "Aufgaben" },
            { key: "meetings", label: "Termine" },
            { key: "emails", label: "E-Mails" },
            { key: "files", label: "Dateien" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          {permissions.canLogActivity ? (
            <Button size="sm" variant="secondary" icon={<PhoneCall className="h-3.5 w-3.5" />} onClick={() => setDrawer("activity")}>
              Aktivität
            </Button>
          ) : null}
          {permissions.canWriteNotes ? (
            <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="h-3.5 w-3.5" />} onClick={() => setDrawer("note")}>
              Notiz
            </Button>
          ) : null}
          {permissions.canWriteTasks ? (
            <Button size="sm" variant="secondary" icon={<ListPlus className="h-3.5 w-3.5" />} onClick={() => setDrawer("task")}>
              Aufgabe
            </Button>
          ) : null}
          {permissions.canWriteMeetings ? (
            <Button size="sm" variant="secondary" icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => setDrawer("meeting")}>
              Termin
            </Button>
          ) : null}
        </div>
      </div>

      <div className="border-t border-ink-200 p-4">
        {tab === "timeline" ? <TimelineTab query={query} version={version} /> : null}
        {tab === "notes" ? <NotesTab query={query} links={links} version={version} canWrite={permissions.canWriteNotes} onChanged={refresh} /> : null}
        {tab === "tasks" ? <TasksTab query={query} version={version} onChanged={refresh} /> : null}
        {tab === "meetings" ? <MeetingsTab links={links} version={version} /> : null}
        {tab === "emails" ? <EmailsTab query={query} version={version} /> : null}
        {tab === "files" ? (
          <FilesTab
            query={query}
            links={links}
            version={version}
            canUpload={permissions.canUploadFiles}
            canDelete={permissions.canDeleteFiles}
            onChanged={refresh}
          />
        ) : null}
      </div>

      <Drawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={
          drawer === "activity"
            ? "Aktivität protokollieren"
            : drawer === "note"
              ? "Notiz hinzufügen"
              : drawer === "task"
                ? "Aufgabe erstellen"
                : "Termin erstellen"
        }
      >
        {drawer === "activity" ? <ActivityForm links={links} onDone={refresh} onCancel={() => setDrawer(null)} /> : null}
        {drawer === "note" ? <NoteForm links={links} onDone={refresh} onCancel={() => setDrawer(null)} /> : null}
        {drawer === "task" ? <TaskForm links={links} onDone={refresh} onCancel={() => setDrawer(null)} /> : null}
        {drawer === "meeting" ? <MeetingForm links={links} onDone={refresh} onCancel={() => setDrawer(null)} /> : null}
      </Drawer>
    </Card>
  );
}

function useResource<T>(path: string, version: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : "Daten konnten nicht geladen werden.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  return { data, loading, error };
}

function TabState({ loading, error, empty, children }: { loading: boolean; error: string | null; empty: boolean; children: React.ReactNode }) {
  if (loading) return <SkeletonText lines={4} />;
  if (error) return <p className="rounded-md border border-danger-500/20 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</p>;
  if (empty) return null;
  return <>{children}</>;
}

function TimelineTab({ query, version }: { query: string; version: string }) {
  const { data, loading, error } = useResource<{ items: ActivityDTO[] }>(`/api/v1/activities?${query}&pageSize=50`, version);
  return (
    <TabState loading={loading} error={error} empty={false}>
      <ActivityTimeline
        items={data?.items ?? []}
        emptyMessage="Noch keine Aktivitäten. Protokolliere einen Anruf, eine E-Mail oder ein Meeting, um die Historie aufzubauen."
      />
    </TabState>
  );
}

function NotesTab({
  query,
  links,
  version,
  canWrite,
  onChanged,
}: {
  query: string;
  links: RecordLinks;
  version: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  type Note = {
    id: string;
    body: string;
    author: { id: string; name: string } | null;
    createdAt: string;
    editedAt: string | null;
    revisions: { id: string; body: string; createdAt: string; editedBy: { name: string } | null }[];
  };
  const { data, loading, error } = useResource<{ items: Note[] }>(`/api/v1/notes?${query}&pageSize=50`, version);

  return (
    <div className="space-y-4">
      {canWrite ? <NoteForm links={links} onDone={onChanged} /> : null}
      <TabState loading={loading} error={error} empty={false}>
        {(data?.items ?? []).length === 0 ? (
          <p className="rounded-md bg-ink-50 px-4 py-6 text-center text-xs text-ink-500">
            Noch keine Notizen zu diesem Datensatz.
          </p>
        ) : (
          <ul className="space-y-3">
            {(data?.items ?? []).map((note) => (
              <li key={note.id} className="rounded-md border border-ink-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink-900">{note.author?.name ?? "Unbekannt"}</p>
                  <time className="text-2xs text-ink-400" dateTime={note.createdAt}>
                    {formatDateTime(note.createdAt)}
                  </time>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-700">{note.body}</p>
                {note.editedAt ? (
                  <p className="mt-2 text-2xs text-ink-400">
                    Bearbeitet {formatRelative(note.editedAt)} · {note.revisions.length} frühere Version(en) gespeichert
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </TabState>
    </div>
  );
}

function TasksTab({ query, version, onChanged }: { query: string; version: string; onChanged: () => void }) {
  type Task = {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: string | null;
    isOverdue: boolean;
    owner: { id: string; name: string } | null;
  };
  const { data, loading, error } = useResource<{ items: Task[] }>(`/api/v1/tasks?${query}&view=all&pageSize=50`, version);
  const toast = useToast();

  async function toggle(task: Task) {
    try {
      await api.patch(`/api/v1/tasks/${task.id}`, { status: task.status === "COMPLETED" ? "OPEN" : "COMPLETED" });
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Aufgabe konnte nicht aktualisiert werden.");
    }
  }

  return (
    <TabState loading={loading} error={error} empty={false}>
      {(data?.items ?? []).length === 0 ? (
        <p className="rounded-md bg-ink-50 px-4 py-6 text-center text-xs text-ink-500">
          Keine Aufgaben zu diesem Datensatz.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {(data?.items ?? []).map((task) => (
            <li key={task.id} className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                checked={task.status === "COMPLETED"}
                onChange={() => toggle(task)}
                className="h-4 w-4 rounded border-ink-300 text-brand-500"
                aria-label={`${task.title} abschließen`}
              />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-xs", task.status === "COMPLETED" ? "text-ink-400 line-through" : "text-ink-800")}>
                  {task.title}
                </span>
                <span className={cn("text-2xs", task.isOverdue ? "text-danger-600" : "text-ink-500")}>
                  {task.dueAt ? formatRelative(task.dueAt) : "Ohne Fälligkeit"}
                  {task.owner ? ` · ${task.owner.name}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </TabState>
  );
}

function MeetingsTab({ links, version }: { links: RecordLinks; version: string }) {
  type Meeting = { id: string; title: string; startAt: string; endAt: string; location: string | null; status: string };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(links)) if (value) params.set(key, value);
  params.set("from", new Date(Date.now() - 365 * 86_400_000).toISOString());
  params.set("to", new Date(Date.now() + 365 * 86_400_000).toISOString());

  const { data, loading, error } = useResource<Meeting[]>(`/api/v1/meetings?${params.toString()}`, version);

  return (
    <TabState loading={loading} error={error} empty={false}>
      {(data ?? []).length === 0 ? (
        <p className="rounded-md bg-ink-50 px-4 py-6 text-center text-xs text-ink-500">Keine Termine zu diesem Datensatz.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {(data ?? []).map((meeting) => (
            <li key={meeting.id} className="py-2">
              <p className="text-xs font-medium text-ink-900">{meeting.title}</p>
              <p className="text-2xs text-ink-500">
                {formatDateTime(meeting.startAt)} – {formatDateTime(meeting.endAt)}
                {meeting.location ? ` · ${meeting.location}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </TabState>
  );
}

function EmailsTab({ query, version }: { query: string; version: string }) {
  type Email = {
    id: string;
    subject: string;
    status: string;
    direction: string;
    fromAddress: string;
    toAddresses: string[];
    createdAt: string;
    sentAt: string | null;
  };
  const { data, loading, error } = useResource<{ items: Email[] }>(`/api/v1/emails?${query}&pageSize=25`, version);

  return (
    <TabState loading={loading} error={error} empty={false}>
      {(data?.items ?? []).length === 0 ? (
        <p className="rounded-md bg-ink-50 px-4 py-6 text-center text-xs leading-relaxed text-ink-500">
          Noch keine E-Mails. Der E-Mail-Verlauf wird hier geführt, sobald ein Postausgang unter Einstellungen →
          Integrationen verbunden ist.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {(data?.items ?? []).map((email) => (
            <li key={email.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium text-ink-900">{email.subject}</p>
                <span className="shrink-0 text-2xs text-ink-400">{formatRelative(email.sentAt ?? email.createdAt)}</span>
              </div>
              <p className="text-2xs text-ink-500">
                {email.direction === "OUTBOUND" ? "An" : "Von"} {email.toAddresses.join(", ") || email.fromAddress} ·{" "}
                {email.status === "SENT" ? "Gesendet" : email.status === "DRAFT" ? "Entwurf" : email.status}
              </p>
            </li>
          ))}
        </ul>
      )}
    </TabState>
  );
}

function FilesTab({
  query,
  links,
  version,
  canUpload,
  canDelete,
  onChanged,
}: {
  query: string;
  links: RecordLinks;
  version: string;
  canUpload: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  type FileRow = {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: string;
    downloadUrl: string;
    uploadedBy: { name: string } | null;
  };
  const { data, loading, error } = useResource<FileRow[]>(`/api/v1/files?${query}`, version);
  const toast = useToast();
  const [uploading, setUploading] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<FileRow | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    for (const [key, value] of Object.entries(links)) if (value) form.set(key, value);
    try {
      await api.post("/api/v1/files", form);
      toast.success("Datei hochgeladen.");
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Upload ist fehlgeschlagen.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await api.delete(`/api/v1/files/${toDelete.id}`);
      toast.success("Datei gelöscht.");
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Datei konnte nicht gelöscht werden.");
    } finally {
      setToDelete(null);
    }
  }

  return (
    <div className="space-y-3">
      {canUpload ? (
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            icon={<FileUp className="h-3.5 w-3.5" />}
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            Datei hochladen
          </Button>
        </div>
      ) : null}

      <TabState loading={loading} error={error} empty={false}>
        {(data ?? []).length === 0 ? (
          <p className="rounded-md bg-ink-50 px-4 py-6 text-center text-xs text-ink-500">
            Noch keine Dateien. Angebote, Verträge und Unterlagen können hier abgelegt werden.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {(data ?? []).map((file) => (
              <li key={file.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <a href={file.downloadUrl} className="block truncate text-xs font-medium text-ink-800 hover:text-brand-600">
                    {file.filename}
                  </a>
                  <span className="text-2xs text-ink-500">
                    {formatBytes(file.size)} · {file.uploadedBy?.name ?? "Unbekannt"} · {formatRelative(file.createdAt)}
                  </span>
                </span>
                {canDelete ? (
                  <Button variant="ghost" size="icon" onClick={() => setToDelete(file)} aria-label="Datei löschen">
                    <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </TabState>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Datei löschen?"
        description={`„${toDelete?.filename ?? ""}" wird aus dem CRM entfernt. Diese Aktion kann nicht rückgängig gemacht werden.`}
      />
    </div>
  );
}

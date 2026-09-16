"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/misc";
import { Drawer, ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { TaskForm } from "@/components/crm/forms/simple-forms";
import { api, ApiError } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  isOverdue: boolean;
  owner: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
};

type Result = {
  items: Task[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: { today: number; overdue: number; upcoming: number; mine: number };
};

const PRIORITY: Record<string, { label: string; tone: BadgeTone }> = {
  LOW: { label: "Niedrig", tone: "neutral" },
  MEDIUM: { label: "Mittel", tone: "brand" },
  HIGH: { label: "Hoch", tone: "warning" },
  URGENT: { label: "Dringend", tone: "danger" },
};

/** Task views mirror how the day is actually planned: today, overdue, next. */
export function TasksView({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = React.useState("mine");
  const [page, setPage] = React.useState(1);
  const [result, setResult] = React.useState<Result | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Task | null>(null);
  const [deleting, setDeleting] = React.useState<Task | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get<Result>(`/api/v1/tasks?view=${view}&page=${page}&pageSize=25`));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Aufgaben konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [view, page]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function toggle(task: Task) {
    try {
      await api.patch(`/api/v1/tasks/${task.id}`, { status: task.status === "COMPLETED" ? "OPEN" : "COMPLETED" });
      await load();
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Aufgabe konnte nicht aktualisiert werden.");
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api.delete(`/api/v1/tasks/${deleting.id}`);
      toast.success("Aufgabe gelöscht.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Aufgabe konnte nicht gelöscht werden.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          active={view}
          onChange={(key) => {
            setView(key);
            setPage(1);
          }}
          tabs={[
            { key: "mine", label: "Meine Aufgaben", count: result?.counts.mine },
            { key: "today", label: "Heute", count: result?.counts.today },
            { key: "overdue", label: "Überfällig", count: result?.counts.overdue },
            { key: "upcoming", label: "Demnächst", count: result?.counts.upcoming },
            { key: "team", label: "Team" },
            { key: "completed", label: "Erledigt" },
            { key: "all", label: "Alle" },
          ]}
        />
        {canWrite ? (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Aufgabe erstellen
          </Button>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {loading && !result ? (
          <SkeletonTable rows={5} />
        ) : error ? (
          <EmptyState title="Fehler beim Laden" description={error} actions={<Button onClick={() => void load()}>Erneut versuchen</Button>} />
        ) : result && result.items.length === 0 ? (
          <EmptyState
            title="Keine Aufgaben in dieser Ansicht"
            description={
              view === "overdue"
                ? "Nichts ist überfällig – gut organisiert."
                : "Erstelle eine Aufgabe, um den nächsten Schritt festzuhalten."
            }
            actions={
              canWrite ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                  Aufgabe erstellen
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-ink-100">
              {result?.items.map((task) => (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ink-50/60">
                  <input
                    type="checkbox"
                    checked={task.status === "COMPLETED"}
                    onChange={() => toggle(task)}
                    className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-500"
                    aria-label={`${task.title} abschließen`}
                  />

                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => canWrite && setEditing(task)}
                      className={cn(
                        "block max-w-full truncate text-left text-sm",
                        task.status === "COMPLETED" ? "text-ink-400 line-through" : "text-ink-900 hover:text-brand-600",
                      )}
                    >
                      {task.title}
                    </button>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-500">
                      <span className={task.isOverdue ? "font-medium text-danger-600" : undefined}>
                        {task.dueAt ? formatRelative(task.dueAt) : "Ohne Fälligkeit"}
                      </span>
                      {task.owner ? <span>{task.owner.name}</span> : null}
                      {task.contact ? (
                        <Link href={`/contacts/${task.contact.id}`} className="hover:text-brand-600">
                          {task.contact.name}
                        </Link>
                      ) : null}
                      {task.company ? (
                        <Link href={`/companies/${task.company.id}`} className="hover:text-brand-600">
                          {task.company.name}
                        </Link>
                      ) : null}
                      {task.deal ? (
                        <Link href={`/deals/${task.deal.id}`} className="hover:text-brand-600">
                          {task.deal.name}
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <Badge tone={PRIORITY[task.priority]?.tone ?? "neutral"}>{PRIORITY[task.priority]?.label ?? task.priority}</Badge>

                  {canWrite ? (
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(task)} aria-label="Aufgabe löschen">
                      <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {result ? (
              <Pagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                totalPages={result.totalPages}
                onPageChange={setPage}
              />
            ) : null}
          </>
        )}
      </Card>

      <Drawer open={creating} onClose={() => setCreating(false)} title="Aufgabe erstellen">
        <TaskForm
          onDone={() => {
            setCreating(false);
            void load();
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      </Drawer>

      <Drawer open={editing !== null} onClose={() => setEditing(null)} title="Aufgabe bearbeiten">
        {editing ? (
          <TaskForm
            initial={{
              id: editing.id,
              title: editing.title,
              description: editing.description,
              status: editing.status,
              priority: editing.priority,
              dueAt: editing.dueAt,
              ownerId: editing.owner?.id ?? null,
            }}
            onDone={() => {
              setEditing(null);
              void load();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Aufgabe löschen?"
        description={`„${deleting?.title ?? ""}" wird entfernt. Die Historie am verknüpften Datensatz bleibt erhalten.`}
      />
    </div>
  );
}

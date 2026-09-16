"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/misc";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationsMenu() {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const data = await api.get<{ items: Notification[]; unread: number }>("/api/v1/notifications?pageSize=10");
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* keep the previous state — a failed poll must not break the shell */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  async function markAll() {
    setUnread(0);
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    await api.post("/api/v1/notifications/read-all").catch(() => undefined);
  }

  async function markOne(id: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)));
    setUnread((value) => Math.max(0, value - 1));
    await api.post(`/api/v1/notifications/${id}/read`).catch(() => undefined);
  }

  return (
    <Dropdown
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Benachrichtigungen${unread > 0 ? ` (${unread} ungelesen)` : ""}`}>
          <span className="relative">
            <Bell className="h-4 w-4" />
            {unread > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[9px] font-semibold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </span>
        </Button>
      }
      className="w-[22rem] p-0"
    >
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <p className="text-sm font-semibold text-ink-900">Benachrichtigungen</p>
        {unread > 0 ? (
          <button
            type="button"
            onClick={markAll}
            className="inline-flex items-center gap-1 text-2xs text-brand-600 hover:text-brand-700"
          >
            <CheckCheck className="h-3 w-3" /> Alle gelesen
          </button>
        ) : null}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-6 text-center text-xs text-ink-500">Wird geladen…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-ink-500">
            Keine Benachrichtigungen. Zuweisungen, fällige Aufgaben und Workflow-Fehler erscheinen hier.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {items.map((item) => {
              const content = (
                <div className={cn("px-3 py-2.5 transition-colors hover:bg-ink-50", !item.readAt && "bg-brand-50/40")}>
                  <div className="flex items-start gap-2">
                    {!item.readAt ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" /> : null}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink-900">{item.title}</p>
                      {item.body ? <p className="mt-0.5 text-2xs text-ink-500">{item.body}</p> : null}
                      <p className="mt-1 text-2xs text-ink-400">{formatRelative(item.createdAt)}</p>
                    </div>
                  </div>
                </div>
              );

              return (
                <li key={item.id} onClick={() => !item.readAt && markOne(item.id)}>
                  {item.link ? <Link href={item.link}>{content}</Link> : content}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dropdown>
  );
}

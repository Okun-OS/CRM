"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Inbox, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

type Reply = {
  id: string;
  subject: string;
  body: string;
  fromAddress: string;
  classification: string | null;
  confidence: number | null;
  needsReview: boolean;
  reviewedAt: string | null;
  prospect: { id: string; companyName: string; email: string | null; stage: string } | null;
  sequence: { id: string; name: string } | null;
  receivedAt: string;
};

const CLASSES: Record<string, { label: string; tone: BadgeTone }> = {
  INTERESTED: { label: "Interessiert", tone: "success" },
  MEETING_REQUEST: { label: "Terminwunsch", tone: "success" },
  QUESTION: { label: "Rückfrage", tone: "accent" },
  REFERRAL: { label: "Verweis", tone: "accent" },
  LATER: { label: "Später", tone: "neutral" },
  NOT_INTERESTED: { label: "Kein Interesse", tone: "neutral" },
  OUT_OF_OFFICE: { label: "Abwesend", tone: "neutral" },
  UNSUBSCRIBE: { label: "Abmeldung", tone: "danger" },
  UNKNOWN: { label: "Unklar", tone: "warning" },
};

export function InboxView() {
  const toast = useToast();
  const [replies, setReplies] = React.useState<Reply[] | null>(null);
  const [onlyOpen, setOnlyOpen] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      setReplies(await api.get<Reply[]>(`/api/v1/outreach/replies?open=${onlyOpen}`));
    } catch {
      setReplies([]);
    }
  }, [onlyOpen]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function act(reply: Reply, body: Record<string, unknown>, message: string) {
    try {
      await api.post(`/api/v1/outreach/replies/${reply.id}`, body);
      toast.success(message);
      void load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Aktion ist fehlgeschlagen.");
    }
  }

  if (!replies) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(event) => setOnlyOpen(event.target.checked)}
            className="h-4 w-4 rounded border-ink-300"
          />
          Nur ungesichtete
        </label>
      </div>

      {replies.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title={onlyOpen ? "Alles gesichtet" : "Noch keine Antworten"}
            description={
              onlyOpen
                ? "Es liegt keine ungesichtete Antwort vor."
                : "Sobald auf eine Sequenz geantwortet wird, erscheinen die Nachrichten hier."
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {replies.map((reply) => {
            const info = CLASSES[reply.classification ?? "UNKNOWN"] ?? CLASSES.UNKNOWN;
            return (
              <Card key={reply.id} className={cn("p-4", reply.needsReview && "border-warning-300")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={info.tone}>{info.label}</Badge>
                      {reply.needsReview ? (
                        <span className="inline-flex items-center gap-1 text-2xs text-warning-700">
                          <ShieldQuestion className="h-3.5 w-3.5" />
                          Einstufung unsicher — bitte prüfen
                        </span>
                      ) : null}
                      {reply.reviewedAt ? <span className="text-2xs text-ink-400">gesichtet</span> : null}
                    </div>

                    <p className="mt-1.5 font-medium text-ink-900">{reply.subject}</p>
                    <p className="text-xs text-ink-500">
                      {reply.fromAddress} · {formatDateTime(reply.receivedAt)}
                      {reply.sequence ? ` · aus „${reply.sequence.name}"` : ""}
                    </p>
                    {reply.prospect ? (
                      <Link
                        href={`/outreach/prospects/${reply.prospect.id}`}
                        className="mt-1 inline-block text-xs text-brand-700 hover:underline"
                      >
                        {reply.prospect.companyName}
                      </Link>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Select
                      value={reply.classification ?? "UNKNOWN"}
                      onChange={(event) =>
                        act(reply, { action: "reclassify", classification: event.target.value }, "Einstufung geändert.")
                      }
                      aria-label="Einstufung ändern"
                      className="w-44"
                    >
                      {Object.entries(CLASSES).map(([value, entry]) => (
                        <option key={value} value={value}>{entry.label}</option>
                      ))}
                    </Select>
                    {!reply.reviewedAt ? (
                      <Button
                        size="sm"
                        icon={<Check className="h-3.5 w-3.5" />}
                        onClick={() => act(reply, { action: "reviewed" }, "Als gesichtet markiert.")}
                      >
                        Gesichtet
                      </Button>
                    ) : null}
                  </div>
                </div>

                {reply.body ? (
                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap border-t border-ink-100 pt-3 text-sm leading-relaxed text-ink-600">
                    {reply.body.replace(/<[^>]+>/g, " ").trim()}
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

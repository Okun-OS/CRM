"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Mail, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonText } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/table";
import { EmailComposer } from "@/components/crm/email-composer";
import { api, ApiError } from "@/lib/api-client";
import { formatRelative, stripHtml, truncate } from "@/lib/format";

type EmailRow = {
  id: string;
  direction: string;
  status: string;
  subject: string;
  bodyHtml: string;
  fromAddress: string;
  toAddresses: string[];
  sentAt: string | null;
  createdAt: string;
  error: string | null;
  createdBy: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
};

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Entwurf", tone: "neutral" },
  QUEUED: { label: "In Warteschlange", tone: "warning" },
  SENT: { label: "Gesendet", tone: "success" },
  FAILED: { label: "Fehlgeschlagen", tone: "danger" },
  RECEIVED: { label: "Empfangen", tone: "brand" },
};

/**
 * E-mail workspace. When no transport is connected the product says so plainly
 * instead of showing a send button that silently does nothing.
 */
export function EmailsView({ transportConnected, canCompose }: { transportConnected: boolean; canCompose: boolean }) {
  const [page, setPage] = React.useState(1);
  const [result, setResult] = React.useState<{
    items: EmailRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [composing, setComposing] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setResult(await api.get(`/api/v1/emails?page=${page}&pageSize=25`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die E-Mails konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      {!transportConnected ? (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-warning-500/30 bg-warning-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warning-700">Kein E-Mail-Postausgang verbunden</p>
            <p className="mt-0.5 text-xs leading-relaxed text-warning-700/90">
              E-Mails können verfasst und als Entwurf gespeichert werden. Für den Versand muss ein Administrator unter
              Einstellungen → Integrationen einen Anbieter verbinden.
            </p>
          </div>
          <Link href="/settings/integrations">
            <Button size="sm" variant="secondary">
              Zu den Integrationen
            </Button>
          </Link>
        </div>
      ) : null}

      <div className="flex justify-end">
        {canCompose ? (
          <Button variant="primary" icon={<PenLine className="h-4 w-4" />} onClick={() => setComposing(true)}>
            E-Mail verfassen
          </Button>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {loading && !result ? (
          <div className="p-4">
            <SkeletonText lines={6} />
          </div>
        ) : error ? (
          <EmptyState title="Fehler beim Laden" description={error} actions={<Button onClick={() => void load()}>Erneut versuchen</Button>} />
        ) : result && result.items.length === 0 ? (
          <EmptyState
            icon={<Mail className="h-5 w-5" />}
            title="Noch keine E-Mails"
            description="Verfasste und gesendete E-Mails erscheinen hier und werden automatisch der Timeline des Kontakts zugeordnet."
            actions={
              canCompose ? (
                <Button variant="primary" onClick={() => setComposing(true)}>
                  E-Mail verfassen
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-ink-100">
              {result?.items.map((email) => (
                <li key={email.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink-900">{email.subject}</p>
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS[email.status]?.tone ?? "neutral"}>{STATUS[email.status]?.label ?? email.status}</Badge>
                      <span className="text-2xs text-ink-400">{formatRelative(email.sentAt ?? email.createdAt)}</span>
                    </div>
                  </div>
                  <p className="mt-0.5 text-2xs text-ink-500">
                    {email.direction === "OUTBOUND" ? "An" : "Von"} {email.toAddresses.join(", ") || email.fromAddress}
                    {email.contact ? (
                      <>
                        {" · "}
                        <Link href={`/contacts/${email.contact.id}`} className="hover:text-brand-600">
                          {email.contact.name}
                        </Link>
                      </>
                    ) : null}
                    {email.createdBy ? ` · ${email.createdBy.name}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-ink-600">{truncate(stripHtml(email.bodyHtml), 160)}</p>
                  {email.error ? <p className="mt-1 text-2xs text-danger-600">Fehler: {email.error}</p> : null}
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

      <Drawer open={composing} onClose={() => setComposing(false)} title="E-Mail verfassen" width="lg">
        <EmailComposer
          onDone={() => {
            setComposing(false);
            void load();
          }}
          onCancel={() => setComposing(false)}
        />
      </Drawer>
    </div>
  );
}

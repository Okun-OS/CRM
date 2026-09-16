"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/crm/forms/form-kit";
import { api, ApiError } from "@/lib/api-client";
import { DOMAIN_EVENTS } from "@/lib/domain-events";
import { formatDateTime, formatRelative } from "@/lib/format";

type Endpoint = {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  secretHint: string;
  lastDeliveryAt: string | null;
  deliveryCount: number;
};

type Delivery = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  endpoint: { id: string; url: string };
  createdAt: string;
  nextRetryAt: string | null;
};

const DELIVERY_TONE: Record<string, BadgeTone> = { DELIVERED: "success", FAILED: "danger", PENDING: "warning" };

export function WebhooksView({ endpoints, deliveries }: { endpoints: Endpoint[]; deliveries: Delivery[] }) {
  const router = useRouter();
  const toast = useToast();
  const [creating, setCreating] = React.useState(false);
  const [secret, setSecret] = React.useState<{ url: string; secret: string } | null>(null);
  const [deleting, setDeleting] = React.useState<Endpoint | null>(null);

  async function remove() {
    if (!deleting) return;
    try {
      await api.delete(`/api/v1/webhooks/${deleting.id}`);
      toast.success("Webhook gelöscht.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Webhook konnte nicht gelöscht werden.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          Webhook anlegen
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`Endpunkte (${endpoints.length})`} />
        {endpoints.length === 0 ? (
          <EmptyState
            icon={<Webhook className="h-5 w-5" />}
            title="Noch keine Webhooks"
            description="Sende Ereignisse wie deal.won oder contact.created an Zapier, Make oder eigene Systeme."
            compact
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-ink-900">{endpoint.url}</p>
                    <p className="mt-0.5 text-2xs text-ink-500">
                      {endpoint.description ? `${endpoint.description} · ` : ""}
                      Secret {endpoint.secretHint} · {endpoint.deliveryCount} Zustellungen
                      {endpoint.lastDeliveryAt ? ` · zuletzt ${formatRelative(endpoint.lastDeliveryAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={endpoint.isActive ? "success" : "neutral"} dot>
                      {endpoint.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(endpoint)} aria-label="Webhook löschen">
                      <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {endpoint.events.map((event) => (
                    <code key={event} className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-2xs text-ink-600">
                      {event}
                    </code>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Letzte Zustellungen" description="Fehlgeschlagene Zustellungen werden mit wachsendem Abstand wiederholt." />
        {deliveries.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-ink-500">Noch keine Zustellungen.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <code className="font-mono text-2xs text-ink-700">{delivery.event}</code>
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-500">{delivery.endpoint.url}</span>
                <span className="text-2xs text-ink-400">
                  {delivery.attempts} Versuch(e)
                  {delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ""}
                  {delivery.nextRetryAt ? ` · nächster Versuch ${formatRelative(delivery.nextRetryAt)}` : ""}
                </span>
                <span className="text-2xs text-ink-400">{formatDateTime(delivery.createdAt)}</span>
                <Badge tone={DELIVERY_TONE[delivery.status] ?? "neutral"}>{delivery.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <WebhookModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(result) => {
          setCreating(false);
          setSecret(result);
          router.refresh();
        }}
      />

      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="Webhook angelegt"
        description="Dieses Secret wird nur einmal angezeigt. Damit verifiziert das Zielsystem die Signatur."
        size="sm"
        footer={<Button variant="primary" onClick={() => setSecret(null)}>Verstanden</Button>}
      >
        <div className="space-y-2">
          <Input readOnly value={secret?.secret ?? ""} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret?.secret ?? "");
                toast.success("Secret kopiert.");
              } catch {
                toast.error("Kopieren nicht möglich", "Bitte das Secret manuell markieren.");
              }
            }}
          >
            Kopieren
          </Button>
          <p className="text-2xs leading-relaxed text-ink-500">
            Signatur-Header: <code className="font-mono">x-okun-signature: sha256=HMAC(secret, "timestamp.body")</code>
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Webhook löschen?"
        description="Zukünftige Ereignisse werden nicht mehr an diese URL gesendet."
      />
    </div>
  );
}

function WebhookModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { url: string; secret: string }) => void;
}) {
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [events, setEvents] = React.useState<string[]>(["deal.won"]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await api.post<{ url: string; secret: string }>("/api/v1/webhooks", {
        url,
        events,
        description: description || undefined,
        isActive: true,
      });
      setUrl("");
      setDescription("");
      onCreated(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Der Webhook konnte nicht angelegt werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Webhook anlegen"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Abbrechen
          </Button>
          <Button variant="primary" loading={pending} disabled={!url || events.length === 0} onClick={submit}>
            Anlegen
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="Ziel-URL" htmlFor="webhook-url" required>
          <Input id="webhook-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" autoFocus />
        </Field>
        <Field label="Beschreibung" htmlFor="webhook-description">
          <Input id="webhook-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-700">Ereignisse</p>
          <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-ink-200 p-2 sm:grid-cols-2">
            {DOMAIN_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-ink-700 hover:bg-ink-50">
                <Checkbox
                  checked={events.includes(event)}
                  onChange={(changeEvent) =>
                    setEvents((current) =>
                      changeEvent.target.checked ? [...current, event] : current.filter((item) => item !== event),
                    )
                  }
                />
                <code className="font-mono text-2xs">{event}</code>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

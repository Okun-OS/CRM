"use client";

import * as React from "react";
import { Copy, ExternalLink, KeyRound, Plus, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import {
  MAILWIN_SIGNAL_LABELS,
  MAILWIN_STAGE_SIGNALS,
  MAILWIN_WEBHOOK_EVENTS,
  type MailwinStageSignal,
  type MailwinWebhookType,
} from "@/lib/crm/mailwin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type MailwinKey = {
  id: string;
  name: string;
  prefix: string;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type WebhookConfig = {
  id: string | null;
  url: string;
  events: MailwinWebhookType[];
  isActive: boolean;
  hasSecret: boolean;
  lastDeliveryAt: string | null;
};

type SignalSettings = {
  acceptance: "suggest" | "auto";
  decline: "suggest" | "auto";
  autoMinConfidence: number;
  offerValue: "fill" | "overwrite";
  pipelines: {
    id: string;
    name: string;
    stages: { id: string; name: string }[];
    mapping: Record<MailwinStageSignal, string | null>;
  }[];
};

type Overview = {
  baseUrl: string;
  signals: SignalSettings;
  keys: MailwinKey[];
  webhook: WebhookConfig;
  requests: {
    id: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    errorCode: string | null;
    replayed: boolean;
    keyName: string | null;
    createdAt: string;
  }[];
  deliveries: {
    id: string;
    type: string;
    status: string;
    attempts: number;
    responseStatus: number | null;
    error: string | null;
    createdAt: string;
    deliveredAt: string | null;
    nextRetryAt: string | null;
  }[];
};

const DELIVERY_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  DELIVERED: { label: "zugestellt", tone: "success" },
  PENDING: { label: "wird wiederholt", tone: "warning" },
  FAILED: { label: "aufgegeben", tone: "danger" },
};

export function MailwinView({ initial }: { initial: Overview }) {
  const toast = useToast();
  const [data, setData] = React.useState(initial);

  const reload = React.useCallback(async () => {
    setData(await api.get<Overview>("/api/v1/settings/mailwin"));
  }, []);

  const activeKeys = data.keys.filter((key) => !key.revokedAt);
  const lastUsed = activeKeys.map((key) => key.lastUsedAt).filter(Boolean).sort().pop() ?? null;

  function copy(value: string, label = "In die Zwischenablage kopiert") {
    void navigator.clipboard.writeText(value);
    toast.success(label);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Verbindung"
          description="Diese Angaben trägt man in Mailwin ein: Basis-URL und einen Schlüssel aus dem nächsten Abschnitt."
          action={
            activeKeys.length === 0 ? (
              <Badge tone="neutral">Nicht verbunden</Badge>
            ) : lastUsed ? (
              <Badge tone="success" dot>Verbunden · zuletzt {formatDateTime(lastUsed)}</Badge>
            ) : (
              <Badge tone="warning" dot>Schlüssel bereit, noch nicht genutzt</Badge>
            )
          }
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-500">Basis-URL</span>
            <code className="rounded-md bg-ink-50 px-2 py-1 text-xs text-ink-800">{data.baseUrl}</code>
            <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(data.baseUrl)}>
              Kopieren
            </Button>
          </div>
          <p className="text-2xs text-ink-500">
            Technische Beschreibung (OpenAPI 3.1):{" "}
            <a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={`${data.baseUrl}/openapi.json`} target="_blank" rel="noreferrer">
              openapi.json <ExternalLink className="h-3 w-3" />
            </a>
            . Mailwin darf höchstens 120 Anfragen pro Minute und Schlüssel stellen und sieht ausschließlich Daten dieses Arbeitsbereichs.
          </p>
        </CardBody>
      </Card>

      <KeysCard keys={data.keys} baseUrl={data.baseUrl} onChanged={reload} onCopy={copy} />
      <SignalsCard settings={data.signals} onChanged={reload} />
      <WebhookCard config={data.webhook} onChanged={reload} onCopy={copy} />

      <Card>
        <CardHeader
          title="Zustellprotokoll"
          description="Ereignisse an Mailwin. Fehlgeschlagene Zustellungen werden mit wachsendem Abstand bis zu 24 Stunden wiederholt."
          action={<Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void reload()}>Aktualisieren</Button>}
        />
        <CardBody className={data.deliveries.length === 0 ? undefined : "p-0"}>
          {data.deliveries.length === 0 ? (
            <EmptyState compact icon={<Webhook className="h-5 w-5" />} title="Noch nichts zugestellt" description="Sobald ein Lead die Phase wechselt oder ein Kontakt sich ändert, steht es hier." />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <Th>Zeitpunkt</Th>
                  <Th>Ereignis</Th>
                  <Th>Status</Th>
                  <Th align="right">Versuche</Th>
                  <Th>Antwort</Th>
                </tr>
              </thead>
              <tbody>
                {data.deliveries.map((delivery) => {
                  const status = DELIVERY_STATUS[delivery.status] ?? DELIVERY_STATUS.PENDING;
                  return (
                    <Tr key={delivery.id}>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(delivery.createdAt)}</Td>
                      <Td><code className="text-xs">{delivery.type}</code></Td>
                      <Td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {delivery.status === "PENDING" && delivery.nextRetryAt ? (
                          <span className="ml-2 text-2xs text-ink-500">nächster Versuch {formatDateTime(delivery.nextRetryAt)}</span>
                        ) : null}
                      </Td>
                      <Td align="right" className="tabular-nums">{delivery.attempts}</Td>
                      <Td className="text-xs">{delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : (delivery.error ?? "—")}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Aufrufprotokoll"
          description="Jeder Aufruf von Mailwin, 30 Tage lang. Ändert Mailwin Daten, steht das außerdem im Audit-Log mit Herkunft „Mailwin“."
          action={<Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void reload()}>Aktualisieren</Button>}
        />
        <CardBody className={data.requests.length === 0 ? undefined : "p-0"}>
          {data.requests.length === 0 ? (
            <EmptyState compact title="Noch keine Aufrufe" description="Sobald Mailwin mit einem Schlüssel anfragt, erscheint jeder Aufruf hier." />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <Th>Zeitpunkt</Th>
                  <Th>Aufruf</Th>
                  <Th>Status</Th>
                  <Th align="right">Dauer</Th>
                  <Th>Schlüssel</Th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((request) => (
                  <Tr key={request.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(request.createdAt)}</Td>
                    <Td><code className="text-xs">{request.method} {request.path.replace("/api/mailwin/v1", "")}</code></Td>
                    <Td>
                      <Badge tone={request.status < 300 ? "success" : request.status === 429 ? "warning" : "danger"}>{request.status}</Badge>
                      {request.errorCode ? <span className="ml-2 text-2xs text-ink-500">{request.errorCode}</span> : null}
                      {request.replayed ? <span className="ml-2 text-2xs text-ink-500">wiederholt (Idempotency-Key)</span> : null}
                    </Td>
                    <Td align="right" className="tabular-nums text-xs">{request.durationMs} ms</Td>
                    <Td className="text-xs">{request.keyName ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function KeysCard({
  keys,
  baseUrl,
  onChanged,
  onCopy,
}: {
  keys: MailwinKey[];
  baseUrl: string;
  onChanged: () => Promise<void>;
  onCopy: (value: string, label?: string) => void;
}) {
  const toast = useToast();
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("Mailwin");
  const [busy, setBusy] = React.useState(false);
  const [issued, setIssued] = React.useState<{ name: string; key: string } | null>(null);
  const [revoking, setRevoking] = React.useState<MailwinKey | null>(null);

  async function create() {
    setBusy(true);
    try {
      const created = await api.post<{ name: string; key: string }>("/api/v1/settings/mailwin/keys", { name: name.trim() });
      setIssued(created);
      setCreating(false);
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Schlüssel konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: MailwinKey) {
    try {
      await api.delete(`/api/v1/settings/mailwin/keys/${key.id}`);
      toast.success("Schlüssel widerrufen", key.name);
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Schlüssel konnte nicht widerrufen werden.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="API-Schlüssel"
          description="Ein Schlüssel gilt nur für die Mailwin-Schnittstelle und nur für diesen Arbeitsbereich. Gespeichert wird nur ein Hash — der Klartext erscheint genau einmal."
          action={
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
              Schlüssel erzeugen
            </Button>
          }
        />
        <CardBody className={keys.length === 0 ? undefined : "p-0"}>
          {keys.length === 0 ? (
            <EmptyState compact icon={<KeyRound className="h-5 w-5" />} title="Noch kein Schlüssel" description="Erzeugen Sie einen Schlüssel und tragen Sie ihn in Mailwin ein." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                      {key.name}
                      {key.revokedAt ? <Badge tone="danger">widerrufen</Badge> : <Badge tone="success">aktiv</Badge>}
                    </p>
                    <p className="mt-0.5 text-2xs text-ink-500">
                      <code>{key.prefix}…</code> · erzeugt {formatDateTime(key.createdAt)}
                      {key.createdBy ? ` von ${key.createdBy.name}` : ""} ·{" "}
                      {key.lastUsedAt ? `zuletzt genutzt ${formatDateTime(key.lastUsedAt)}` : "noch nicht genutzt"}
                    </p>
                  </div>
                  {key.revokedAt ? null : (
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setRevoking(key)}>
                      Widerrufen
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Mailwin-Schlüssel erzeugen"
        description="Der Schlüssel darf ausschließlich die Mailwin-Schnittstelle nutzen. Aufrufe laufen im Namen der Person, die ihn erzeugt."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Abbrechen</Button>
            <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void create()}>
              Erzeugen
            </Button>
          </>
        }
      >
        <Field label="Name" htmlFor="mailwin-key-name" required hint="Woran erkennen Sie später, wofür dieser Schlüssel gilt?">
          <Input id="mailwin-key-name" value={name} maxLength={80} placeholder="z. B. Mailwin Produktion" onChange={(event) => setName(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Schlüssel erzeugt"
        description="Kopieren Sie den Schlüssel jetzt und tragen Sie ihn in Mailwin ein — er wird nicht erneut angezeigt."
        size="sm"
        footer={<Button variant="primary" onClick={() => setIssued(null)}>Fertig</Button>}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-2xs font-medium text-ink-600">Schlüssel</p>
            <code className="block break-all rounded-md bg-ink-900 px-3 py-2.5 text-xs text-white">{issued?.key}</code>
            <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => onCopy(issued?.key ?? "", "Schlüssel kopiert")}>
              Schlüssel kopieren
            </Button>
          </div>
          <div className="space-y-1.5">
            <p className="text-2xs font-medium text-ink-600">Basis-URL</p>
            <code className="block break-all rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-800">{baseUrl}</code>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => void revoke(revoking as MailwinKey)}
        title="Schlüssel widerrufen?"
        description={`Mailwin kann mit „${revoking?.name ?? ""}" danach sofort nicht mehr zugreifen.`}
        confirmLabel="Widerrufen"
      />
    </>
  );
}

function WebhookCard({
  config,
  onChanged,
  onCopy,
}: {
  config: WebhookConfig;
  onChanged: () => Promise<void>;
  onCopy: (value: string, label?: string) => void;
}) {
  const toast = useToast();
  const [url, setUrl] = React.useState(config.url);
  const [secret, setSecret] = React.useState("");
  const [events, setEvents] = React.useState<MailwinWebhookType[]>(config.events);
  const [isActive, setIsActive] = React.useState(config.id ? config.isActive : true);
  const [busy, setBusy] = React.useState<"save" | "generate" | "test" | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [generated, setGenerated] = React.useState<string | null>(null);

  async function save(generateSecret = false) {
    setBusy(generateSecret ? "generate" : "save");
    setFields({});
    try {
      const result = await api.put<{ secret: string | null }>("/api/v1/settings/mailwin/webhook", {
        url: url.trim(),
        events,
        isActive,
        secret: secret.trim() || undefined,
        generateSecret,
      });
      setSecret("");
      if (result.secret) setGenerated(result.secret);
      toast.success("Webhook gespeichert");
      await onChanged();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFields(cause.fields);
        toast.error(cause.message);
      } else {
        toast.error("Der Webhook konnte nicht gespeichert werden.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const result = await api.post<{ ok: boolean; responseStatus: number | null; error: string | null }>(
        "/api/v1/settings/mailwin/webhook/test",
        {},
      );
      if (result.ok) toast.success("Mailwin hat das Testereignis angenommen", `HTTP ${result.responseStatus}`);
      else toast.error("Mailwin hat das Testereignis nicht angenommen", result.error ?? undefined);
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Test ist fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Webhooks an Mailwin"
          description="Das CRM meldet Mailwin Phasenwechsel, Gewinne und Verluste von Leads sowie geänderte Kontakte. Jede Meldung ist mit dem gemeinsamen Geheimnis signiert (HMAC-SHA256)."
          action={
            config.id ? (
              config.isActive ? <Badge tone="success" dot>aktiv</Badge> : <Badge tone="neutral">pausiert</Badge>
            ) : (
              <Badge tone="neutral">nicht eingerichtet</Badge>
            )
          }
        />
        <CardBody className="space-y-4">
          <Field label="Webhook-URL" htmlFor="mailwin-webhook-url" required error={fields.url}>
            <Input id="mailwin-webhook-url" value={url} onChange={(event) => setUrl(event.target.value)} />
          </Field>

          <Field
            label="Gemeinsames Geheimnis"
            htmlFor="mailwin-webhook-secret"
            error={fields.secret}
            hint={
              config.hasSecret
                ? "Ein Geheimnis ist hinterlegt (verschlüsselt). Leer lassen, um es zu behalten."
                : "Das Geheimnis aus Mailwin einfügen — oder unten eines erzeugen lassen und in Mailwin eintragen."
            }
          >
            <Input
              id="mailwin-webhook-secret"
              type="password"
              autoComplete="new-password"
              value={secret}
              placeholder={config.hasSecret ? "••••••••••••" : "mindestens 16 Zeichen"}
              onChange={(event) => setSecret(event.target.value)}
            />
          </Field>

          <Field label="Ereignisse" error={fields.events}>
            <div className="grid gap-2 sm:grid-cols-2">
              {MAILWIN_WEBHOOK_EVENTS.map((event) => (
                <label key={event.type} className="flex items-center gap-2 text-sm text-ink-700">
                  <Checkbox
                    checked={events.includes(event.type)}
                    onChange={(change) =>
                      setEvents(change.target.checked ? [...events, event.type] : events.filter((entry) => entry !== event.type))
                    }
                  />
                  {event.label}
                  <code className="text-2xs text-ink-400">{event.type}</code>
                </label>
              ))}
            </div>
          </Field>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            Webhooks senden
          </label>

          <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
            <Button variant="primary" loading={busy === "save"} disabled={!url.trim() || events.length === 0} onClick={() => void save(false)}>
              Speichern
            </Button>
            <Button loading={busy === "generate"} disabled={!url.trim() || events.length === 0} onClick={() => void save(true)}>
              Neues Geheimnis erzeugen
            </Button>
            <Button variant="ghost" icon={<Send className="h-3.5 w-3.5" />} loading={busy === "test"} disabled={!config.id} onClick={() => void test()}>
              Testereignis senden
            </Button>
          </div>
          {config.lastDeliveryAt ? (
            <p className="text-2xs text-ink-500">Zuletzt erfolgreich zugestellt: {formatDateTime(config.lastDeliveryAt)}</p>
          ) : null}
        </CardBody>
      </Card>

      <Modal
        open={generated !== null}
        onClose={() => setGenerated(null)}
        title="Neues Geheimnis"
        description="Tragen Sie dieses Geheimnis in Mailwin ein. Es wird verschlüsselt gespeichert und hier nicht erneut angezeigt."
        size="sm"
        footer={<Button variant="primary" onClick={() => setGenerated(null)}>Fertig</Button>}
      >
        <div className="space-y-2">
          <code className="block break-all rounded-md bg-ink-900 px-3 py-2.5 text-xs text-white">{generated}</code>
          <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => onCopy(generated ?? "", "Geheimnis kopiert")}>
            Kopieren
          </Button>
        </div>
      </Modal>
    </>
  );
}

function SignalsCard({ settings, onChanged }: { settings: SignalSettings; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [acceptance, setAcceptance] = React.useState(settings.acceptance);
  const [decline, setDecline] = React.useState(settings.decline);
  const [threshold, setThreshold] = React.useState(Math.round(settings.autoMinConfidence * 100));
  const [offerValue, setOfferValue] = React.useState(settings.offerValue);
  const [mapping, setMapping] = React.useState(
    Object.fromEntries(settings.pipelines.map((pipeline) => [pipeline.id, { ...pipeline.mapping }])) as Record<
      string,
      Record<MailwinStageSignal, string | null>
    >,
  );
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.put("/api/v1/settings/mailwin/signals", {
        acceptance,
        decline,
        autoMinConfidence: Math.min(100, Math.max(0, threshold)) / 100,
        offerValue,
        stageMapping: mapping,
      });
      toast.success("Signal-Einstellungen gespeichert");
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Einstellungen konnten nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Signale aus Mailwin"
        description="Mailwin meldet, was es in E-Mails erkannt hat — etwa „Angebot verschickt“ oder „Kunde nimmt an“. Hier legen Sie fest, was daraus im CRM folgt. Phasen gehen dabei nur vorwärts, und alles steht mit Zitat in der Zeitleiste."
      />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Angebot oder Vertrag angenommen" htmlFor="mailwin-acceptance" hint="Eine falsch erkannte Zusage soll keinen Umsatz in den Forecast schreiben.">
            <Select id="mailwin-acceptance" value={acceptance} onChange={(event) => setAcceptance(event.target.value as "suggest" | "auto")}>
              <option value="suggest">Vorschlag „Als gewonnen markieren?“ (empfohlen)</option>
              <option value="auto">Automatisch gewonnen ab Mindest-Verlässlichkeit</option>
            </Select>
          </Field>
          <Field label="Angebot abgelehnt" htmlFor="mailwin-decline">
            <Select id="mailwin-decline" value={decline} onChange={(event) => setDecline(event.target.value as "suggest" | "auto")}>
              <option value="suggest">Vorschlag „Als verloren markieren?“ (empfohlen)</option>
              <option value="auto">Automatisch verloren ab Mindest-Verlässlichkeit</option>
            </Select>
          </Field>
          <Field label="Mindest-Verlässlichkeit für „automatisch“" htmlFor="mailwin-threshold" hint="Darunter bleibt es ein Vorschlag.">
            <div className="flex items-center gap-2">
              <Input
                id="mailwin-threshold"
                type="number"
                min={0}
                max={100}
                className="w-24"
                value={threshold}
                disabled={acceptance === "suggest" && decline === "suggest"}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <span className="text-sm text-ink-600">%</span>
            </div>
          </Field>
          <Field label="Wert aus dem Angebot" htmlFor="mailwin-offer-value">
            <Select id="mailwin-offer-value" value={offerValue} onChange={(event) => setOfferValue(event.target.value as "fill" | "overwrite")}>
              <option value="fill">Nur übernehmen, wenn der Lead noch keinen Wert hat</option>
              <option value="overwrite">Immer übernehmen</option>
            </Select>
          </Field>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-ink-700">Phase je Signal</p>
          {settings.pipelines.map((pipeline) => (
            <div key={pipeline.id} className="rounded-md border border-ink-200 p-3">
              <p className="mb-2 text-xs font-semibold text-ink-800">{pipeline.name}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {MAILWIN_STAGE_SIGNALS.map((signal) => (
                  <Field key={signal} label={MAILWIN_SIGNAL_LABELS[signal]} htmlFor={`mailwin-map-${pipeline.id}-${signal}`}>
                    <Select
                      id={`mailwin-map-${pipeline.id}-${signal}`}
                      value={mapping[pipeline.id]?.[signal] ?? ""}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [pipeline.id]: { ...current[pipeline.id], [signal]: event.target.value || null },
                        }))
                      }
                    >
                      <option value="">— Phase nicht ändern —</option>
                      {pipeline.stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-ink-100 pt-4">
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Speichern
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

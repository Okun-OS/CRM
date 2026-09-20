"use client";

import * as React from "react";
import { Check, Plug, RefreshCw, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type Connection = {
  id: string;
  status: string;
  displayName: string | null;
  connectedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  host: string | null;
  port: number | null;
  user: string | null;
  fromAddress: string | null;
};

type Integration = {
  provider: string;
  name: string;
  category: string;
  summary: string;
  capabilities: string[];
  requires: string[];
  implemented: boolean;
  perUser: boolean;
  connection: Connection | null;
};

export function IntegrationsView({ initial }: { initial: Integration[] }) {
  const toast = useToast();
  const [integrations, setIntegrations] = React.useState(initial);
  const [connecting, setConnecting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState<Integration | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function reload() {
    setIntegrations(await api.get<Integration[]>("/api/v1/integrations"));
  }

  async function test(connectionId: string) {
    setBusyId(connectionId);
    try {
      const result = await api.post<{ ok: boolean; reason?: string }>(`/api/v1/integrations/${connectionId}/test`, {});
      if (result.ok) toast.success("Verbindung steht");
      else toast.error("Verbindung fehlgeschlagen", result.reason);
      await reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Die Prüfung ist fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  }

  const grouped = React.useMemo(() => {
    const map = new Map<string, Integration[]>();
    for (const integration of integrations) {
      const bucket = map.get(integration.category) ?? [];
      bucket.push(integration);
      map.set(integration.category, bucket);
    }
    return Array.from(map.entries());
  }, [integrations]);

  return (
    <>
      <div className="space-y-5">
        {grouped.map(([category, items]) => (
          <Card key={category}>
            <CardHeader title={category} />
            <CardBody className="p-0">
              <ul className="divide-y divide-ink-100">
                {items.map((integration) => (
                  <li key={integration.provider} className="flex flex-wrap items-start gap-4 px-4 py-4">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                      <Plug className="h-4 w-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink-900">{integration.name}</span>
                        {integration.connection?.status === "CONNECTED" ? (
                          <Badge tone="success" dot>Verbunden</Badge>
                        ) : integration.connection?.status === "ERROR" ? (
                          <Badge tone="danger" dot>Fehler</Badge>
                        ) : integration.implemented ? (
                          <Badge tone="neutral">Nicht verbunden</Badge>
                        ) : (
                          <Badge tone="warning">Adapter noch nicht implementiert</Badge>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-ink-600">{integration.summary}</p>

                      {integration.connection ? (
                        <p className="mt-1.5 text-2xs text-ink-500">
                          {integration.connection.host}:{integration.connection.port} als {integration.connection.user}
                          {integration.connection.fromAddress ? ` · Absender ${integration.connection.fromAddress}` : ""}
                          {integration.connection.connectedAt ? ` · verbunden seit ${formatDate(integration.connection.connectedAt)}` : ""}
                        </p>
                      ) : (
                        <ul className="mt-1.5 space-y-0.5">
                          {integration.requires.map((requirement) => (
                            <li key={requirement} className="flex items-start gap-1.5 text-2xs text-ink-500">
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" />
                              {requirement}
                            </li>
                          ))}
                        </ul>
                      )}

                      {integration.connection?.lastError ? (
                        <p className="mt-1.5 rounded-md bg-danger-50 px-2.5 py-1.5 text-2xs text-danger-700">
                          {integration.connection.lastError}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {integration.provider === "SMTP" ? (
                        integration.connection ? (
                          <>
                            <Button
                              size="sm"
                              icon={<RefreshCw className="h-3.5 w-3.5" />}
                              loading={busyId === integration.connection.id}
                              onClick={() => void test(integration.connection!.id)}
                            >
                              Prüfen
                            </Button>
                            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDisconnecting(integration)}>
                              Trennen
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="primary" onClick={() => setConnecting(true)}>
                            Verbinden
                          </Button>
                        )
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>

      <SmtpDialog
        open={connecting}
        onClose={() => setConnecting(false)}
        onConnected={async () => {
          setConnecting(false);
          await reload();
          toast.success("Postausgang verbunden", "Die Zugangsdaten wurden vor dem Speichern geprüft.");
        }}
      />

      <ConfirmDialog
        open={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        title="Verbindung trennen?"
        description={`Nach dem Trennen versendet OKUN CRM keine E-Mails mehr über ${disconnecting?.name ?? ""}. Gespeicherte Nachrichten bleiben erhalten.`}
        confirmLabel="Trennen"
        onConfirm={async () => {
          const id = disconnecting?.connection?.id;
          setDisconnecting(null);
          if (!id) return;
          try {
            await api.delete(`/api/v1/integrations/${id}`);
            await reload();
            toast.success("Verbindung getrennt");
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "Die Verbindung konnte nicht getrennt werden.");
          }
        }}
      />
    </>
  );
}

function SmtpDialog({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [values, setValues] = React.useState({
    host: "",
    port: "587",
    secure: false,
    user: "",
    password: "",
    fromAddress: "",
    fromName: "",
  });
  const [busy, setBusy] = React.useState(false);
  const [fields, setFields] = React.useState<Record<string, string>>({});

  function set(key: keyof typeof values, value: string | boolean) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="SMTP-Postausgang verbinden"
      description="Die Zugangsdaten werden vor dem Speichern geprüft. Das Passwort wird verschlüsselt abgelegt und nie wieder angezeigt."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!values.host.trim() || !values.user.trim() || !values.password || !values.fromAddress.trim()}
            onClick={async () => {
              setBusy(true);
              setFields({});
              try {
                await api.put("/api/v1/integrations/smtp", {
                  ...values,
                  port: Number(values.port),
                  fromName: values.fromName.trim() || undefined,
                });
                await onConnected();
              } catch (error) {
                if (error instanceof ApiError) {
                  setFields(error.fields);
                  toast.error(error.message);
                } else {
                  toast.error("Die Verbindung konnte nicht hergestellt werden.");
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Prüfen und verbinden
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <Field label="Host" htmlFor="smtp-host" required error={fields.host}>
            <Input id="smtp-host" value={values.host} placeholder="mail.ihre-domain.de" onChange={(event) => set("host", event.target.value)} />
          </Field>
          <Field label="Port" htmlFor="smtp-port" required error={fields.port}>
            <Input id="smtp-port" type="number" value={values.port} onChange={(event) => set("port", event.target.value)} />
          </Field>
        </div>

        <label className="flex items-start gap-2.5">
          <Checkbox checked={values.secure} onChange={(event) => set("secure", event.target.checked)} />
          <span>
            <span className="block text-sm text-ink-800">Implizites TLS</span>
            <span className="block text-2xs text-ink-500">Für Port 465. Bei 587 bleibt dies aus — dort wird STARTTLS genutzt.</span>
          </span>
        </label>

        <Field label="Benutzername" htmlFor="smtp-user" required error={fields.user}>
          <Input id="smtp-user" value={values.user} autoComplete="off" onChange={(event) => set("user", event.target.value)} />
        </Field>
        <Field label="Passwort" htmlFor="smtp-password" required error={fields.password}>
          <Input id="smtp-password" type="password" value={values.password} autoComplete="new-password" onChange={(event) => set("password", event.target.value)} />
        </Field>
        <Field label="Absenderadresse" htmlFor="smtp-from" required error={fields.fromAddress}>
          <Input id="smtp-from" type="email" value={values.fromAddress} placeholder="crm@ihre-domain.de" onChange={(event) => set("fromAddress", event.target.value)} />
        </Field>
        <Field label="Absendername" htmlFor="smtp-from-name" hint="Optional, erscheint im Postfach der Empfänger.">
          <Input id="smtp-from-name" value={values.fromName} onChange={(event) => set("fromName", event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

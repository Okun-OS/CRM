"use client";

import * as React from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { API_KEY_SCOPES, API_KEY_SCOPE_LABELS, type ApiKeyScope } from "@/lib/crm/api-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export function ApiKeysView({ initial }: { initial: ApiKey[] }) {
  const toast = useToast();
  const [keys, setKeys] = React.useState(initial);
  const [creating, setCreating] = React.useState(false);
  const [revoking, setRevoking] = React.useState<ApiKey | null>(null);
  const [issued, setIssued] = React.useState<{ name: string; key: string } | null>(null);

  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<ApiKeyScope[]>(["events:write"]);
  const [busy, setBusy] = React.useState(false);

  async function reload() {
    setKeys(await api.get<ApiKey[]>("/api/v1/settings/api-keys"));
  }

  async function create() {
    setBusy(true);
    try {
      const created = await api.post<{ name: string; key: string }>("/api/v1/settings/api-keys", { name: name.trim(), scopes });
      setIssued(created);
      setCreating(false);
      setName("");
      await reload();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der API-Key konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKey) {
    try {
      await api.delete(`/api/v1/settings/api-keys/${key.id}`);
      toast.success("API-Key widerrufen", key.name);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der API-Key konnte nicht widerrufen werden.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Schlüssel"
          description="Ein Schlüssel gilt ausschließlich für diese Organisation. Der Klartext wird genau einmal angezeigt."
          action={
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
              API-Key erstellen
            </Button>
          }
        />
        <CardBody className={keys.length === 0 ? undefined : "p-0"}>
          {keys.length === 0 ? (
            <EmptyState
              compact
              icon={<KeyRound className="h-5 w-5" />}
              title="Noch kein API-Key"
              description="Erstellen Sie einen Schlüssel, damit ein anderes System Ereignisse an OKUN CRM melden darf."
            />
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
                      <code>{key.prefix}…</code> · erstellt {formatDateTime(key.createdAt)}
                      {key.createdBy ? ` von ${key.createdBy.name}` : ""} ·{" "}
                      {key.lastUsedAt ? `zuletzt genutzt ${formatDateTime(key.lastUsedAt)}` : "noch nicht genutzt"}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <Badge key={scope} tone="neutral">
                          {API_KEY_SCOPE_LABELS[scope as ApiKeyScope] ?? scope}
                        </Badge>
                      ))}
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
        title="API-Key erstellen"
        description="Der Schlüssel erhält nur die hier gewählten Rechte."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Abbrechen</Button>
            <Button variant="primary" loading={busy} disabled={!name.trim() || scopes.length === 0} onClick={() => void create()}>
              Erstellen
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" htmlFor="api-key-name" required hint="Woran erkennen Sie später, wofür dieser Schlüssel gilt?">
            <Input
              id="api-key-name"
              value={name}
              maxLength={80}
              placeholder="z. B. OKUN Deals Produktion"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Rechte" required>
            <div className="space-y-2">
              {API_KEY_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm text-ink-700">
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onChange={(event) =>
                      setScopes(event.target.checked ? [...scopes, scope] : scopes.filter((entry) => entry !== scope))
                    }
                  />
                  {API_KEY_SCOPE_LABELS[scope]}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="API-Key erstellt"
        description="Kopieren Sie den Schlüssel jetzt — er wird nicht erneut angezeigt und kann nicht wiederhergestellt werden."
        size="sm"
        footer={<Button variant="primary" onClick={() => setIssued(null)}>Fertig</Button>}
      >
        <div className="space-y-2">
          <code className="block break-all rounded-md bg-ink-900 px-3 py-2.5 text-xs text-white">{issued?.key}</code>
          <Button
            size="sm"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => {
              void navigator.clipboard.writeText(issued?.key ?? "");
              toast.success("In die Zwischenablage kopiert");
            }}
          >
            Kopieren
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => void revoke(revoking as ApiKey)}
        title="API-Key widerrufen?"
        description={`Systeme, die „${revoking?.name ?? ""}" verwenden, können danach keine Ereignisse mehr melden.`}
        confirmLabel="Widerrufen"
      />
    </>
  );
}

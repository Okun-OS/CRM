"use client";

import * as React from "react";
import { Ban, Pause, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Drawer, Modal, ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

type Account = {
  id: string;
  label: string;
  fromName: string;
  fromEmail: string;
  status: "ACTIVE" | "PAUSED" | "ERROR";
  dailyLimit: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  sendDays: number[];
  timezone: string;
  minGapSeconds: number;
  maxGapSeconds: number;
  signatureHtml: string | null;
  pausedReason: string | null;
  sentToday: number;
};

type Suppression = {
  id: string;
  scope: "EMAIL" | "DOMAIN";
  value: string;
  reason: string;
  note: string | null;
  createdAt: string;
};

const REASONS: Record<string, string> = {
  UNSUBSCRIBED: "Abgemeldet",
  BOUNCED: "Unzustellbar",
  COMPLAINT: "Beschwerde",
  MANUAL: "Von Hand gesperrt",
  DO_NOT_CONTACT: "Kontaktsperre",
};

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function SendingView() {
  const toast = useToast();
  const [accounts, setAccounts] = React.useState<Account[] | null>(null);
  const [suppression, setSuppression] = React.useState<Suppression[] | null>(null);
  const [editing, setEditing] = React.useState<"new" | Account | null>(null);
  const [pausing, setPausing] = React.useState<Account | null>(null);
  const [deleting, setDeleting] = React.useState<Account | null>(null);
  const [addingBlock, setAddingBlock] = React.useState(false);

  const load = React.useCallback(async () => {
    const [a, s] = await Promise.all([
      api.get<Account[]>("/api/v1/outreach/sending-accounts").catch(() => []),
      api.get<Suppression[]>("/api/v1/outreach/suppression").catch(() => []),
    ]);
    setAccounts(a);
    setSuppression(s);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, body: unknown, message: string) {
    try {
      await api.post(path, body);
      toast.success(message);
      void load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Aktion ist fehlgeschlagen.");
    }
  }

  if (!accounts || !suppression) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Versandkonten"
          description="Jedes Konto sendet nach eigenen Regeln: Tageslimit, Sendefenster und gestreute Abstände."
          action={
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setEditing("new")}
              data-tour="sending-account-create"
            >
              Konto einrichten
            </Button>
          }
        />
        <CardBody className="p-0">
          {accounts.length === 0 ? (
            <EmptyState
              title="Noch kein Versandkonto"
              description="Ohne Versandkonto lassen sich Sequenzen mit automatischen E-Mails nicht aktivieren — es wird nichts gesendet und nichts vorgetäuscht."
              actions={<Button variant="primary" onClick={() => setEditing("new")}>Konto einrichten</Button>}
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {accounts.map((account) => (
                <li key={account.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">{account.label}</span>
                      <Badge tone={account.status === "ACTIVE" ? "success" : account.status === "PAUSED" ? "warning" : "danger"}>
                        {account.status === "ACTIVE" ? "aktiv" : account.status === "PAUSED" ? "pausiert" : "Fehler"}
                      </Badge>
                    </div>
                    <p className="text-xs text-ink-500">
                      {account.fromName} &lt;{account.fromEmail}&gt;
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      Heute {account.sentToday} von {account.dailyLimit} · {account.sendWindowStart}–{account.sendWindowEnd} Uhr ·{" "}
                      {account.sendDays.map((day) => DAY_NAMES[day - 1]).join(" ")} · {account.timezone}
                    </p>
                    {account.pausedReason ? (
                      <p className="mt-1 text-xs text-warning-700">Pausiert: {account.pausedReason}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {account.status === "ACTIVE" ? (
                      <Button size="sm" icon={<Pause className="h-3.5 w-3.5" />} onClick={() => setPausing(account)}>
                        Pausieren
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Play className="h-3.5 w-3.5" />}
                        onClick={() => act(`/api/v1/outreach/sending-accounts/${account.id}`, { action: "resume" }, "Konto fortgesetzt.")}
                      >
                        Fortsetzen
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(account)}>
                      Bearbeiten
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleting(account)} aria-label="Entfernen">
                      <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Kontaktsperre"
          description="Adressen und Domains, an die nicht gesendet wird. Die Sperre überlebt den einzelnen Datensatz — auch einen erneuten Import."
          action={
            <Button
              size="sm"
              icon={<Ban className="h-3.5 w-3.5" />}
              onClick={() => setAddingBlock(true)}
              data-tour="suppression-add"
            >
              Sperre hinzufügen
            </Button>
          }
        />
        <CardBody className="p-0">
          {suppression.length === 0 ? (
            <p className="px-5 py-5 text-sm text-ink-500">Keine Sperren eingetragen.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {suppression.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
                  <span className="min-w-0">
                    <span className="text-sm text-ink-900">{entry.value}</span>
                    {entry.scope === "DOMAIN" ? <Badge className="ml-2">ganze Domain</Badge> : null}
                    {entry.note ? <p className="text-2xs text-ink-400">{entry.note}</p> : null}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-ink-500">
                    {REASONS[entry.reason] ?? entry.reason}
                    <span className="text-ink-400">{formatDate(entry.createdAt)}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Sperre aufheben"
                      onClick={async () => {
                        try {
                          await api.delete(`/api/v1/outreach/suppression/${entry.id}`);
                          toast.success("Sperre aufgehoben.");
                          void load();
                        } catch (cause) {
                          toast.error(cause instanceof ApiError ? cause.message : "Fehlgeschlagen.");
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Versandkonto einrichten" : "Versandkonto bearbeiten"}
      >
        {editing ? (
          <AccountForm
            account={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              void load();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Drawer>

      <PauseDialog
        account={pausing}
        onClose={() => setPausing(null)}
        onConfirm={(reason) => {
          const account = pausing;
          setPausing(null);
          if (account) void act(`/api/v1/outreach/sending-accounts/${account.id}`, { action: "pause", reason }, "Konto pausiert.");
        }}
      />

      <BlockDialog
        open={addingBlock}
        onClose={() => setAddingBlock(false)}
        onDone={() => {
          setAddingBlock(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Versandkonto entfernen"
        description="Sequenzen, die über dieses Konto senden, müssen zuvor ein anderes bekommen."
        confirmLabel="Entfernen"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api.delete(`/api/v1/outreach/sending-accounts/${deleting.id}`);
            toast.success("Konto entfernt.");
            setDeleting(null);
            void load();
          } catch (cause) {
            toast.error(cause instanceof ApiError ? cause.message : "Fehlgeschlagen.");
          }
        }}
      />
    </div>
  );
}

function AccountForm({
  account,
  onDone,
  onCancel,
}: {
  account: Account | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = React.useState({
    label: account?.label ?? "",
    fromName: account?.fromName ?? "",
    fromEmail: account?.fromEmail ?? "",
    dailyLimit: String(account?.dailyLimit ?? 50),
    sendWindowStart: String(account?.sendWindowStart ?? 8),
    sendWindowEnd: String(account?.sendWindowEnd ?? 18),
    timezone: account?.timezone ?? "Europe/Berlin",
    minGapSeconds: String(account?.minGapSeconds ?? 90),
    maxGapSeconds: String(account?.maxGapSeconds ?? 600),
    signatureHtml: account?.signatureHtml ?? "",
  });
  const [sendDays, setSendDays] = React.useState<number[]>(account?.sendDays ?? [1, 2, 3, 4, 5]);
  const [pending, setPending] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFieldErrors({});
    try {
      const body = {
        ...values,
        dailyLimit: Number(values.dailyLimit),
        sendWindowStart: Number(values.sendWindowStart),
        sendWindowEnd: Number(values.sendWindowEnd),
        minGapSeconds: Number(values.minGapSeconds),
        maxGapSeconds: Number(values.maxGapSeconds),
        signatureHtml: values.signatureHtml || undefined,
        sendDays,
      };
      if (account) await api.put(`/api/v1/outreach/sending-accounts/${account.id}`, body);
      else await api.post("/api/v1/outreach/sending-accounts", body);
      toast.success(account ? "Konto gespeichert." : "Konto eingerichtet.");
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) setFieldErrors(cause.fields);
      toast.error(cause instanceof ApiError ? cause.message : "Das Konto konnte nicht gespeichert werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bezeichnung" htmlFor="label" error={fieldErrors.label} required>
          <Input id="label" value={values.label} onChange={(e) => set("label", e.target.value)} autoFocus required />
        </Field>
        <Field label="Absendername" htmlFor="fromName" error={fieldErrors.fromName} required>
          <Input id="fromName" value={values.fromName} onChange={(e) => set("fromName", e.target.value)} required />
        </Field>
        <Field label="Absenderadresse" htmlFor="fromEmail" error={fieldErrors.fromEmail} required className="sm:col-span-2">
          <Input id="fromEmail" type="email" value={values.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} required />
        </Field>
      </div>

      <div className="border-t border-ink-200 pt-4">
        <p className="mb-3 text-2xs font-semibold uppercase tracking-wider text-ink-400">Versandregeln</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nachrichten pro Tag" htmlFor="dailyLimit" error={fieldErrors.dailyLimit}>
            <Input id="dailyLimit" type="number" min={1} max={500} value={values.dailyLimit} onChange={(e) => set("dailyLimit", e.target.value)} />
          </Field>
          <Field label="Zeitzone" htmlFor="timezone" error={fieldErrors.timezone}>
            <Input id="timezone" value={values.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Field>
          <Field label="Fenster von (Stunde)" htmlFor="sendWindowStart">
            <Input id="sendWindowStart" type="number" min={0} max={23} value={values.sendWindowStart} onChange={(e) => set("sendWindowStart", e.target.value)} />
          </Field>
          <Field label="Fenster bis (Stunde)" htmlFor="sendWindowEnd">
            <Input id="sendWindowEnd" type="number" min={1} max={24} value={values.sendWindowEnd} onChange={(e) => set("sendWindowEnd", e.target.value)} />
          </Field>
          <Field label="Kleinster Abstand (Sekunden)" htmlFor="minGapSeconds">
            <Input id="minGapSeconds" type="number" min={15} value={values.minGapSeconds} onChange={(e) => set("minGapSeconds", e.target.value)} />
          </Field>
          <Field label="Größter Abstand (Sekunden)" htmlFor="maxGapSeconds">
            <Input id="maxGapSeconds" type="number" min={15} value={values.maxGapSeconds} onChange={(e) => set("maxGapSeconds", e.target.value)} />
          </Field>
        </div>

        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-ink-700">Sendetage</p>
          <div className="flex flex-wrap gap-1.5">
            {DAY_NAMES.map((name, index) => {
              const day = index + 1;
              const active = sendDays.includes(day);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSendDays((current) => (active ? current.filter((d) => d !== day) : [...current, day].sort()))}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    active ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500 hover:bg-ink-50"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        <p className="mt-3 rounded-md bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          Der Abstand zwischen zwei Nachrichten wird innerhalb dieser Grenzen zufällig gewählt. Gleichmäßige Abstände
          sind das auffälligste Merkmal maschinellen Versands — die Streuung ist deshalb kein Schmuck.
        </p>
      </div>

      <Field label="Signatur (HTML)" htmlFor="signatureHtml">
        <Textarea id="signatureHtml" rows={3} value={values.signatureHtml} onChange={(e) => set("signatureHtml", e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>Abbrechen</Button>
        <Button type="submit" variant="primary" loading={pending}>
          {account ? "Änderungen speichern" : "Konto einrichten"}
        </Button>
      </div>
    </form>
  );
}

function PauseDialog({
  account,
  onClose,
  onConfirm,
}: {
  account: Account | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (account) setReason("");
  }, [account]);

  return (
    <Modal
      open={account !== null}
      onClose={onClose}
      title="Versandkonto pausieren"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => onConfirm(reason)} disabled={!reason.trim()}>
            Pausieren
          </Button>
        </>
      }
    >
      <Field label="Grund" htmlFor="pauseReason" required>
        <Input
          id="pauseReason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="z. B. auffällig viele Rückläufer"
        />
      </Field>
      <p className="mt-2 text-xs text-ink-500">
        Der Grund erscheint überall dort, wo das Konto auftaucht — pausiert wird nie stillschweigend.
      </p>
    </Modal>
  );
}

function BlockDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [scope, setScope] = React.useState<"EMAIL" | "DOMAIN">("EMAIL");
  const [value, setValue] = React.useState("");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit() {
    setPending(true);
    try {
      await api.post("/api/v1/outreach/suppression", { scope, value, reason: "MANUAL", note: note || undefined });
      toast.success("Sperre eingetragen.");
      setValue("");
      setNote("");
      onDone();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Sperre konnte nicht eingetragen werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Kontaktsperre hinzufügen"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!value.trim()}>
            Sperren
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Umfang" htmlFor="scope">
          <Select id="scope" value={scope} onChange={(event) => setScope(event.target.value as "EMAIL" | "DOMAIN")}>
            <option value="EMAIL">Einzelne Adresse</option>
            <option value="DOMAIN">Ganze Domain</option>
          </Select>
        </Field>
        <Field label={scope === "EMAIL" ? "E-Mail-Adresse" : "Domain"} htmlFor="value" required>
          <Input
            id="value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={scope === "EMAIL" ? "name@beispiel.de" : "beispiel.de"}
          />
        </Field>
        <Field label="Notiz" htmlFor="note">
          <Input id="note" value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

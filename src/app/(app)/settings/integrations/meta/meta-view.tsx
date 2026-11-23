"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Copy, Download, ExternalLink, Mail, RefreshCw, Trash2, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime as formatDateTimeNow } from "@/lib/format";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useReference } from "@/components/app/reference-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type Page = {
  id: string;
  pageId: string;
  pageName: string;
  ownerId: string | null;
  notifyEmails: string[];
  isActive: boolean;
  lastLeadAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
};

type LeadEvent = {
  id: string;
  pageId: string;
  origin: string;
  status: "PENDING" | "CREATED" | "MERGED" | "FAILED";
  attempts: number;
  leadId: string | null;
  summary: {
    name?: string;
    platform?: string;
    formName?: string | null;
    campaignName?: string | null;
    emailSent?: boolean;
    emailReason?: string | null;
  } | null;
  error: string | null;
  receivedAt: string;
  nextAttemptAt: string | null;
};

type Overview = {
  missingConfig: string[];
  webhookUrl: string;
  graphVersion: string;
  permissions: string[];
  pages: Page[];
  events: LeadEvent[];
};

const STATUS: Record<LeadEvent["status"], { label: string; tone: "success" | "brand" | "warning" | "danger" }> = {
  CREATED: { label: "Angelegt", tone: "success" },
  MERGED: { label: "Zu offenem Lead", tone: "brand" },
  PENDING: { label: "Wird abgeholt", tone: "warning" },
  FAILED: { label: "Fehlgeschlagen", tone: "danger" },
};

export function MetaView({ initial }: { initial: Overview }) {
  const toast = useToast();
  const [overview, setOverview] = React.useState(initial);

  const reload = React.useCallback(async () => {
    setOverview(await api.get<Overview>("/api/v1/settings/meta"));
  }, []);

  const copy = React.useCallback(
    async (value: string, label = "Kopiert") => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(label);
      } catch {
        toast.error("Kopieren nicht möglich", "Bitte von Hand markieren.");
      }
    },
    [toast],
  );

  return (
    <div className="space-y-5">
      <SetupCard overview={overview} onCopy={copy} />
      <ConnectCard overview={overview} onConnected={reload} />
      {overview.pages.length > 0 ? (
        <Card>
          <CardHeader
            title="Verbundene Seiten"
            description="Jede neue Formular-Einsendung dieser Seiten wird als Lead angelegt; die eingetragenen Adressen bekommen eine E-Mail."
          />
          <CardBody className="space-y-4">
            {overview.pages.map((page) => (
              <PageSettings key={page.id} page={page} onChanged={reload} />
            ))}
          </CardBody>
        </Card>
      ) : null}
      <EventsCard events={overview.events} pages={overview.pages} onChanged={reload} />
    </div>
  );
}

function SetupCard({ overview, onCopy }: { overview: Overview; onCopy: (value: string, label?: string) => void }) {
  const ready = overview.missingConfig.length === 0;
  return (
    <Card>
      <CardHeader
        title="Einrichtung bei Meta"
        description="Einmalig: eine Meta-App, drei Variablen auf Railway und die Webhook-Adresse unten in der App eintragen."
        action={ready ? <Badge tone="success" dot>Bereit</Badge> : <Badge tone="warning" dot>Unvollständig</Badge>}
      />
      <CardBody className="space-y-4 text-xs text-ink-700">
        <ul className="space-y-1.5">
          {["META_APP_ID", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN"].map((name) => {
            const missing = overview.missingConfig.includes(name);
            return (
              <li key={name} className="flex items-center gap-2">
                {missing ? <XCircle className="h-4 w-4 text-danger-500" /> : <CheckCircle2 className="h-4 w-4 text-success-500" />}
                <code className="font-mono">{name}</code>
                <span className="text-ink-500">{missing ? "fehlt auf Railway (Dienst → Variables)" : "gesetzt"}</span>
              </li>
            );
          })}
        </ul>
        <div className="space-y-1.5">
          <p className="font-medium text-ink-800">Webhook-Adresse für die Meta-App</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-800">{overview.webhookUrl}</code>
            <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => onCopy(overview.webhookUrl, "Adresse kopiert")}>
              Kopieren
            </Button>
          </div>
          <p className="text-ink-500">
            In der Meta-App unter <strong>Webhooks</strong> das Objekt <strong>Page</strong> wählen, diese Adresse und als
            Bestätigungs-Token den Wert von <code className="font-mono">META_WEBHOOK_VERIFY_TOKEN</code> eintragen und das
            Feld <strong>leadgen</strong> abonnieren.
          </p>
        </div>
        <details>
          <summary className="cursor-pointer font-medium text-brand-600 hover:text-brand-700">Schritt für Schritt</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-600">
            <li>
              Auf{" "}
              <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:underline">
                developers.facebook.com/apps
              </a>{" "}
              eine App vom Typ <strong>Business</strong> anlegen und mit Ihrem Business-Portfolio verknüpfen.
            </li>
            <li>
              Unter <em>App-Einstellungen → Allgemein</em> App-ID und App-Geheimcode kopieren und auf Railway als{" "}
              <code className="font-mono">META_APP_ID</code> und <code className="font-mono">META_APP_SECRET</code> eintragen. Für{" "}
              <code className="font-mono">META_WEBHOOK_VERIFY_TOKEN</code> eine beliebige lange Zeichenfolge wählen.
            </li>
            <li>Das Produkt <strong>Webhooks</strong> hinzufügen und wie oben beschrieben einrichten.</li>
            <li>Im Abschnitt unten mit einem Zugriffstoken die Facebook-Seite verbinden.</li>
            <li>
              Testen: Im Entwicklungsmodus liest die App nur Leads von Personen mit einer Rolle in der App. Füllen Sie das
              Formular also selbst aus, etwa über die Vorschau der Anzeige. Der Lead erscheint nach wenigen Sekunden unten
              und im CRM.
            </li>
            <li>
              Für echte Leads: Bei Meta die App-Prüfung für <code className="font-mono">leads_retrieval</code> und{" "}
              <code className="font-mono">pages_manage_ads</code> sowie die Unternehmensverifizierung beantragen, danach die
              App auf <strong>Live</strong> stellen.
            </li>
          </ol>
        </details>
      </CardBody>
    </Card>
  );
}

function ConnectCard({ overview, onConnected }: { overview: Overview; onConnected: () => Promise<void> }) {
  const toast = useToast();
  const [token, setToken] = React.useState("");
  const [pages, setPages] = React.useState<{ id: string; name: string; connected: boolean; connectedElsewhere: boolean }[] | null>(null);
  const [missingPermissions, setMissingPermissions] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<"lookup" | "connect" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function lookup() {
    setBusy("lookup");
    setError(null);
    try {
      const found = await api.post<{ pages: NonNullable<typeof pages>; missingPermissions: string[] }>(
        "/api/v1/settings/meta/pages/lookup",
        { accessToken: token },
      );
      setPages(found.pages);
      setMissingPermissions(found.missingPermissions);
      setSelected(found.pages.filter((page) => !page.connected && !page.connectedElsewhere).map((page) => page.id).slice(0, 1));
    } catch (cause) {
      setPages(null);
      setMissingPermissions([]);
      setError(cause instanceof ApiError ? cause.message : "Die Seiten konnten nicht geladen werden.");
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      const result = await api.post<{ connected: string[] }>("/api/v1/settings/meta/pages", { accessToken: token, pageIds: selected });
      toast.success("Verbunden", result.connected.join(", "));
      setToken("");
      setPages(null);
      setMissingPermissions([]);
      setSelected([]);
      await onConnected();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Verbindung ist fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Facebook-Seite verbinden"
        description="Mit einem Zugriffstoken einer Person, die auf der Seite werben darf. Das CRM tauscht es gegen ein dauerhaftes Seiten-Token und speichert nur dieses, verschlüsselt."
      />
      <CardBody className="space-y-3">
        {overview.missingConfig.length > 0 ? (
          <p className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-800">
            Erst die Einrichtung oben abschließen: Ohne App-Geheimnis kann das CRM die Meldungen von Meta nicht prüfen.
          </p>
        ) : null}
        <Field
          label="Zugriffstoken"
          htmlFor="meta-token"
          error={error}
          hint="Im Graph API Explorer Ihre App wählen, „Nutzer-Token“ erzeugen, diese Berechtigungen erlauben und im Bestätigungsfenster die Seite auswählen (business_management braucht es, wenn die Seite zu einem Business-Portfolio gehört):"
        >
          <Textarea
            id="meta-token"
            rows={2}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="EAAG…"
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <p className="-mt-1 flex flex-wrap gap-1">
          {overview.permissions.map((permission) => (
            <code key={permission} className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-2xs text-ink-700">
              {permission}
            </code>
          ))}
          <a
            href="https://developers.facebook.com/tools/explorer/"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-1 inline-flex items-center gap-1 text-2xs text-brand-600 hover:underline"
          >
            Graph API Explorer <ExternalLink className="h-3 w-3" />
          </a>
        </p>
        <div>
          <Button onClick={() => void lookup()} loading={busy === "lookup"} disabled={token.trim().length < 20}>
            Seiten laden
          </Button>
        </div>

        {pages ? (
          <div className="space-y-2 rounded-md border border-ink-200 p-3">
            {missingPermissions.length > 0 ? (
              <p className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-800">
                Dem Token fehlt {missingPermissions.join(", ")}. Ohne {missingPermissions.length === 1 ? "diese Berechtigung" : "diese Berechtigungen"}{" "}
                kann das CRM die Leads nicht abholen. Bitte im Graph API Explorer anhaken und ein neues Token erzeugen.
              </p>
            ) : null}
            <p className="text-xs font-medium text-ink-800">Welche Seite soll Leads ins CRM schicken?</p>
            {pages.map((page) => (
              <label key={page.id} className="flex items-center gap-2 text-sm text-ink-800">
                <Checkbox
                  checked={selected.includes(page.id)}
                  disabled={page.connectedElsewhere}
                  onChange={(event) =>
                    setSelected((current) => (event.target.checked ? [...current, page.id] : current.filter((id) => id !== page.id)))
                  }
                />
                {page.name}
                {page.connected ? <Badge tone="success">schon verbunden</Badge> : null}
                {page.connectedElsewhere ? <Badge tone="warning">in anderem Arbeitsbereich</Badge> : null}
              </label>
            ))}
            <Button variant="primary" loading={busy === "connect"} disabled={selected.length === 0} onClick={() => void connect()}>
              Verbinden
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function PageSettings({ page, onChanged }: { page: Page; onChanged: () => Promise<void> }) {
  const hydrated = useHydrated();
  const formatDateTime = (value: string) => (hydrated ? formatDateTimeNow(value) : "");
  const toast = useToast();
  const { data } = useReference();
  const [ownerId, setOwnerId] = React.useState(page.ownerId ?? "");
  const [emails, setEmails] = React.useState(page.notifyEmails.join(", "));
  const [busy, setBusy] = React.useState<"save" | "test" | "toggle" | "remove" | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  async function save() {
    setBusy("save");
    try {
      await api.patch(`/api/v1/settings/meta/pages/${page.id}`, {
        ownerId: ownerId || null,
        notifyEmails: emails.split(/[,;\s]+/).filter(Boolean),
      });
      toast.success("Gespeichert");
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const result = await api.post<{ sent: boolean; reason: string | null; recipients: string[] }>(
        `/api/v1/settings/meta/pages/${page.id}/test`,
        {},
      );
      if (result.sent) toast.success("Test-E-Mail verschickt", result.recipients.join(", "));
      else toast.error("Test-E-Mail nicht verschickt", result.reason ?? undefined);
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Test-E-Mail ist fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  async function toggle() {
    setBusy("toggle");
    try {
      await api.patch(`/api/v1/settings/meta/pages/${page.id}`, { isActive: !page.isActive });
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      await api.delete(`/api/v1/settings/meta/pages/${page.id}`);
      toast.success("Getrennt", page.pageName);
      setRemoving(false);
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Trennen fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-ink-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            {page.pageName}
            {page.lastError ? (
              <Badge tone="danger" dot>Fehler</Badge>
            ) : page.isActive ? (
              <Badge tone="success" dot>Aktiv</Badge>
            ) : (
              <Badge tone="neutral">Pausiert</Badge>
            )}
          </p>
          <p className="mt-0.5 text-2xs text-ink-500">
            {page.lastLeadAt ? `Letzter Lead ${formatDateTime(page.lastLeadAt)}` : "Noch kein Lead eingegangen"} · verbunden{" "}
            {formatDateTime(page.createdAt)}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" loading={busy === "toggle"} onClick={() => void toggle()}>
            {page.isActive ? "Pausieren" : "Fortsetzen"}
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setRemoving(true)}>
            Trennen
          </Button>
        </div>
      </div>

      {page.lastError ? (
        <p className="mt-2 rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-700">
          {page.lastError}
          {page.lastErrorAt ? <span className="block text-2xs opacity-75">{formatDateTime(page.lastErrorAt)}</span> : null}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Neue Leads gehören" htmlFor={`owner-${page.id}`}>
          <Select id={`owner-${page.id}`} value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">Person, die verbunden hat</option>
            {data?.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="E-Mail bei neuem Lead an"
          htmlFor={`emails-${page.id}`}
          hint="Mehrere Adressen mit Komma trennen. Leer lassen, wenn keine E-Mail gewünscht ist."
        >
          <Input id={`emails-${page.id}`} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="vertrieb@firma.de" />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={busy === "save"} onClick={() => void save()}>
          Speichern
        </Button>
        <Button size="sm" icon={<Mail className="h-3.5 w-3.5" />} loading={busy === "test"} onClick={() => void test()}>
          Test-E-Mail senden
        </Button>
        <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setImporting(true)}>
          Bestehende Leads importieren
        </Button>
      </div>

      <ImportDialog page={page} open={importing} onClose={() => setImporting(false)} onImported={onChanged} />

      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={() => void remove()}
        loading={busy === "remove"}
        title="Seite trennen?"
        description={`Neue Leads von „${page.pageName}“ kommen danach nicht mehr im CRM an. Bereits angelegte Leads bleiben.`}
        confirmLabel="Trennen"
      />
    </div>
  );
}

type ImportResult = {
  forms: { id: string; name: string; found: number; added: number; completed: number }[];
  found: number;
  added: number;
  alreadyKnown: number;
  completed: number;
  limited: boolean;
};

/** Übernimmt Einsendungen, die vor dem Verbinden eingegangen sind. */
function ImportDialog({ page, open, onClose, onImported }: { page: Page; open: boolean; onClose: () => void; onImported: () => Promise<void> }) {
  const [range, setRange] = React.useState<"all" | "30" | "90" | "date">("all");
  const [since, setSince] = React.useState("");
  const [formIds, setFormIds] = React.useState("");
  const [needsFormIds, setNeedsFormIds] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  function close() {
    setResult(null);
    setError(null);
    onClose();
  }

  async function start() {
    setBusy(true);
    setError(null);
    const sinceValue =
      range === "all"
        ? null
        : range === "date"
          ? since || null
          : new Date(Date.now() - Number(range) * 86_400_000).toISOString();
    try {
      const response = await api.post<ImportResult>(`/api/v1/settings/meta/pages/${page.id}/import`, {
        since: sinceValue,
        formIds: formIds.split(/[,;\s]+/).filter(Boolean),
      });
      setResult(response);
      await onImported();
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields.formIds) setNeedsFormIds(true);
      setError(cause instanceof ApiError ? cause.message : "Der Import ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Bestehende Leads importieren"
      description={`Übernimmt Formular-Einsendungen von „${page.pageName}“, die vor dem Verbinden eingegangen sind. Leads, die schon im CRM sind, werden um fehlende Angaben wie Name, E-Mail oder Telefon ergänzt.`}
      footer={
        result ? (
          <Button variant="primary" onClick={close}>
            Fertig
          </Button>
        ) : (
          <>
            <Button onClick={close} disabled={busy}>
              Abbrechen
            </Button>
            <Button variant="primary" loading={busy} disabled={range === "date" && !since} onClick={() => void start()}>
              Importieren
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm text-ink-700">
          {result.added > 0 ? (
            <p>
              <strong>{result.added}</strong> {result.added === 1 ? "Einsendung wird" : "Einsendungen werden"} jetzt übernommen
              {result.alreadyKnown > 0 ? `, ${result.alreadyKnown} waren schon im CRM` : ""}. Sie erhalten eine Meldung in der Glocke,
              sobald alles angelegt ist.
            </p>
          ) : (
            <p>Keine neuen Einsendungen{result.alreadyKnown > 0 ? `: Alle ${result.alreadyKnown} waren schon im CRM` : ""}.</p>
          )}
          {result.completed > 0 ? (
            <p>
              Bei <strong>{result.completed}</strong> {result.completed === 1 ? "Lead, der schon im CRM war, wurden" : "Leads, die schon im CRM waren, wurden"}{" "}
              fehlende Angaben wie Name, E-Mail oder Telefon ergänzt.
            </p>
          ) : null}
          <ul className="space-y-1 text-xs text-ink-600">
            {result.forms.map((form) => (
              <li key={form.id}>
                {form.name}: {form.found} gefunden, {form.added} neu{form.completed ? `, ${form.completed} ergänzt` : ""}
              </li>
            ))}
          </ul>
          {result.limited ? (
            <p className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-800">
              Es waren mehr als 5000 Einsendungen. Den Rest übernimmt ein weiterer Import.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {error ? <p className="rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</p> : null}
          <Field label="Zeitraum" htmlFor="import-range">
            <Select id="import-range" value={range} onChange={(event) => setRange(event.target.value as typeof range)}>
              <option value="all">Alles, was Meta noch liefert</option>
              <option value="30">Letzte 30 Tage</option>
              <option value="90">Letzte 90 Tage</option>
              <option value="date">Ab einem Datum</option>
            </Select>
          </Field>
          {range === "date" ? (
            <Field label="Ab" htmlFor="import-since">
              <Input id="import-since" type="date" value={since} onChange={(event) => setSince(event.target.value)} />
            </Field>
          ) : null}
          {needsFormIds ? (
            <Field
              label="Formular-ID"
              htmlFor="import-forms"
              hint="Im Werbeanzeigenmanager unter „Formulare“ (Formularbibliothek) die ID des Formulars kopieren. Mehrere mit Komma trennen."
            >
              <Input id="import-forms" value={formIds} onChange={(event) => setFormIds(event.target.value)} placeholder="123456789012345" />
            </Field>
          ) : null}
          <p className="text-xs leading-relaxed text-ink-500">
            Übernommene Leads behalten ihr ursprüngliches Eingangsdatum und bekommen keine einzelne E-Mail. Was schon im CRM ist,
            wird übersprungen, ein zweiter Import holt also nur Neues.
          </p>
        </div>
      )}
    </Modal>
  );
}

function EventsCard({ events, pages, onChanged }: { events: LeadEvent[]; pages: Page[]; onChanged: () => Promise<void> }) {
  const hydrated = useHydrated();
  const formatDateTime = (value: string) => (hydrated ? formatDateTimeNow(value) : "");
  const toast = useToast();
  const [retrying, setRetrying] = React.useState<string | null>(null);
  const pageName = (pageId: string) => pages.find((page) => page.pageId === pageId)?.pageName;

  async function retry(event: LeadEvent) {
    setRetrying(event.id);
    try {
      const result = await api.post<{ ok: boolean; error: string | null }>(`/api/v1/settings/meta/events/${event.id}/retry`, {});
      if (result.ok) toast.success("Lead angelegt");
      else toast.error("Erneut fehlgeschlagen", result.error ?? undefined);
      await onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Der Versuch ist fehlgeschlagen.");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Zuletzt eingegangen"
        description="Die letzten 25 Formular-Einsendungen von Meta. Scheitert das Abholen, versucht das CRM es automatisch erneut."
        action={
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void onChanged()}>
            Aktualisieren
          </Button>
        }
      />
      {events.length === 0 ? (
        <CardBody>
          <EmptyState compact title="Noch keine Leads von Meta" description="Sobald jemand ein Formular abschickt, erscheint es hier." />
        </CardBody>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <Th>Eingang</Th>
              <Th>Lead</Th>
              <Th>Herkunft</Th>
              <Th>Status</Th>
              <Th>E-Mail</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <Tr key={event.id}>
                <Td className="whitespace-nowrap text-xs text-ink-600">{formatDateTime(event.receivedAt)}</Td>
                <Td className="text-xs">
                  {event.leadId ? (
                    <Link href={`/leads/${event.leadId}`} className="font-medium text-brand-600 hover:text-brand-700">
                      {event.summary?.name ?? "Lead öffnen"}
                    </Link>
                  ) : (
                    <span className="text-ink-500">{event.summary?.name ?? "—"}</span>
                  )}
                </Td>
                <Td className="text-xs text-ink-600">
                  {[event.summary?.platform, event.summary?.formName, event.summary?.campaignName].filter(Boolean).join(" · ") ||
                    pageName(event.pageId) ||
                    "—"}
                </Td>
                <Td className="text-xs">
                  <Badge tone={STATUS[event.status].tone}>{STATUS[event.status].label}</Badge>
                  {event.origin === "import" ? <Badge tone="neutral">Import</Badge> : null}
                  {event.status === "FAILED" ? (
                    <span className="mt-1 block max-w-xs text-2xs text-danger-700">
                      {event.error}
                      {event.nextAttemptAt ? ` · nächster Versuch ${formatDateTime(event.nextAttemptAt)}` : " · keine weiteren Versuche"}
                    </span>
                  ) : null}
                  {event.status === "FAILED" ? (
                    <Button size="sm" variant="ghost" className="mt-1" loading={retrying === event.id} onClick={() => void retry(event)}>
                      Jetzt erneut versuchen
                    </Button>
                  ) : null}
                </Td>
                <Td className="text-xs">
                  {event.summary?.emailSent ? (
                    <span className="text-success-700">verschickt</span>
                  ) : event.summary && event.summary.emailSent === false ? (
                    <span className="text-ink-500" title={event.summary.emailReason ?? undefined}>
                      nicht verschickt
                    </span>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Card>
  );
}

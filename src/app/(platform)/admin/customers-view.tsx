"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, Copy, Mail, Plus, Search, ShieldOff } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

type Customer = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  members: number;
  pendingInvitations: number;
  contacts: number;
  deals: number;
  openDeals: number;
  lastActivityAt: string | null;
};

type Overview = {
  total: number;
  active: number;
  suspended: number;
  createdThisMonth: number;
  activeUsers: number;
  pendingInvitations: number;
};

type CreatedCustomer = {
  organizationName: string;
  inviteUrl: string;
  invitationExpiresAt: string;
  emailSent: boolean;
  emailSkippedReason: string | null;
};

export function CustomersView({
  overview,
  initialCustomers,
  mailConfigured,
}: {
  overview: Overview;
  initialCustomers: Customer[];
  mailConfigured: boolean;
}) {
  const toast = useToast();
  const [customers, setCustomers] = React.useState(initialCustomers);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedCustomer | null>(null);

  const visible = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) => customer.name.toLowerCase().includes(term) || customer.slug.includes(term));
  }, [customers, search]);

  async function reload() {
    setCustomers(await api.get<Customer[]>("/api/v1/platform/customers"));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kunden"
        description="Jeder Kunde ist ein eigener, vollständig abgeschotteter Mandant."
        actions={
          <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            Kunde anlegen
          </Button>
        }
      />

      {!mailConfigured ? (
        <div className="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-xs text-warning-800">
          <strong className="font-semibold">Kein Postausgang konfiguriert.</strong> Einladungen werden nicht
          automatisch verschickt — der Link wird nach dem Anlegen angezeigt und kann von Hand weitergegeben werden.
          Für automatischen Versand die Variablen <code>SMTP_HOST</code>, <code>SMTP_USER</code>,{" "}
          <code>SMTP_PASSWORD</code> und <code>SMTP_FROM</code> setzen.
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Kunden gesamt" value={formatNumber(overview.total)} />
        <Stat label="Aktiv" value={formatNumber(overview.active)} />
        <Stat label="Stillgelegt" value={formatNumber(overview.suspended)} tone={overview.suspended > 0 ? "danger" : undefined} />
        <Stat label="Neu (30 Tage)" value={formatNumber(overview.createdThisMonth)} />
        <Stat label="Aktive Nutzer" value={formatNumber(overview.activeUsers)} />
        <Stat label="Offene Einladungen" value={formatNumber(overview.pendingInvitations)} />
      </section>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input
          className="pl-9"
          placeholder="Kunden suchen…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={customers.length === 0 ? "Noch kein Kunde angelegt" : "Kein Treffer"}
            description={
              customers.length === 0
                ? "Legen Sie den ersten Kunden an. Dabei entsteht ein eigener Mandant mit Pipeline, Lifecycle Stages und Lead-Status — und eine Einladung für die erste Ansprechperson."
                : "Keine Organisation passt zu dieser Suche."
            }
            actions={
              customers.length === 0 ? (
                <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
                  Kunde anlegen
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <ul className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-200 bg-white">
          {visible.map((customer) => (
            <li key={customer.id}>
              <Link
                href={`/admin/${customer.id}`}
                className="flex flex-wrap items-center gap-4 px-4 py-3.5 transition-colors hover:bg-ink-50/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-900">{customer.name}</span>
                    {customer.suspendedAt ? (
                      <Badge tone="danger" dot>
                        Stillgelegt
                      </Badge>
                    ) : null}
                    {customer.pendingInvitations > 0 ? (
                      <Badge tone="warning">{customer.pendingInvitations} offene Einladung(en)</Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-2xs text-ink-500">
                    angelegt {formatDate(customer.createdAt)} ·{" "}
                    {customer.lastActivityAt
                      ? `zuletzt aktiv ${formatRelative(customer.lastActivityAt)}`
                      : "noch keine Aktivität"}
                  </p>
                </div>

                <dl className="flex shrink-0 gap-5 text-right">
                  <Metric label="Nutzer" value={customer.members} />
                  <Metric label="Kontakte" value={customer.contacts} />
                  <Metric label="Deals offen" value={customer.openDeals} />
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateCustomerDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (result) => {
          setCreating(false);
          setCreated(result);
          await reload();
          toast.success("Kunde angelegt", result.organizationName);
        }}
      />

      <Modal
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Kunde angelegt"
        description={
          created?.emailSent
            ? "Die Einladung wurde per E-Mail zugestellt."
            : "Der Einladungslink wurde nicht verschickt — bitte von Hand weitergeben."
        }
        footer={<Button variant="primary" onClick={() => setCreated(null)}>Fertig</Button>}
      >
        <div className="space-y-3">
          {created && !created.emailSent ? (
            <p className="rounded-md bg-warning-50 px-3 py-2 text-2xs text-warning-800">
              {created.emailSkippedReason}
            </p>
          ) : null}
          <Field label="Einladungslink" hint={created ? `Gültig bis ${formatDate(created.invitationExpiresAt)}, einmalig verwendbar.` : undefined}>
            <code className="block break-all rounded-md bg-ink-900 px-3 py-2.5 text-xs text-white">
              {created?.inviteUrl}
            </code>
          </Field>
          <Button
            size="sm"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => {
              void navigator.clipboard.writeText(created?.inviteUrl ?? "");
              toast.success("Link kopiert");
            }}
          >
            Link kopieren
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <Card>
      <CardBody className="p-3.5">
        <p className="text-2xs text-ink-500">{label}</p>
        <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "danger" ? "text-danger-600" : "text-ink-900")}>
          {value}
        </p>
      </CardBody>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="text-sm font-medium tabular-nums text-ink-900">{formatNumber(value)}</dd>
      <dt className="text-2xs text-ink-500">{label}</dt>
    </div>
  );
}

function CreateCustomerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: CreatedCustomer) => void | Promise<void>;
}) {
  const toast = useToast();
  const [organizationName, setOrganizationName] = React.useState("");
  const [adminName, setAdminName] = React.useState("");
  const [adminEmail, setAdminEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [fields, setFields] = React.useState<Record<string, string>>({});

  async function submit() {
    setBusy(true);
    setFields({});
    try {
      const result = await api.post<CreatedCustomer>("/api/v1/platform/customers", {
        organizationName: organizationName.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
      });
      setOrganizationName("");
      setAdminName("");
      setAdminEmail("");
      await onCreated(result);
    } catch (error) {
      if (error instanceof ApiError) {
        setFields(error.fields);
        toast.error(error.message);
      } else {
        toast.error("Der Kunde konnte nicht angelegt werden.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Kunde anlegen"
      description="Es entsteht ein eigener Mandant mit Standardkonfiguration. Die Ansprechperson erhält eine Einladung und setzt ihr Passwort selbst."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!organizationName.trim() || !adminName.trim() || !adminEmail.trim()}
            onClick={() => void submit()}
          >
            Anlegen und einladen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Unternehmen" htmlFor="customer-name" required error={fields.organizationName}>
          <Input
            id="customer-name"
            value={organizationName}
            maxLength={120}
            placeholder="z. B. Nordlicht Technik GmbH"
            onChange={(event) => setOrganizationName(event.target.value)}
          />
        </Field>
        <Field label="Ansprechperson" htmlFor="customer-admin" required error={fields.adminName}>
          <Input
            id="customer-admin"
            value={adminName}
            maxLength={80}
            placeholder="Vor- und Nachname"
            onChange={(event) => setAdminName(event.target.value)}
          />
        </Field>
        <Field
          label="E-Mail-Adresse"
          htmlFor="customer-email"
          required
          error={fields.adminEmail}
          hint="Erhält die Einladung und wird Super-Administrator dieses Mandanten."
        >
          <Input
            id="customer-email"
            type="email"
            value={adminEmail}
            maxLength={254}
            placeholder="name@unternehmen.de"
            onChange={(event) => setAdminEmail(event.target.value)}
          />
        </Field>
        <p className="flex items-start gap-2 rounded-md bg-ink-50 px-3 py-2 text-2xs text-ink-600">
          <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
          Es wird kein Passwort für den Kunden gesetzt. Sie erhalten nie Zugriff auf dessen CRM-Daten — nur auf
          Kennzahlen und Verwaltung.
        </p>
        <p className="flex items-start gap-2 text-2xs text-ink-500">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
          Ist ein Postausgang konfiguriert, geht die Einladung direkt raus. Sonst wird der Link angezeigt.
        </p>
      </div>
    </Modal>
  );
}

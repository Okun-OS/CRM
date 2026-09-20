"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Play, Send, ShieldOff } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, formatNumber } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Role } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

type Member = {
  id: string;
  role: Role;
  status: string;
  joinedAt: string;
  user: { id: string; name: string; email: string; lastLoginAt: string | null };
};

type Customer = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  industry: string | null;
  currency: string;
  locale: string;
  timezone: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  onboardingCompletedAt: string | null;
  counts: { contacts: number; companies: number; deals: number; activities: number };
  members: Member[];
  invitations: { id: string; email: string; role: Role; expiresAt: string; createdAt: string }[];
};

type Invitation = { inviteUrl: string; expiresAt: string; emailSent: boolean; emailSkippedReason: string | null };

export function CustomerDetail({ customer: initial, mailConfigured }: { customer: Customer; mailConfigured: boolean }) {
  const toast = useToast();
  const [customer, setCustomer] = React.useState(initial);
  const [dialog, setDialog] = React.useState<"suspend" | "invite" | null>(null);
  const [issued, setIssued] = React.useState<Invitation | null>(null);
  const [busy, setBusy] = React.useState(false);

  const suspended = customer.suspendedAt !== null;

  async function reactivate() {
    setBusy(true);
    try {
      setCustomer(await api.post<Customer>(`/api/v1/platform/customers/${customer.id}/reactivate`, {}));
      toast.success("Organisation reaktiviert");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Die Reaktivierung ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Alle Kunden
        </Link>
      </div>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {customer.name}
            {suspended ? <Badge tone="danger" dot>Stillgelegt</Badge> : <Badge tone="success" dot>Aktiv</Badge>}
          </span>
        }
        description={`Mandant seit ${formatDate(customer.createdAt)} · Kennung ${customer.slug}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<Send className="h-3.5 w-3.5" />} onClick={() => setDialog("invite")}>
              Zugang einladen
            </Button>
            {suspended ? (
              <Button variant="primary" icon={<Play className="h-3.5 w-3.5" />} loading={busy} onClick={() => void reactivate()}>
                Reaktivieren
              </Button>
            ) : (
              <Button variant="danger" icon={<ShieldOff className="h-3.5 w-3.5" />} onClick={() => setDialog("suspend")}>
                Stilllegen
              </Button>
            )}
          </div>
        }
      />

      {suspended ? (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-xs text-danger-800">
          <strong className="font-semibold">Stillgelegt am {formatDate(customer.suspendedAt)}.</strong>{" "}
          {customer.suspendedReason} — Mitglieder können sich nicht anmelden, die Daten bleiben vollständig erhalten.
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Kontakte" value={customer.counts.contacts} />
        <Stat label="Unternehmen" value={customer.counts.companies} />
        <Stat label="Deals" value={customer.counts.deals} />
        <Stat label="Aktivitäten" value={customer.counts.activities} />
      </section>
      <p className="text-2xs text-ink-500">
        Nur Anzahlen: Der Betreiberbereich zeigt keine Kontakte, Deals oder Notizen dieses Mandanten.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Mitglieder (${customer.members.length})`} description="Wer in diesem Mandanten arbeitet." />
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-100">
              {customer.members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-900">{member.user.name}</p>
                    <p className="truncate text-2xs text-ink-500">{member.user.email}</p>
                  </div>
                  <div className="text-right">
                    <Badge tone={member.role === "SUPER_ADMIN" ? "brand" : "neutral"}>{ROLE_LABELS[member.role]}</Badge>
                    <p className="mt-0.5 text-2xs text-ink-500">
                      {member.user.lastLoginAt ? `zuletzt ${formatDate(member.user.lastLoginAt)}` : "noch nie angemeldet"}
                    </p>
                  </div>
                </li>
              ))}
              {customer.members.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-ink-500">
                  Noch niemand angemeldet — die Einladung ist offen.
                </li>
              ) : null}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Offene Einladungen (${customer.invitations.length})`} description="Noch nicht angenommen." />
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-100">
              {customer.invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-900">{invitation.email}</p>
                    <p className="text-2xs text-ink-500">
                      {ROLE_LABELS[invitation.role]} · gültig bis {formatDate(invitation.expiresAt)}
                    </p>
                  </div>
                </li>
              ))}
              {customer.invitations.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-ink-500">Keine offenen Einladungen.</li>
              ) : null}
            </ul>
          </CardBody>
        </Card>
      </div>

      <SuspendDialog
        open={dialog === "suspend"}
        name={customer.name}
        onClose={() => setDialog(null)}
        onDone={(updated) => {
          setCustomer(updated);
          setDialog(null);
          toast.success("Organisation stillgelegt");
        }}
        organizationId={customer.id}
      />

      <InviteDialog
        open={dialog === "invite"}
        organizationId={customer.id}
        mailConfigured={mailConfigured}
        onClose={() => setDialog(null)}
        onDone={(result) => {
          setDialog(null);
          setIssued(result);
        }}
      />

      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Einladung erstellt"
        description={issued?.emailSent ? "Die Einladung wurde per E-Mail zugestellt." : "Bitte den Link von Hand weitergeben."}
        size="sm"
        footer={<Button variant="primary" onClick={() => setIssued(null)}>Fertig</Button>}
      >
        <div className="space-y-2">
          {issued && !issued.emailSent ? (
            <p className="rounded-md bg-warning-50 px-3 py-2 text-2xs text-warning-800">{issued.emailSkippedReason}</p>
          ) : null}
          <code className="block break-all rounded-md bg-ink-900 px-3 py-2.5 text-xs text-white">{issued?.inviteUrl}</code>
          <Button
            size="sm"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => {
              void navigator.clipboard.writeText(issued?.inviteUrl ?? "");
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardBody className="p-3.5">
        <p className="text-2xs text-ink-500">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">{formatNumber(value)}</p>
      </CardBody>
    </Card>
  );
}

function SuspendDialog({
  open,
  name,
  organizationId,
  onClose,
  onDone,
}: {
  open: boolean;
  name: string;
  organizationId: string;
  onClose: () => void;
  onDone: (customer: Customer) => void;
}) {
  const toast = useToast();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Organisation stilllegen?"
      description={`Mitglieder von „${name}" können sich danach nicht mehr anmelden. Laufende Sitzungen enden sofort. Die Daten bleiben vollständig erhalten und lassen sich jederzeit reaktivieren.`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(
                  await api.post<Customer>(`/api/v1/platform/customers/${organizationId}/suspend`, {
                    reason: reason.trim(),
                  }),
                );
                setReason("");
              } catch (error) {
                toast.error(error instanceof ApiError ? error.message : "Die Stilllegung ist fehlgeschlagen.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Stilllegen
          </Button>
        </>
      }
    >
      <Field label="Grund" htmlFor="suspend-reason" required hint="Wird im Betreiberprotokoll festgehalten.">
        <Textarea id="suspend-reason" rows={3} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </Modal>
  );
}

function InviteDialog({
  open,
  organizationId,
  mailConfigured,
  onClose,
  onDone,
}: {
  open: boolean;
  organizationId: string;
  mailConfigured: boolean;
  onClose: () => void;
  onDone: (result: Invitation) => void;
}) {
  const toast = useToast();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Zugang einladen"
      description="Die eingeladene Person wird Super-Administrator dieses Mandanten und setzt ihr Passwort selbst."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!email.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(
                  await api.post<Invitation>(`/api/v1/platform/customers/${organizationId}/invite`, {
                    email: email.trim(),
                    name: name.trim() || undefined,
                  }),
                );
                setEmail("");
                setName("");
              } catch (error) {
                toast.error(error instanceof ApiError ? error.message : "Die Einladung ist fehlgeschlagen.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Einladen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="E-Mail-Adresse" htmlFor="invite-email" required>
          <Input id="invite-email" type="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Name" htmlFor="invite-name" hint="Optional, wird in der Einladung verwendet.">
          <Input id="invite-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        {!mailConfigured ? (
          <p className="rounded-md bg-warning-50 px-3 py-2 text-2xs text-warning-800">
            Kein Postausgang konfiguriert — der Link wird danach angezeigt.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

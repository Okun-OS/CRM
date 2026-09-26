"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Ban, Building2, ExternalLink, Mail, MapPin, Send, ShieldAlert, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { STAGE_LABELS, STAGE_TONES } from "../prospects-view";

type Provenance = {
  field: string;
  sourceKey: string;
  reference: string | null;
  confidence: number | null;
  observedAt: string;
};

type Prospect = {
  id: string;
  stage: string;
  companyName: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  sourceKey: string;
  score: number | null;
  qualification: string | null;
  disqualifiedReason: string | null;
  lawfulBasis: string;
  lawfulBasisNote: string | null;
  owner: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  convertedAt: string | null;
  firstContactedAt: string | null;
  repliedAt: string | null;
  provenance: Provenance[];
  suppression: { blocked: boolean; reason?: string };
};

const FIELD_LABELS: Record<string, string> = {
  companyName: "Firmenname",
  domain: "Domain",
  website: "Website",
  industry: "Branche",
  employeeCount: "Mitarbeiter",
  city: "Ort",
  country: "Land",
  phone: "Telefon",
  firstName: "Vorname",
  lastName: "Nachname",
  email: "E-Mail",
  jobTitle: "Position",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manuell angelegt",
  csv: "Tabelle",
  crm: "Eigener Bestand",
};

const BASIS_LABELS: Record<string, string> = {
  UNREVIEWED: "Nicht geprüft",
  CLAIMED_LEGITIMATE_INTEREST: "Berechtigtes Interesse geltend gemacht",
  CLAIMED_CONSENT: "Einwilligung geltend gemacht",
  EXISTING_CUSTOMER: "Bestandskunde",
  REJECTED: "Ansprache verworfen",
};

/** Stufen, die sich von Hand setzen lassen. „Übernommen" entsteht nur durch die Übernahme. */
const SETTABLE = ["NEW", "RESEARCHING", "QUALIFIED", "READY", "NOT_INTERESTED", "MEETING", "DISQUALIFIED", "DO_NOT_CONTACT"];

export function ProspectDetail({
  prospect,
  canWrite,
  canEnroll,
}: {
  prospect: Prospect;
  canWrite: boolean;
  canEnroll: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = React.useState<"stage" | "convert" | "enroll" | null>(null);

  const person = [prospect.firstName, prospect.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={<Link href="/outreach/prospects" className="hover:text-ink-700">Prospects</Link>}
        title={prospect.companyName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={STAGE_TONES[prospect.stage] ?? "neutral"}>{STAGE_LABELS[prospect.stage] ?? prospect.stage}</Badge>
            <span className="text-ink-500">Quelle: {SOURCE_LABELS[prospect.sourceKey] ?? prospect.sourceKey}</span>
            {prospect.owner ? <span className="text-ink-500">Owner: {prospect.owner.name}</span> : null}
          </span>
        }
        actions={
          <>
            {canWrite && prospect.stage !== "CONVERTED" ? (
              <Button onClick={() => setDialog("stage")}>Stufe ändern</Button>
            ) : null}
            {canEnroll && !prospect.suppression.blocked && prospect.email && !prospect.convertedAt ? (
              <Button icon={<Send className="h-4 w-4" />} onClick={() => setDialog("enroll")}>
                In Sequenz
              </Button>
            ) : null}
            {canWrite && !prospect.convertedAt ? (
              <Button variant="primary" icon={<ArrowRight className="h-4 w-4" />} onClick={() => setDialog("convert")}>
                Ins CRM übernehmen
              </Button>
            ) : null}
          </>
        }
      />

      {prospect.suppression.blocked ? (
        <div className="flex items-start gap-2.5 rounded-md border-l-2 border-danger-500 bg-danger-50 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-500" />
          <div>
            <p className="text-sm font-medium text-ink-900">Kontaktsperre</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
              {prospect.suppression.reason} Dieser Prospect lässt sich nicht in eine Sequenz aufnehmen.
            </p>
          </div>
        </div>
      ) : null}

      {prospect.convertedAt ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border-l-2 border-success-500 bg-success-50 px-4 py-3 text-sm">
          <span className="font-medium text-ink-900">Am {formatDate(prospect.convertedAt)} ins CRM übernommen.</span>
          {prospect.company ? (
            <Link href={`/companies/${prospect.company.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              <Building2 className="h-3.5 w-3.5" /> {prospect.company.name}
            </Link>
          ) : null}
          {prospect.contact ? (
            <Link href={`/contacts/${prospect.contact.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              <UserRound className="h-3.5 w-3.5" /> {prospect.contact.firstName} {prospect.contact.lastName}
            </Link>
          ) : null}
          {prospect.deal ? (
            <Link href={`/deals/${prospect.deal.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              {prospect.deal.name}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Unternehmen" />
            <CardBody className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Entry label="Domain" value={prospect.domain} link={prospect.website ?? (prospect.domain ? `https://${prospect.domain}` : null)} />
              <Entry label="Branche" value={prospect.industry} />
              <Entry label="Mitarbeiter" value={prospect.employeeCount?.toLocaleString("de-DE") ?? null} />
              <Entry label="Ort" value={[prospect.city, prospect.country].filter(Boolean).join(", ") || null} icon={<MapPin className="h-3.5 w-3.5" />} />
              <Entry label="Telefon" value={prospect.phone} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Ansprechpartner" />
            <CardBody className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {person || prospect.email ? (
                <>
                  <Entry label="Name" value={person || null} />
                  <Entry label="Position" value={prospect.jobTitle} />
                  <Entry label="E-Mail" value={prospect.email} icon={<Mail className="h-3.5 w-3.5" />} />
                </>
              ) : (
                <p className="text-sm text-ink-500 sm:col-span-2">
                  Noch kein Ansprechpartner hinterlegt. Ohne E-Mail-Adresse ist keine Ansprache möglich.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Herkunft der Angaben"
              description="Welches Feld woher stammt — die Antwort auf die Frage, woher eine Angabe kommt."
            />
            <CardBody className="p-0">
              {prospect.provenance.length === 0 ? (
                <p className="px-5 py-5 text-sm text-ink-500">
                  Für diesen Datensatz ist keine feldgenaue Herkunft hinterlegt. Er wurde als{" "}
                  {SOURCE_LABELS[prospect.sourceKey] ?? prospect.sourceKey} angelegt.
                </p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {prospect.provenance.map((entry, index) => (
                    <li key={`${entry.field}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5">
                      <span className="text-sm text-ink-800">{FIELD_LABELS[entry.field] ?? entry.field}</span>
                      <span className="text-xs text-ink-500">
                        {SOURCE_LABELS[entry.sourceKey] ?? entry.sourceKey}
                        {entry.reference ? ` · ${entry.reference}` : ""}
                        {entry.confidence !== null ? ` · ${entry.confidence}%` : ""}
                        {` · ${formatDate(entry.observedAt)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Werdegang" />
            <CardBody className="space-y-2.5 text-sm">
              <Milestone label="Angelegt" value={formatDate(prospect.provenance[0]?.observedAt ?? null)} />
              <Milestone label="Erstkontakt" value={prospect.firstContactedAt ? formatDateTime(prospect.firstContactedAt) : null} />
              <Milestone label="Antwort" value={prospect.repliedAt ? formatDateTime(prospect.repliedAt) : null} />
              <Milestone label="Übernahme" value={prospect.convertedAt ? formatDate(prospect.convertedAt) : null} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Rechtsgrund"
              description="Wie Ihr Unternehmen den Fall selbst einordnet."
            />
            <CardBody className="space-y-2">
              <Badge tone={prospect.lawfulBasis === "UNREVIEWED" ? "warning" : prospect.lawfulBasis === "REJECTED" ? "danger" : "success"}>
                {BASIS_LABELS[prospect.lawfulBasis] ?? prospect.lawfulBasis}
              </Badge>
              {prospect.lawfulBasisNote ? <p className="text-xs leading-relaxed text-ink-600">{prospect.lawfulBasisNote}</p> : null}
              <p className="text-2xs leading-relaxed text-ink-400">
                Diese Angabe ist Ihre Dokumentation, keine rechtliche Bewertung durch die Software.
              </p>
            </CardBody>
          </Card>

          {prospect.disqualifiedReason ? (
            <Card>
              <CardHeader title="Aussortiert" />
              <CardBody>
                <p className="text-sm text-ink-600">{prospect.disqualifiedReason}</p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <StageDialog
        open={dialog === "stage"}
        prospect={prospect}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          router.refresh();
        }}
      />
      <ConvertDialog
        open={dialog === "convert"}
        prospect={prospect}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          toast.success("Ins CRM übernommen.");
          router.refresh();
        }}
      />
      <EnrollDialog
        open={dialog === "enroll"}
        prospect={prospect}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function Entry({ label, value, link, icon }: { label: string; value: string | null; link?: string | null; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wider text-ink-400">{label}</p>
      {value ? (
        link ? (
          <a href={link} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
            {value} <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-ink-800">
            {icon}
            {value}
          </p>
        )
      ) : (
        <p className="mt-0.5 text-sm text-ink-400">—</p>
      )}
    </div>
  );
}

function Milestone({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-600">{label}</span>
      <span className={value ? "tabular-nums text-ink-900" : "text-ink-400"}>{value ?? "—"}</span>
    </div>
  );
}

function StageDialog({
  open,
  prospect,
  onClose,
  onDone,
}: {
  open: boolean;
  prospect: Prospect;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [stage, setStage] = React.useState(prospect.stage);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit() {
    setPending(true);
    try {
      await api.post(`/api/v1/prospects/${prospect.id}/stage`, { stage, reason: reason || undefined });
      onDone();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Stufe konnte nicht geändert werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stufe ändern"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={stage === prospect.stage}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Neue Stufe" htmlFor="stage">
          <Select id="stage" value={stage} onChange={(event) => setStage(event.target.value)}>
            {SETTABLE.map((value) => (
              <option key={value} value={value}>
                {STAGE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        {stage === "DISQUALIFIED" ? (
          <Field label="Begründung" htmlFor="reason" required>
            <Textarea id="reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        ) : null}
        {stage === "DO_NOT_CONTACT" ? (
          <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
            <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-500" />
            Damit ist jede weitere Ansprache ausgeschlossen. Die Stufe lässt sich nicht von Hand zurücknehmen.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ConvertDialog({
  open,
  prospect,
  onClose,
  onDone,
}: {
  open: boolean;
  prospect: Prospect;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = React.useState<{
    existingCompany: { id: string; name: string } | null;
    existingContact: { id: string; firstName: string; lastName: string } | null;
    messageCount: number;
    hasPipeline: boolean;
    willCreateContact: boolean;
    blocked: boolean;
  } | null>(null);
  const [createDeal, setCreateDeal] = React.useState(false);
  const [dealName, setDealName] = React.useState("");
  const [dealAmount, setDealAmount] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        setPreview(await api.get(`/api/v1/prospects/${prospect.id}/convert`));
      } catch {
        setPreview(null);
      }
    })();
  }, [open, prospect.id]);

  async function submit() {
    setPending(true);
    try {
      await api.post(`/api/v1/prospects/${prospect.id}/convert`, {
        createDeal,
        dealName: dealName || undefined,
        dealAmount: dealAmount ? Number(dealAmount) : undefined,
      });
      onDone();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Übernahme ist fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ins CRM übernehmen"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={preview?.blocked}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {preview ? (
          <ul className="space-y-1.5 rounded-md bg-ink-50 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
            <li>
              {preview.existingCompany
                ? `Das vorhandene Unternehmen „${preview.existingCompany.name}" wird verwendet.`
                : `Das Unternehmen „${prospect.companyName}" wird neu angelegt.`}
            </li>
            <li>
              {preview.existingContact
                ? `Der vorhandene Kontakt „${preview.existingContact.firstName} ${preview.existingContact.lastName}" wird verwendet.`
                : preview.willCreateContact
                  ? "Ein Kontakt wird neu angelegt."
                  : "Es wird kein Kontakt angelegt — es ist kein Ansprechpartner bekannt."}
            </li>
            {preview.messageCount > 0 ? (
              <li>{preview.messageCount} Nachricht(en) werden übernommen — ohne doppelte Chronik.</li>
            ) : null}
          </ul>
        ) : null}

        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={createDeal}
            onChange={(event) => setCreateDeal(event.target.checked)}
            disabled={preview ? !preview.hasPipeline : false}
            className="h-4 w-4 rounded border-ink-300"
          />
          Deal mit anlegen
        </label>

        {createDeal ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name des Deals" htmlFor="dealName">
              <Input id="dealName" placeholder={`${prospect.companyName} — Erstgeschäft`} value={dealName} onChange={(e) => setDealName(e.target.value)} />
            </Field>
            <Field label="Wert" htmlFor="dealAmount">
              <Input id="dealAmount" type="number" min={0} value={dealAmount} onChange={(e) => setDealAmount(e.target.value)} />
            </Field>
          </div>
        ) : null}

        <p className="text-2xs leading-relaxed text-ink-400">
          Der Prospect bleibt erhalten und zeigt danach auf den entstandenen Kontakt — das ist die Grundlage der
          Herkunftsauswertung.
        </p>
      </div>
    </Modal>
  );
}

function EnrollDialog({
  open,
  prospect,
  onClose,
  onDone,
}: {
  open: boolean;
  prospect: Prospect;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [sequences, setSequences] = React.useState<{ id: string; name: string; status: string }[]>([]);
  const [sequenceId, setSequenceId] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const all = await api.get<{ id: string; name: string; status: string }[]>("/api/v1/outreach/sequences");
        const active = all.filter((entry) => entry.status === "ACTIVE");
        setSequences(active);
        setSequenceId(active[0]?.id ?? "");
      } catch {
        setSequences([]);
      }
    })();
  }, [open]);

  async function submit() {
    setPending(true);
    try {
      const result = await api.post<{ enrolled: number; rejected: { reason: string }[] }>(
        "/api/v1/outreach/enrollments",
        { sequenceId, prospectIds: [prospect.id] },
      );
      if (result.enrolled > 0) {
        toast.success("In die Sequenz aufgenommen.");
        onDone();
      } else {
        toast.error(result.rejected[0]?.reason ?? "Die Aufnahme wurde abgelehnt.");
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Aufnahme ist fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="In eine Sequenz aufnehmen"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!sequenceId}>
            Aufnehmen
          </Button>
        </>
      }
    >
      {sequences.length === 0 ? (
        <p className="text-sm text-ink-600">
          Es ist keine aktive Sequenz vorhanden.{" "}
          <Link href="/outreach/sequences" className="text-brand-700 hover:underline">
            Zu den Sequenzen
          </Link>
        </p>
      ) : (
        <Field label="Sequenz" htmlFor="sequenceId">
          <Select id="sequenceId" value={sequenceId} onChange={(event) => setSequenceId(event.target.value)}>
            {sequences.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}

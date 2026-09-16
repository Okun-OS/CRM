import type { Metadata } from "next";
import Link from "next/link";
import { Database, Download, ShieldCheck, Trash2 } from "lucide-react";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { prisma } from "@/lib/db";
import { scope } from "@/lib/tenant";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Datenschutz" };
export const dynamic = "force-dynamic";

/**
 * Data protection overview.
 *
 * This page describes the mechanisms the product actually implements. It makes
 * no compliance claim: technical features support a data-protection concept,
 * they do not constitute one.
 */
export default async function PrivacyPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Diese Übersicht ist Administratorinnen und Administratoren vorbehalten." />
      </Card>
    );
  }

  const [contacts, deletedContacts, companies, deletedCompanies, files, auditEntries] = await Promise.all([
    prisma.contact.count({ where: { ...scope(actor), deletedAt: null } }),
    prisma.contact.count({ where: { ...scope(actor), deletedAt: { not: null } } }),
    prisma.company.count({ where: { ...scope(actor), deletedAt: null } }),
    prisma.company.count({ where: { ...scope(actor), deletedAt: { not: null } } }),
    prisma.fileObject.count({ where: { ...scope(actor), deletedAt: null } }),
    prisma.auditLog.count({ where: scope(actor) }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Datenschutz"
        description="Welche personenbezogenen Daten dieses CRM verarbeitet und welche Werkzeuge dafür bereitstehen."
      />

      <Card>
        <CardHeader title="Datenbestand" />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              ["Aktive Kontakte", contacts],
              ["Gelöschte Kontakte (wiederherstellbar)", deletedContacts],
              ["Aktive Unternehmen", companies],
              ["Gelöschte Unternehmen", deletedCompanies],
              ["Dateien", files],
              ["Audit-Einträge", auditEntries],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-2xs uppercase tracking-wide text-ink-400">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{formatNumber(Number(value))}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader title="Auskunft & Export" />
          <CardBody className="space-y-3 text-xs leading-relaxed text-ink-600">
            <p>
              Kontakte, Unternehmen, Leads und Deals lassen sich jederzeit als CSV exportieren – berechtigungsabhängig über
              die jeweilige Listenansicht. Für eine Auskunft zu einer einzelnen Person liefert die Detailseite Stammdaten,
              Timeline, Notizen, Aufgaben, Termine und Dateien an einem Ort.
            </p>
            <Link href="/contacts">
              <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />}>
                Zu den Kontakten
              </Button>
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Löschkonzept" />
          <CardBody className="space-y-3 text-xs leading-relaxed text-ink-600">
            <p>
              Das Löschen im Arbeitsalltag ist ein Soft Delete: Der Datensatz verschwindet aus Listen und Suchen, bleibt
              aber wiederherstellbar und im Audit Log nachvollziehbar. Für eine endgültige Löschung steht im Service-Layer
              eine Purge-Funktion bereit, die zusätzlich das Recht „settings.manage“ verlangt.
            </p>
            <p className="flex items-start gap-2 rounded-md bg-ink-50 px-3 py-2">
              <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
              Eine Oberfläche für die endgültige Löschung wird bewusst erst mit dem Freigabe- und Protokollkonzept
              ausgeliefert, damit niemand versehentlich unwiederbringlich löscht.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Zugriffsschutz" />
          <CardBody className="space-y-2 text-xs leading-relaxed text-ink-600">
            <ul className="space-y-1.5">
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-500" />
                Mandantentrennung auf Datenbankebene: Jede Abfrage ist an die Organisation gebunden.
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-500" />
                Rollenbasierte Rechte werden serverseitig geprüft, nicht nur in der Oberfläche ausgeblendet.
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-500" />
                Dateien werden nie über öffentliche Speicher-URLs ausgeliefert, sondern nur über eine geprüfte Route.
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-500" />
                Sicherheitsrelevante Änderungen landen im Audit Log; Passwörter und Secrets werden nie protokolliert.
              </li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Aufbewahrung" />
          <CardBody className="space-y-3 text-xs leading-relaxed text-ink-600">
            <p className="flex items-start gap-2">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
              Aufbewahrungsfristen sind im Datenmodell vorbereitet (Soft-Delete-Zeitstempel, Audit-Zeitreihe), aber noch
              nicht als automatische Löschroutine umgesetzt.
            </p>
            <p>
              <span className="font-medium text-ink-800">Wichtig:</span> Diese Funktionen unterstützen ein
              Datenschutzkonzept, ersetzen es aber nicht. Eine Aussage zur DSGVO-Konformität hängt von Betrieb,
              Verträgen und Prozessen des einsetzenden Unternehmens ab.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

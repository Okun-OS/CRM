"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitMerge, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

type ContactRecord = { id: string; name: string; email: string | null; phone: string | null; company: string | null; createdAt: string };
type CompanyRecord = { id: string; name: string; domain: string | null; createdAt: string };
type Group<T> = { reason: string; value: string; records: T[] };

export function DuplicatesView({
  contactGroups,
  companyGroups,
  canMerge,
}: {
  contactGroups: Group<ContactRecord>[];
  companyGroups: Group<CompanyRecord>[];
  canMerge: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = React.useState("contacts");
  const [merge, setMerge] = React.useState<{
    objectType: "CONTACT" | "COMPANY";
    primaryId: string;
    duplicateId: string;
    primaryLabel: string;
    duplicateLabel: string;
  } | null>(null);
  const [pending, setPending] = React.useState(false);

  async function confirmMerge() {
    if (!merge) return;
    setPending(true);
    try {
      await api.post("/api/v1/duplicates/merge", {
        objectType: merge.objectType,
        primaryId: merge.primaryId,
        duplicateId: merge.duplicateId,
      });
      toast.success("Datensätze zusammengeführt.");
      setMerge(null);
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Das Zusammenführen ist fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  const groups = tab === "contacts" ? contactGroups : companyGroups;

  return (
    <div className="space-y-3">
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "contacts", label: "Kontakte", count: contactGroups.length },
          { key: "companies", label: "Unternehmen", count: companyGroups.length },
        ]}
      />

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Keine Dubletten gefunden"
            description={
              tab === "contacts"
                ? "Es gibt aktuell keine Kontakte mit identischer E-Mail-Adresse."
                : "Es gibt aktuell keine Unternehmen mit identischer Domain."
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Card key={`${group.reason}-${group.value}`} className="overflow-hidden">
              <CardHeader title={group.value} description={`${group.reason} · ${group.records.length} Datensätze`} />
              <ul className="divide-y divide-ink-100">
                {group.records.map((record, index) => {
                  const isContact = "email" in record;
                  const primary = group.records[0];
                  return (
                    <li key={record.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={isContact ? `/contacts/${record.id}` : `/companies/${record.id}`}
                          className="text-xs font-medium text-ink-900 hover:text-brand-600"
                        >
                          {record.name}
                        </Link>
                        <p className="text-2xs text-ink-500">
                          {isContact
                            ? [(record as ContactRecord).email, (record as ContactRecord).phone, (record as ContactRecord).company]
                                .filter(Boolean)
                                .join(" · ")
                            : (record as CompanyRecord).domain}
                          {" · angelegt "}
                          {formatDate(record.createdAt)}
                        </p>
                      </div>

                      {index === 0 ? (
                        <span className="text-2xs font-medium text-brand-600">Ältester Datensatz (Ziel)</span>
                      ) : canMerge ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<GitMerge className="h-3.5 w-3.5" />}
                          onClick={() =>
                            setMerge({
                              objectType: isContact ? "CONTACT" : "COMPANY",
                              primaryId: primary.id,
                              duplicateId: record.id,
                              primaryLabel: primary.name,
                              duplicateLabel: record.name,
                            })
                          }
                        >
                          In Ziel zusammenführen
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={merge !== null}
        onClose={() => setMerge(null)}
        title="Datensätze zusammenführen"
        size="sm"
        footer={
          <>
            <Button onClick={() => setMerge(null)} disabled={pending}>
              Abbrechen
            </Button>
            <Button variant="primary" loading={pending} onClick={confirmMerge}>
              Zusammenführen
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-ink-700">
          <p>
            <span className="font-medium text-ink-900">{merge?.duplicateLabel}</span> wird in{" "}
            <span className="font-medium text-ink-900">{merge?.primaryLabel}</span> überführt.
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-600">
            <li>Aktivitäten, Notizen, Aufgaben, Termine, Dateien und Deals werden übernommen.</li>
            <li>Leere Felder im Ziel werden aus dem Duplikat gefüllt – vorhandene Werte bleiben unverändert.</li>
            <li>Das Duplikat wird als gelöscht markiert und bleibt im Audit Log nachvollziehbar.</li>
          </ul>
        </div>
      </Modal>
    </div>
  );
}

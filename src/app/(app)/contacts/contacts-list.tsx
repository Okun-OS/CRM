"use client";

import * as React from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordList, type ListItem } from "@/components/crm/record-list";
import { ContactForm } from "@/components/crm/forms/contact-form";
import { useReference } from "@/components/app/reference-provider";
import { DateCell, EmptyCell, LinkCell, NumberCell, OptionBadge, OwnerCell, TextCell } from "@/components/crm/cells";

export function ContactsList({
  canCreate,
  canDelete,
  canExport,
  canImport,
}: {
  canCreate: boolean;
  canDelete: boolean;
  canExport: boolean;
  canImport: boolean;
}) {
  const { data } = useReference();

  const renderCell = React.useCallback(
    (item: ListItem, key: string) => {
      switch (key) {
        case "lastName":
          return <LinkCell href={`/contacts/${item.id}`} label={String(item.name ?? item.lastName)} strong />;
        case "companyId": {
          const company = item.company as { id: string; name: string } | null;
          return company ? <LinkCell href={`/companies/${company.id}`} label={company.name} /> : <EmptyCell />;
        }
        case "ownerId":
          return <OwnerCell owner={item.owner as { id: string; name: string } | null} />;
        case "lifecycleStage":
          return <OptionBadge value={item.lifecycleStage} options={data?.lifecycleStages ?? []} tone="brand" />;
        case "leadStatus":
          return <OptionBadge value={item.leadStatus} options={data?.leadStatuses ?? []} />;
        case "email":
          return item.email ? (
            <a
              href={`mailto:${item.email}`}
              onClick={(event) => event.stopPropagation()}
              className="text-ink-700 hover:text-brand-600"
            >
              {String(item.email)}
            </a>
          ) : (
            <EmptyCell />
          );
        case "lastActivityAt":
        case "nextActivityAt":
          return <DateCell value={item[key]} relative />;
        case "createdAt":
          return <DateCell value={item.createdAt} />;
        case "openDeals":
          return <NumberCell value={item.openDeals} />;
        default:
          return <TextCell value={item[key]} />;
      }
    },
    [data],
  );

  return (
    <RecordList
      objectType="CONTACT"
      endpoint="/api/v1/contacts"
      rowHref={(item) => `/contacts/${item.id}`}
      renderCell={renderCell}
      createLabel="Kontakt erstellen"
      renderCreateForm={(close) => <ContactForm onDone={(contact) => close(contact)} onCancel={() => close()} />}
      canCreate={canCreate}
      canDelete={canDelete}
      canExport={canExport}
      emptyTitle="Noch keine Kontakte vorhanden"
      emptyDescription="Lege den ersten Kontakt an oder importiere eine bestehende Liste als CSV-Datei."
      extraActions={
        canImport ? (
          <Link href="/settings/import?objectType=CONTACT">
            <Button variant="secondary" icon={<Upload className="h-4 w-4" />}>
              <span className="hidden sm:inline">Import</span>
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

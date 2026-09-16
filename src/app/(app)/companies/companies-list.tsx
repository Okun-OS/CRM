"use client";

import * as React from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordList, type ListItem } from "@/components/crm/record-list";
import { CompanyForm } from "@/components/crm/forms/company-form";
import { useReference } from "@/components/app/reference-provider";
import { CurrencyCell, DateCell, EmptyCell, LinkCell, NumberCell, OptionBadge, OwnerCell, TextCell } from "@/components/crm/cells";

export function CompaniesList({
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
        case "name":
          return <LinkCell href={`/companies/${item.id}`} label={String(item.name)} strong />;
        case "domain":
          return item.domain ? (
            <a
              href={`https://${item.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(event) => event.stopPropagation()}
              className="text-ink-700 hover:text-brand-600"
            >
              {String(item.domain)}
            </a>
          ) : (
            <EmptyCell />
          );
        case "ownerId":
          return <OwnerCell owner={item.owner as { id: string; name: string } | null} />;
        case "lifecycleStage":
          return <OptionBadge value={item.lifecycleStage} options={data?.lifecycleStages ?? []} tone="brand" />;
        case "annualRevenue":
          return <CurrencyCell value={item.annualRevenue} currency="EUR" />;
        case "employeeCount":
          return <NumberCell value={item.employeeCount} />;
        case "lastActivityAt":
          return <DateCell value={item.lastActivityAt} relative />;
        case "createdAt":
          return <DateCell value={item.createdAt} />;
        default:
          return <TextCell value={item[key]} />;
      }
    },
    [data],
  );

  return (
    <RecordList
      objectType="COMPANY"
      endpoint="/api/v1/companies"
      rowHref={(item) => `/companies/${item.id}`}
      renderCell={renderCell}
      createLabel="Unternehmen erstellen"
      renderCreateForm={(close) => <CompanyForm onDone={(company) => close(company)} onCancel={() => close()} />}
      canCreate={canCreate}
      canDelete={canDelete}
      canExport={canExport}
      emptyTitle="Noch keine Unternehmen vorhanden"
      emptyDescription="Lege das erste Unternehmen an oder importiere eine bestehende Liste als CSV-Datei."
      extraActions={
        canImport ? (
          <Link href="/settings/import?objectType=COMPANY">
            <Button variant="secondary" icon={<Upload className="h-4 w-4" />}>
              <span className="hidden sm:inline">Import</span>
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

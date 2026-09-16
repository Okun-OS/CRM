"use client";

import * as React from "react";
import { RecordList, type ListItem } from "@/components/crm/record-list";
import { DealForm } from "@/components/crm/forms/deal-form";
import { CurrencyCell, DateCell, DealStatusBadge, EmptyCell, LinkCell, NumberCell, OwnerCell, StageBadge, TextCell } from "@/components/crm/cells";
import { formatCurrency } from "@/lib/format";

export function DealsList({
  currency,
  canCreate,
  canDelete,
  canExport,
}: {
  currency: string;
  canCreate: boolean;
  canDelete: boolean;
  canExport: boolean;
}) {
  const renderCell = React.useCallback(
    (item: ListItem, key: string) => {
      switch (key) {
        case "name":
          return <LinkCell href={`/deals/${item.id}`} label={String(item.name)} strong />;
        case "amount":
          return <CurrencyCell value={item.amount} currency={String(item.currency ?? currency)} />;
        case "companyId": {
          const company = item.company as { id: string; name: string } | null;
          return company ? <LinkCell href={`/companies/${company.id}`} label={company.name} /> : <EmptyCell />;
        }
        case "pipelineId":
          return <TextCell value={(item.pipeline as { name: string } | null)?.name} />;
        case "stageId":
          return <StageBadge stage={item.stage as { name: string; type: string } | null} />;
        case "status":
          return <DealStatusBadge status={String(item.status)} />;
        case "ownerId":
          return <OwnerCell owner={item.owner as { id: string; name: string } | null} />;
        case "probability":
          return item.probability === null ? <EmptyCell /> : <NumberCell value={item.probability} />;
        case "expectedCloseDate":
        case "closedAt":
          return <DateCell value={item[key]} />;
        case "lastActivityAt":
          return <DateCell value={item.lastActivityAt} relative />;
        case "createdAt":
          return <DateCell value={item.createdAt} />;
        default:
          return <TextCell value={item[key]} />;
      }
    },
    [currency],
  );

  return (
    <RecordList
      objectType="DEAL"
      endpoint="/api/v1/deals"
      rowHref={(item) => `/deals/${item.id}`}
      renderCell={renderCell}
      createLabel="Deal erstellen"
      renderCreateForm={(close) => <DealForm onDone={(deal) => close(deal)} onCancel={() => close()} />}
      canCreate={canCreate}
      canDelete={canDelete}
      canExport={canExport}
      emptyTitle="Noch keine Deals vorhanden"
      emptyDescription="Lege den ersten Deal an, um Verkaufschancen entlang deiner Pipeline zu verfolgen."
      summary={(result) =>
        result.totalAmount !== undefined ? (
          <p className="text-xs text-ink-600">
            <span className="font-medium text-ink-900">{formatCurrency(result.totalAmount, currency)}</span> Gesamtwert
            der gefilterten Deals
          </p>
        ) : null
      }
    />
  );
}

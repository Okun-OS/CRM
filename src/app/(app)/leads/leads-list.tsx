"use client";

import * as React from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RecordList, type ListItem } from "@/components/crm/record-list";
import { LeadForm } from "@/components/crm/forms/lead-form";
import { useReference } from "@/components/app/reference-provider";
import { DateCell, EmptyCell, LinkCell, OptionBadge, OwnerCell, TextCell } from "@/components/crm/cells";

export function LeadsList({
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
          return <LinkCell href={`/leads/${item.id}`} label={String(item.name ?? item.lastName ?? "Lead")} strong />;
        case "status":
          return <OptionBadge value={item.status} options={data?.leadStatuses ?? []} tone="brand" />;
        case "ownerId":
          return <OwnerCell owner={item.owner as { id: string; name: string } | null} />;
        case "score": {
          const score = item.score as number | null;
          if (score === null || score === undefined) return <EmptyCell />;
          const tone = score >= 70 ? "success" : score >= 40 ? "warning" : "neutral";
          return <Badge tone={tone}>{score}</Badge>;
        }
        case "nextStepAt":
        case "lastActivityAt":
          return <DateCell value={item[key]} relative />;
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
      objectType="LEAD"
      endpoint="/api/v1/leads"
      rowHref={(item) => `/leads/${item.id}`}
      renderCell={renderCell}
      createLabel="Lead erstellen"
      renderCreateForm={(close) => <LeadForm onDone={(lead) => close(lead)} onCancel={() => close()} />}
      canCreate={canCreate}
      canDelete={canDelete}
      canExport={canExport}
      emptyTitle="Noch keine Leads vorhanden"
      emptyDescription="Erfasse den ersten Lead oder importiere eine Liste, um den Qualifizierungsprozess zu starten."
      extraActions={
        canImport ? (
          <Link href="/settings/import?objectType=LEAD">
            <Button variant="secondary" icon={<Upload className="h-4 w-4" />}>
              <span className="hidden sm:inline">Import</span>
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

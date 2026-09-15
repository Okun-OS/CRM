import { NextResponse } from "next/server";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { route } from "@/lib/api/route";
import { assertPermission } from "@/lib/context";
import { ValidationError } from "@/lib/api/errors";
import { toCsv } from "@/lib/csv";
import { fieldsFor, OBJECT_LABELS } from "@/lib/crm/fields";
import { readListQuery } from "@/server/services/listing";
import { listContacts } from "@/server/services/contacts";
import { listCompanies } from "@/server/services/companies";
import { listLeads } from "@/server/services/leads";
import { listDeals } from "@/server/services/deals";

const EXPORT_LIMIT = 5000;

/** CSV export of the current list query. Permission-checked like the list itself. */
export const GET = route<{ objectType: string }>(async ({ ctx, params, url }) => {
  const objectType = params.objectType.toUpperCase() as CrmObjectType;
  if (!(objectType in OBJECT_LABELS)) throw ValidationError("Unbekannter Objekttyp.");
  assertPermission(ctx, "exports.run");

  const query = { ...readListQuery(url), page: 1, pageSize: 100 };
  const rows: Record<string, unknown>[] = [];

  for (let page = 1; rows.length < EXPORT_LIMIT; page += 1) {
    const result = await loadPage(ctx, objectType, { ...query, page });
    rows.push(...(result.items as Record<string, unknown>[]));
    if (page >= result.totalPages) break;
  }

  const fields = fieldsFor(objectType);
  const headers = fields.map((field) => field.label);
  const body = rows.map((row) => fields.map((field) => formatValue(row, field.key)));

  return new NextResponse(toCsv(headers, body, ";"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${objectType.toLowerCase()}-export.csv"`,
      "cache-control": "private, no-store",
    },
  });
});

async function loadPage(
  ctx: Parameters<typeof listContacts>[0],
  objectType: CrmObjectType,
  query: ReturnType<typeof readListQuery>,
) {
  switch (objectType) {
    case "CONTACT":
      return listContacts(ctx, query);
    case "COMPANY":
      return listCompanies(ctx, query);
    case "LEAD":
      return listLeads(ctx, query);
    case "DEAL":
      return listDeals(ctx, query);
  }
}

/** Relations are exported by their display name, not their id. */
function formatValue(row: Record<string, unknown>, key: string): string {
  if (key === "companyId") return (row.company as { name?: string } | null)?.name ?? "";
  if (key === "ownerId") return (row.owner as { name?: string } | null)?.name ?? "";
  if (key === "stageId") return (row.stage as { name?: string } | null)?.name ?? "";
  if (key === "pipelineId") return (row.pipeline as { name?: string } | null)?.name ?? "";
  const value = row[key];
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value);
}

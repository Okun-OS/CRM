import { z } from "zod";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/api/errors";
import { parseCsv } from "@/lib/csv";
import { fieldsFor } from "@/lib/crm/fields";
import { listDefinitions } from "@/server/services/property-store";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";
import { createContact } from "./contacts";
import { createCompany } from "./companies";
import { createLead } from "./leads";
import { findExistingCompany, findExistingContact } from "./duplicates";

/**
 * CSV import.
 *
 * Flow: upload → header detection → mapping proposal → validation preview →
 * import → result report. The import runs inline with a hard row cap; a larger
 * volume belongs in a background queue (see docs/ARCHITECTURE.md → Limitations).
 */
export const MAX_IMPORT_ROWS = 5000;
const PREVIEW_ROWS = 5;

export const importAnalyzeSchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY", "LEAD"]),
  filename: z.string().max(200),
  content: z.string().max(10 * 1024 * 1024),
});

export const importRunSchema = importAnalyzeSchema.extend({
  /** CSV header → CRM field key (or `property:<key>`); unmapped headers are ignored. */
  mapping: z.record(z.string().max(200), z.string().max(80)),
  duplicateStrategy: z.enum(["SKIP", "UPDATE", "CREATE_ANYWAY"]).default("SKIP"),
});

/** Target fields a CSV column can be mapped to, including custom properties. */
export async function importTargets(ctx: ActorContext, objectType: CrmObjectType) {
  const builtIn = fieldsFor(objectType)
    .filter((field) => field.importable)
    .map((field) => ({ key: field.key, label: field.label, type: field.type, required: false }));

  const custom = (await listDefinitions(ctx, objectType)).map((definition) => ({
    key: `property:${definition.key}`,
    label: `${definition.label} (Eigenschaft)`,
    type: definition.type.toLowerCase(),
    required: definition.isRequired,
  }));

  const required =
    objectType === "CONTACT"
      ? ["firstName", "lastName"]
      : objectType === "COMPANY"
        ? ["name"]
        : ["lastName"];

  return { fields: [...builtIn, ...custom], required };
}

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Proposes a mapping by matching CSV headers against field keys and labels. */
export async function analyzeImport(ctx: ActorContext, input: z.infer<typeof importAnalyzeSchema>) {
  assertPermission(ctx, "imports.run");
  const parsed = parseCsv(input.content, { limit: MAX_IMPORT_ROWS });
  if (parsed.headers.length === 0) throw ValidationError("Die Datei enthält keine Kopfzeile.");

  const targets = await importTargets(ctx, input.objectType);
  const lookup = new Map<string, string>();
  for (const field of targets.fields) {
    lookup.set(normaliseHeader(field.key), field.key);
    lookup.set(normaliseHeader(field.label), field.key);
  }
  // Common German column headings.
  const aliases: Record<string, string> = {
    vorname: "firstName",
    nachname: "lastName",
    name: input.objectType === "COMPANY" ? "name" : "lastName",
    email: "email",
    mail: "email",
    telefon: "phone",
    tel: "phone",
    mobil: "mobile",
    firma: input.objectType === "COMPANY" ? "name" : "companyName",
    unternehmen: input.objectType === "COMPANY" ? "name" : "companyName",
    position: "jobTitle",
    stadt: "city",
    ort: "city",
    plz: "postalCode",
    land: "country",
    strasse: "street",
    quelle: "source",
    webseite: "website",
    website: "website",
    domain: "domain",
    branche: "industry",
  };

  const mapping: Record<string, string> = {};
  for (const header of parsed.headers) {
    const key = normaliseHeader(header);
    const target = lookup.get(key) ?? aliases[key];
    if (target && targets.fields.some((field) => field.key === target)) mapping[header] = target;
  }

  return {
    headers: parsed.headers,
    delimiter: parsed.delimiter,
    totalRows: parsed.rows.length,
    preview: parsed.rows.slice(0, PREVIEW_ROWS).map((row) =>
      Object.fromEntries(parsed.headers.map((header, index) => [header, row[index] ?? ""])),
    ),
    suggestedMapping: mapping,
    targets,
    truncated: parsed.rows.length >= MAX_IMPORT_ROWS,
  };
}

export type ImportError = { row: number; message: string; values?: Record<string, string> };

export async function runImport(ctx: ActorContext, input: z.infer<typeof importRunSchema>) {
  assertPermission(ctx, "imports.run");
  const parsed = parseCsv(input.content, { limit: MAX_IMPORT_ROWS });
  if (parsed.headers.length === 0) throw ValidationError("Die Datei enthält keine Kopfzeile.");

  const targets = await importTargets(ctx, input.objectType);
  const mappedFields = new Set(Object.values(input.mapping));
  const missingRequired = targets.required.filter((field) => !mappedFields.has(field));
  if (missingRequired.length > 0) {
    throw ValidationError(`Pflichtfelder sind nicht zugeordnet: ${missingRequired.join(", ")}`);
  }

  const job = await prisma.importJob.create({
    data: {
      organizationId: ctx.organizationId,
      objectType: input.objectType,
      filename: input.filename,
      status: "RUNNING",
      duplicateStrategy: input.duplicateStrategy,
      mapping: input.mapping as never,
      totalRows: parsed.rows.length,
      createdById: ctx.userId,
    },
  });

  const errors: ImportError[] = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, row] of parsed.rows.entries()) {
    const rowNumber = index + 2; // 1-based plus header row
    const values: Record<string, string> = {};
    parsed.headers.forEach((header, columnIndex) => {
      values[header] = row[columnIndex] ?? "";
    });

    try {
      const record: Record<string, unknown> = {};
      const properties: Record<string, unknown> = {};

      for (const [header, target] of Object.entries(input.mapping)) {
        const value = values[header]?.trim();
        if (!value) continue;
        if (target.startsWith("property:")) properties[target.slice("property:".length)] = value;
        else record[target] = value;
      }
      if (Object.keys(properties).length > 0) record.properties = properties;

      const outcome = await importRow(ctx, input.objectType, record, input.duplicateStrategy);
      if (outcome === "imported") imported += 1;
      else if (outcome === "updated") updated += 1;
      else skipped += 1;
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "Unbekannter Fehler",
        values,
      });
    }
  }

  const finished = await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: errors.length === parsed.rows.length && parsed.rows.length > 0 ? "FAILED" : "COMPLETED",
      importedRows: imported,
      updatedRows: updated,
      skippedRows: skipped,
      errorRows: errors.length,
      errors: errors.slice(0, 200) as never,
      finishedAt: new Date(),
    },
  });

  await writeAudit(ctx, {
    action: "import.completed",
    entityType: "ImportJob",
    entityId: job.id,
    after: { objectType: input.objectType, imported, updated, skipped, errors: errors.length },
  });

  return {
    id: finished.id,
    objectType: finished.objectType,
    status: finished.status,
    totalRows: finished.totalRows,
    imported,
    updated,
    skipped,
    errors: errors.slice(0, 50),
    errorCount: errors.length,
  };
}

async function importRow(
  ctx: ActorContext,
  objectType: CrmObjectType,
  record: Record<string, unknown>,
  strategy: "SKIP" | "UPDATE" | "CREATE_ANYWAY",
): Promise<"imported" | "updated" | "skipped"> {
  if (objectType === "CONTACT") {
    const existing = strategy === "CREATE_ANYWAY" ? null : await findExistingContact(ctx, record.email as string);
    if (existing) {
      if (strategy === "SKIP") return "skipped";
      const { updateContact } = await import("./contacts");
      await updateContact(ctx, existing.id, record);
      return "updated";
    }
    await createContact(ctx, record as never);
    return "imported";
  }

  if (objectType === "COMPANY") {
    const existing =
      strategy === "CREATE_ANYWAY"
        ? null
        : await findExistingCompany(ctx, record.domain as string, record.name as string);
    if (existing) {
      if (strategy === "SKIP") return "skipped";
      const { updateCompany } = await import("./companies");
      await updateCompany(ctx, existing.id, record);
      return "updated";
    }
    await createCompany(ctx, record as never);
    return "imported";
  }

  // Leads always need a status; fall back to the first configured one.
  if (!record.status) {
    const status = await prisma.leadStatusOption.findFirst({ where: scope(ctx), orderBy: { position: "asc" } });
    record.status = status?.key ?? "new";
  }
  await createLead(ctx, record as never);
  return "imported";
}

export const importJobQuerySchema = paginationSchema;

export async function listImportJobs(ctx: ActorContext, query: z.infer<typeof importJobQuerySchema>) {
  assertPermission(ctx, "imports.run");
  const where = scope(ctx);
  const [rows, total] = await Promise.all([
    prisma.importJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...skipTake(query),
      include: { createdBy: { select: { id: true, name: true } } },
    }),
    prisma.importJob.count({ where }),
  ]);

  return paginate(
    rows.map((row) => ({
      id: row.id,
      objectType: row.objectType,
      filename: row.filename,
      status: row.status,
      totalRows: row.totalRows,
      importedRows: row.importedRows,
      updatedRows: row.updatedRows,
      skippedRows: row.skippedRows,
      errorRows: row.errorRows,
      errors: row.errors,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    })),
    total,
    query,
  );
}

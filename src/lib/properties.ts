import { z } from "zod";
import type { CrmObjectType, PropertyType } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import type { ActorContext } from "./context";
import { ValidationError } from "./api/errors";
import { scope } from "./tenant";

/**
 * Custom property engine.
 *
 * Definitions are per organization and per object type; values are stored in
 * typed columns on PropertyValue so filters and sorting behave like they do for
 * built-in fields.
 */
export type PropertyDefinitionDTO = {
  id: string;
  objectType: CrmObjectType;
  key: string;
  label: string;
  description: string | null;
  type: PropertyType;
  options: { value: string; label: string }[];
  isRequired: boolean;
  isSystem: boolean;
  isArchived: boolean;
  groupName: string | null;
  position: number;
};

export const optionSchema = z.object({ value: z.string().min(1).max(64), label: z.string().min(1).max(120) });

/** Reserved keys that would collide with built-in fields. */
const RESERVED_KEYS = new Set([
  "id",
  "organizationid",
  "createdat",
  "updatedat",
  "deletedat",
  "ownerid",
  "name",
  "email",
  "firstname",
  "lastname",
]);

export const propertyKeySchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, "Nur Kleinbuchstaben, Zahlen und Unterstriche, beginnend mit einem Buchstaben.")
  .refine((key) => !RESERVED_KEYS.has(key), "Dieser Schlüssel ist für ein Systemfeld reserviert.");

export function mapDefinition(row: {
  id: string;
  objectType: CrmObjectType;
  key: string;
  label: string;
  description: string | null;
  type: PropertyType;
  options: unknown;
  isRequired: boolean;
  isSystem: boolean;
  isArchived: boolean;
  groupName: string | null;
  position: number;
}): PropertyDefinitionDTO {
  const parsed = z.array(optionSchema).safeParse(row.options ?? []);
  return { ...row, options: parsed.success ? parsed.data : [] };
}

export async function listDefinitions(
  ctx: ActorContext,
  objectType: CrmObjectType,
  includeArchived = false,
): Promise<PropertyDefinitionDTO[]> {
  const rows = await prisma.propertyDefinition.findMany({
    where: { ...scope(ctx), objectType, ...(includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ position: "asc" }, { label: "asc" }],
  });
  return rows.map(mapDefinition);
}

/** The PropertyValue column that holds a value of the given type. */
export function columnForType(type: PropertyType):
  | "valueText"
  | "valueNumber"
  | "valueBoolean"
  | "valueDate"
  | "valueJson" {
  switch (type) {
    case "NUMBER":
    case "CURRENCY":
      return "valueNumber";
    case "BOOLEAN":
      return "valueBoolean";
    case "DATE":
    case "DATETIME":
      return "valueDate";
    case "MULTISELECT":
      return "valueJson";
    default:
      return "valueText";
  }
}

export const entityColumnFor: Record<CrmObjectType, "contactId" | "companyId" | "leadId" | "dealId"> = {
  CONTACT: "contactId",
  COMPANY: "companyId",
  LEAD: "leadId",
  DEAL: "dealId",
};

/** Validates and normalises one incoming value against its definition. */
export function coerceValue(definition: PropertyDefinitionDTO, raw: unknown) {
  const empty = raw === null || raw === undefined || raw === "";
  if (empty) {
    if (definition.isRequired) {
      throw ValidationError(`Das Feld "${definition.label}" ist erforderlich.`, {
        fields: { [`properties.${definition.key}`]: "Pflichtfeld" },
      });
    }
    return { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueJson: null };
  }

  const fail = (message: string): never => {
    throw ValidationError(message, { fields: { [`properties.${definition.key}`]: message } });
  };

  const base = { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueJson: null };

  switch (definition.type) {
    case "NUMBER":
    case "CURRENCY": {
      const num = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(num)) fail(`"${definition.label}" muss eine Zahl sein.`);
      return { ...base, valueNumber: num };
    }
    case "BOOLEAN":
      return { ...base, valueBoolean: raw === true || raw === "true" };
    case "DATE":
    case "DATETIME": {
      const date = new Date(String(raw));
      if (Number.isNaN(date.getTime())) fail(`"${definition.label}" muss ein gültiges Datum sein.`);
      return { ...base, valueDate: date };
    }
    case "SELECT": {
      const value = String(raw);
      if (!definition.options.some((o) => o.value === value)) {
        fail(`"${value}" ist kein gültiger Wert für "${definition.label}".`);
      }
      return { ...base, valueText: value };
    }
    case "MULTISELECT": {
      const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const invalid = values.filter((v) => !definition.options.some((o) => o.value === v));
      if (invalid.length > 0) fail(`Ungültige Werte für "${definition.label}": ${invalid.join(", ")}`);
      return { ...base, valueJson: values };
    }
    case "EMAIL": {
      const value = String(raw).trim();
      if (!z.string().email().safeParse(value).success) fail(`"${definition.label}" muss eine E-Mail-Adresse sein.`);
      return { ...base, valueText: value };
    }
    case "URL": {
      const value = String(raw).trim();
      if (!z.string().url().safeParse(value).success) fail(`"${definition.label}" muss eine gültige URL sein.`);
      return { ...base, valueText: value };
    }
    case "TEXT":
    case "PHONE":
      return { ...base, valueText: String(raw).slice(0, 500) };
    case "TEXTAREA":
      return { ...base, valueText: String(raw).slice(0, 10_000) };
    default:
      return { ...base, valueText: String(raw) };
  }
}

/** Reads stored values back into a plain `{ key: value }` map. */
export function readValues(
  definitions: PropertyDefinitionDTO[],
  rows: {
    definitionId: string;
    valueText: string | null;
    valueNumber: unknown;
    valueBoolean: boolean | null;
    valueDate: Date | null;
    valueJson: unknown;
  }[],
): Record<string, unknown> {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const def = byId.get(row.definitionId);
    if (!def) continue;
    switch (columnForType(def.type)) {
      case "valueNumber":
        out[def.key] = row.valueNumber === null ? null : Number(row.valueNumber);
        break;
      case "valueBoolean":
        out[def.key] = row.valueBoolean;
        break;
      case "valueDate":
        out[def.key] = row.valueDate?.toISOString() ?? null;
        break;
      case "valueJson":
        out[def.key] = row.valueJson ?? [];
        break;
      default:
        out[def.key] = row.valueText;
    }
  }
  return out;
}

/**
 * Writes a partial `{ key: value }` map for one record. Unknown keys are
 * rejected rather than silently dropped, so typos surface immediately.
 */
export async function writeValues(
  ctx: ActorContext,
  objectType: CrmObjectType,
  entityId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const keys = Object.keys(values);
  if (keys.length === 0) return;

  const definitions = await listDefinitions(ctx, objectType);
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const unknown = keys.filter((key) => !byKey.has(key));
  if (unknown.length > 0) {
    throw ValidationError(`Unbekannte Eigenschaften: ${unknown.join(", ")}`);
  }

  const entityColumn = entityColumnFor[objectType];

  for (const key of keys) {
    const definition = byKey.get(key)!;
    const coerced = coerceValue(definition, values[key]);
    // Prisma distinguishes "JSON null" from "SQL NULL" — clearing a value means SQL NULL.
    const columns = {
      ...coerced,
      valueJson: (coerced.valueJson ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    };
    await prisma.propertyValue.upsert({
      where: { [`definitionId_${entityColumn}`]: { definitionId: definition.id, [entityColumn]: entityId } } as never,
      create: {
        organizationId: ctx.organizationId,
        definitionId: definition.id,
        objectType,
        [entityColumn]: entityId,
        ...columns,
      } as never,
      update: columns,
    });
  }
}

/** Enforces required custom properties when creating a record. */
export async function assertRequiredProperties(
  ctx: ActorContext,
  objectType: CrmObjectType,
  values: Record<string, unknown>,
): Promise<void> {
  const definitions = await listDefinitions(ctx, objectType);
  for (const definition of definitions) {
    if (!definition.isRequired) continue;
    const value = values[definition.key];
    if (value === undefined || value === null || value === "") {
      throw ValidationError(`Das Feld "${definition.label}" ist erforderlich.`, {
        fields: { [`properties.${definition.key}`]: "Pflichtfeld" },
      });
    }
  }
}

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { ValidationError } from "@/lib/api/errors";
import type { CrmObjectType } from "@/generated/prisma/enums";
import {
  coerceValue,
  entityColumnFor,
  mapDefinition,
  type PropertyDefinitionDTO,
} from "@/lib/properties";

/**
 * Custom property storage: reads and writes the typed EAV rows for one
 * organization. Kept apart from `src/lib/properties.ts` so the pure validation
 * helpers stay importable from client components.
 */
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

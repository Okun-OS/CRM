import { z } from "zod";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { mapDefinition, optionSchema, propertyKeySchema } from "@/lib/properties";

/** Administration of custom properties. System properties are protected. */
export const propertyDefinitionSchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY", "LEAD", "DEAL"]),
  key: propertyKeySchema,
  label: z.string().trim().min(1, "Bezeichnung ist erforderlich.").max(120),
  description: z.string().trim().max(500).optional(),
  type: z.enum([
    "TEXT",
    "TEXTAREA",
    "NUMBER",
    "CURRENCY",
    "DATE",
    "DATETIME",
    "BOOLEAN",
    "SELECT",
    "MULTISELECT",
    "URL",
    "EMAIL",
    "PHONE",
  ]),
  options: z.array(optionSchema).max(100).optional(),
  isRequired: z.boolean().default(false),
  groupName: z.string().trim().max(80).optional(),
});

export const propertyUpdateSchema = propertyDefinitionSchema
  .omit({ objectType: true, key: true, type: true })
  .extend({ isArchived: z.boolean().optional() });

export async function listAllDefinitions(ctx: ActorContext, objectType?: CrmObjectType) {
  assertPermission(ctx, "views.read");
  const rows = await prisma.propertyDefinition.findMany({
    where: { ...scope(ctx), ...(objectType ? { objectType } : {}) },
    orderBy: [{ objectType: "asc" }, { position: "asc" }],
  });
  return rows.map(mapDefinition);
}

export async function createDefinition(ctx: ActorContext, input: z.input<typeof propertyDefinitionSchema>) {
  assertPermission(ctx, "properties.manage");
  const data = propertyDefinitionSchema.parse(input);
  assertOptionsMatchType(data.type, data.options);

  const existing = await prisma.propertyDefinition.findFirst({
    where: { ...scope(ctx), objectType: data.objectType, key: data.key },
  });
  if (existing) throw Conflict(`Für ${data.objectType} existiert bereits eine Eigenschaft mit dem Schlüssel "${data.key}".`);

  const count = await prisma.propertyDefinition.count({ where: { ...scope(ctx), objectType: data.objectType } });
  const definition = await prisma.propertyDefinition.create({
    data: {
      organizationId: ctx.organizationId,
      objectType: data.objectType,
      key: data.key,
      label: data.label,
      description: data.description,
      type: data.type,
      options: data.options ?? [],
      isRequired: data.isRequired,
      groupName: data.groupName,
      position: count,
    },
  });

  await writeAudit(ctx, {
    action: "property.created",
    entityType: "PropertyDefinition",
    entityId: definition.id,
    after: { objectType: data.objectType, key: data.key, type: data.type },
  });

  return mapDefinition(definition);
}

export async function updateDefinition(ctx: ActorContext, id: string, input: z.input<typeof propertyUpdateSchema>) {
  assertPermission(ctx, "properties.manage");
  const data = propertyUpdateSchema.parse(input);

  const existing = assertFound(
    await prisma.propertyDefinition.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Eigenschaft wurde nicht gefunden.",
  );
  if (existing.isSystem) throw ValidationError("Systemeigenschaften können nicht verändert werden.");
  assertOptionsMatchType(existing.type, data.options);

  const definition = await prisma.propertyDefinition.update({
    where: { id: existing.id },
    data: {
      label: data.label,
      description: data.description,
      options: data.options ?? undefined,
      isRequired: data.isRequired,
      groupName: data.groupName,
      isArchived: data.isArchived,
    },
  });

  await writeAudit(ctx, {
    action: "property.updated",
    entityType: "PropertyDefinition",
    entityId: id,
    before: { label: existing.label, isRequired: existing.isRequired, isArchived: existing.isArchived },
    after: { label: definition.label, isRequired: definition.isRequired, isArchived: definition.isArchived },
  });

  return mapDefinition(definition);
}

/**
 * Archives a property. Deleting is only offered when no values exist, so a
 * definition can never silently take data with it.
 */
export async function deleteDefinition(ctx: ActorContext, id: string) {
  assertPermission(ctx, "properties.manage");
  const existing = assertFound(
    await prisma.propertyDefinition.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Eigenschaft wurde nicht gefunden.",
  );
  if (existing.isSystem) throw ValidationError("Systemeigenschaften können nicht gelöscht werden.");

  const values = await prisma.propertyValue.count({ where: { definitionId: id } });
  if (values > 0) {
    throw Conflict(
      `Diese Eigenschaft enthält ${values} gespeicherte Werte. Sie kann archiviert, aber nicht gelöscht werden.`,
    );
  }

  await prisma.propertyDefinition.delete({ where: { id: existing.id } });
  await writeAudit(ctx, {
    action: "property.deleted",
    entityType: "PropertyDefinition",
    entityId: id,
    before: { key: existing.key, objectType: existing.objectType },
  });
}

function assertOptionsMatchType(type: string, options?: { value: string; label: string }[]) {
  const needsOptions = type === "SELECT" || type === "MULTISELECT";
  if (needsOptions && (!options || options.length === 0)) {
    throw ValidationError("Für Auswahlfelder muss mindestens eine Option definiert werden.");
  }
  if (!needsOptions && options && options.length > 0) {
    throw ValidationError("Optionen sind nur für Auswahlfelder zulässig.");
  }
  if (options) {
    const values = new Set<string>();
    for (const option of options) {
      if (values.has(option.value)) throw ValidationError(`Die Option "${option.value}" kommt mehrfach vor.`);
      values.add(option.value);
    }
  }
}

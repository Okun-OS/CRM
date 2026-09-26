import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { filterGroupSchema } from "@/lib/filters";

/**
 * Listen — der Arbeitsvorrat für Recherche und Kampagnen.
 *
 * Zwei Arten mit unterschiedlichem Zweck: Eine **statische** Liste ist eine
 * Auswahl, die jemand getroffen hat und die sich nicht unter der Hand ändert.
 * Eine **dynamische** Liste ist eine Frage an den Bestand, deren Antwort sich
 * mitbewegt. Für eine laufende Kampagne ist die erste richtig — sonst stünden
 * morgen andere Menschen darin als gestern.
 */
export const prospectListInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
    description: z.string().trim().max(500).optional(),
    kind: z.enum(["STATIC", "DYNAMIC"]).default("STATIC"),
    filter: filterGroupSchema.optional(),
    ownerId: z.string().max(30).optional(),
  })
  .refine((value) => value.kind !== "DYNAMIC" || Boolean(value.filter), {
    message: "Eine dynamische Liste braucht einen Filter.",
    path: ["filter"],
  });

/** Felder, nach denen eine dynamische Liste filtern darf. */
const FILTER_FIELDS: Record<string, { column: string; type: "text" | "number" }> = {
  companyName: { column: "companyName", type: "text" },
  domain: { column: "domain", type: "text" },
  industry: { column: "industry", type: "text" },
  city: { column: "city", type: "text" },
  country: { column: "country", type: "text" },
  jobTitle: { column: "jobTitle", type: "text" },
  sourceKey: { column: "sourceKey", type: "text" },
  stage: { column: "stage", type: "text" },
  employeeCount: { column: "employeeCount", type: "number" },
  score: { column: "score", type: "number" },
};

export const PROSPECT_FILTER_FIELDS = Object.keys(FILTER_FIELDS);

/**
 * Übersetzt den Filter einer dynamischen Liste in eine Abfrage.
 *
 * Bewusst eine eigene, kleine Übersetzung statt der CRM-Variante: Die dortige
 * kennt eigene Eigenschaften und Beziehungen, die es bei Prospects nicht gibt.
 * Eine geliehene Übersetzung hätte Felder angeboten, die ins Leere zeigen.
 */
export function prospectFilterWhere(filter: unknown): Prisma.ProspectWhereInput {
  const parsed = filterGroupSchema.safeParse(filter);
  if (!parsed.success) return {};

  const build = (group: z.infer<typeof filterGroupSchema>): Prisma.ProspectWhereInput => {
    const clauses: Prisma.ProspectWhereInput[] = [];

    for (const condition of group.conditions ?? []) {
      const field = FILTER_FIELDS[condition.field];
      if (!field) throw ValidationError(`Unbekanntes Filterfeld: „${condition.field}".`);
      const value = condition.value;

      if (condition.operator === "known") {
        clauses.push({ NOT: { [field.column]: null } } as Prisma.ProspectWhereInput);
        continue;
      }
      if (condition.operator === "unknown") {
        clauses.push({ [field.column]: null } as Prisma.ProspectWhereInput);
        continue;
      }

      if (field.type === "number") {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) throw ValidationError("Für dieses Feld wird eine Zahl erwartet.");
        const map: Record<string, string> = { eq: "equals", neq: "not", gt: "gt", gte: "gte", lt: "lt", lte: "lte" };
        const operator = map[condition.operator];
        if (!operator) throw ValidationError(`Operator „${condition.operator}" passt nicht zu einer Zahl.`);
        clauses.push({ [field.column]: { [operator]: numeric } } as Prisma.ProspectWhereInput);
        continue;
      }

      const text = String(value ?? "");
      switch (condition.operator) {
        case "eq":
          clauses.push({ [field.column]: { equals: text, mode: "insensitive" } } as Prisma.ProspectWhereInput);
          break;
        case "neq":
          clauses.push({ NOT: { [field.column]: { equals: text, mode: "insensitive" } } } as Prisma.ProspectWhereInput);
          break;
        case "contains":
          clauses.push({ [field.column]: { contains: text, mode: "insensitive" } } as Prisma.ProspectWhereInput);
          break;
        case "not_contains":
          clauses.push({ NOT: { [field.column]: { contains: text, mode: "insensitive" } } } as Prisma.ProspectWhereInput);
          break;
        case "starts_with":
          clauses.push({ [field.column]: { startsWith: text, mode: "insensitive" } } as Prisma.ProspectWhereInput);
          break;
        case "in":
          clauses.push({ [field.column]: { in: Array.isArray(value) ? value.map(String) : [text] } } as Prisma.ProspectWhereInput);
          break;
        case "not_in":
          clauses.push({ NOT: { [field.column]: { in: Array.isArray(value) ? value.map(String) : [text] } } } as Prisma.ProspectWhereInput);
          break;
        default:
          throw ValidationError(`Operator „${condition.operator}" passt nicht zu einem Textfeld.`);
      }
    }

    for (const nested of group.groups ?? []) clauses.push(build(nested));
    if (clauses.length === 0) return {};
    return group.combinator === "OR" ? { OR: clauses } : { AND: clauses };
  };

  return build(parsed.data);
}

/** Die Abfrage, die die Mitglieder einer Liste ergibt — beide Arten. */
export function membershipWhere(list: { id: string; kind: string; filter: unknown }): Prisma.ProspectWhereInput {
  return list.kind === "DYNAMIC"
    ? prospectFilterWhere(list.filter)
    : { listMemberships: { some: { listId: list.id } } };
}

export async function listProspectLists(ctx: ActorContext) {
  assertPermission(ctx, "prospects.read");
  const lists = await prisma.prospectList.findMany({
    where: { ...scope(ctx), archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { owner: { select: { id: true, name: true } } },
  });

  // Die Anzahl wird je Liste frisch gezählt: Bei dynamischen Listen ist sie
  // eine Antwort auf eine Frage, keine gespeicherte Zahl.
  return Promise.all(
    lists.map(async (list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      kind: list.kind,
      filter: list.filter,
      owner: list.owner,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
      count: await prisma.prospect.count({
        where: { ...scope(ctx), deletedAt: null, ...membershipWhere(list) },
      }),
    })),
  );
}

export async function getProspectList(ctx: ActorContext, id: string) {
  assertPermission(ctx, "prospects.read");
  const list = assertFound(
    await prisma.prospectList.findFirst({
      where: { id, ...scope(ctx) },
      include: { owner: { select: { id: true, name: true } } },
    }),
    "Die Liste wurde nicht gefunden.",
  );

  return {
    id: list.id,
    name: list.name,
    description: list.description,
    kind: list.kind,
    filter: list.filter,
    owner: list.owner,
    createdAt: list.createdAt.toISOString(),
    count: await prisma.prospect.count({ where: { ...scope(ctx), deletedAt: null, ...membershipWhere(list) } }),
  };
}

export async function createProspectList(ctx: ActorContext, input: z.input<typeof prospectListInputSchema>) {
  assertPermission(ctx, "prospects.write");
  const data = prospectListInputSchema.parse(input);
  if (data.filter) prospectFilterWhere(data.filter);

  const existing = await prisma.prospectList.findFirst({ where: { ...scope(ctx), name: data.name } });
  if (existing) throw Conflict("Eine Liste mit diesem Namen existiert bereits.");

  const list = await prisma.prospectList.create({
    data: {
      organizationId: ctx.organizationId,
      name: data.name,
      description: data.description,
      kind: data.kind,
      filter: (data.filter ?? undefined) as Prisma.InputJsonValue | undefined,
      ownerId: data.ownerId ?? ctx.userId,
      createdById: ctx.userId,
    },
  });

  await writeAudit(ctx, {
    action: "prospect_list.created",
    entityType: "ProspectList",
    entityId: list.id,
    after: { name: list.name, kind: list.kind },
  });

  return list;
}

export async function updateProspectList(ctx: ActorContext, id: string, input: z.input<typeof prospectListInputSchema>) {
  assertPermission(ctx, "prospects.write");
  const data = prospectListInputSchema.parse(input);
  if (data.filter) prospectFilterWhere(data.filter);

  const existing = assertFound(
    await prisma.prospectList.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Liste wurde nicht gefunden.",
  );

  const list = await prisma.prospectList.update({
    where: { id: existing.id },
    data: {
      name: data.name,
      description: data.description,
      kind: data.kind,
      filter: (data.filter ?? undefined) as Prisma.InputJsonValue | undefined,
      ownerId: data.ownerId ?? existing.ownerId,
    },
  });

  await writeAudit(ctx, {
    action: "prospect_list.updated",
    entityType: "ProspectList",
    entityId: list.id,
    before: { name: existing.name, kind: existing.kind },
    after: { name: list.name, kind: list.kind },
  });

  return list;
}

export async function archiveProspectList(ctx: ActorContext, id: string) {
  assertPermission(ctx, "prospects.write");
  const existing = assertFound(
    await prisma.prospectList.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Liste wurde nicht gefunden.",
  );

  const running = await prisma.sequenceEnrollment.count({
    where: { organizationId: ctx.organizationId, listId: existing.id, status: "ACTIVE" },
  });
  if (running > 0) {
    throw Conflict(
      `Aus dieser Liste laufen noch ${running} Einschreibungen. Bitte zuerst die Sequenz beenden.`,
    );
  }

  await prisma.prospectList.update({ where: { id: existing.id }, data: { archivedAt: new Date() } });
  await writeAudit(ctx, {
    action: "prospect_list.archived",
    entityType: "ProspectList",
    entityId: id,
    before: { name: existing.name },
  });
}

export async function setListMembers(
  ctx: ActorContext,
  listId: string,
  prospectIds: string[],
  mode: "add" | "remove",
) {
  assertPermission(ctx, "prospects.write");
  const list = assertFound(
    await prisma.prospectList.findFirst({ where: { id: listId, ...scope(ctx) } }),
    "Die Liste wurde nicht gefunden.",
  );
  if (list.kind === "DYNAMIC") {
    throw ValidationError(
      "Eine dynamische Liste ergibt sich aus ihrem Filter. Ändern Sie den Filter statt der Mitglieder.",
    );
  }

  // Nur Prospects der eigenen Organisation — die ID allein genügt nicht.
  const valid = await prisma.prospect.findMany({
    where: { id: { in: prospectIds }, ...scope(ctx), deletedAt: null },
    select: { id: true },
  });

  if (mode === "add") {
    for (const prospect of valid) {
      await prisma.prospectListMembership.upsert({
        where: { listId_prospectId: { listId: list.id, prospectId: prospect.id } },
        create: { organizationId: ctx.organizationId, listId: list.id, prospectId: prospect.id, addedById: ctx.userId },
        update: {},
      });
    }
  } else {
    await prisma.prospectListMembership.deleteMany({
      where: { listId: list.id, prospectId: { in: valid.map((entry) => entry.id) } },
    });
  }

  await writeAudit(ctx, {
    action: mode === "add" ? "prospect_list.members_added" : "prospect_list.members_removed",
    entityType: "ProspectList",
    entityId: list.id,
    after: { count: valid.length },
  });

  return { affected: valid.length };
}

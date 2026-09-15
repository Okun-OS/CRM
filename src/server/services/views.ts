import { z } from "zod";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, Forbidden } from "@/lib/api/errors";
import { filterGroupSchema } from "@/lib/filters";
import { resolveColumns } from "./listing";

/** Saved views: a named filter + column + sort configuration per object. */
export const savedViewSchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY", "LEAD", "DEAL"]),
  name: z.string().trim().min(1, "Name ist erforderlich.").max(80),
  filter: filterGroupSchema,
  columns: z.array(z.string().max(80)).max(30),
  sort: z.object({ field: z.string().max(80), direction: z.enum(["asc", "desc"]) }).optional(),
  isShared: z.boolean().default(false),
});

export async function listViews(ctx: ActorContext, objectType: CrmObjectType) {
  assertPermission(ctx, "views.read");
  const views = await prisma.savedView.findMany({
    where: { ...scope(ctx), objectType, OR: [{ ownerId: ctx.userId }, { isShared: true }] },
    include: { owner: { select: { id: true, name: true } } },
    orderBy: [{ isShared: "asc" }, { name: "asc" }],
  });

  return views.map((view) => ({
    id: view.id,
    name: view.name,
    objectType: view.objectType,
    filter: view.filter,
    columns: view.columns,
    sort: view.sort,
    isShared: view.isShared,
    owner: view.owner,
    isOwn: view.ownerId === ctx.userId,
  }));
}

export async function createView(ctx: ActorContext, input: z.input<typeof savedViewSchema>) {
  assertPermission(ctx, "views.write");
  const data = savedViewSchema.parse(input);

  const existing = await prisma.savedView.findFirst({
    where: { ...scope(ctx), objectType: data.objectType, ownerId: ctx.userId, name: data.name },
  });
  if (existing) throw Conflict("Eine Ansicht mit diesem Namen existiert bereits.");

  const view = await prisma.savedView.create({
    data: {
      organizationId: ctx.organizationId,
      objectType: data.objectType,
      name: data.name,
      filter: data.filter as never,
      columns: resolveColumns(data.objectType, data.columns) as never,
      sort: (data.sort ?? undefined) as never,
      isShared: data.isShared,
      ownerId: ctx.userId,
    },
  });

  await writeAudit(ctx, {
    action: "view.created",
    entityType: "SavedView",
    entityId: view.id,
    after: { name: view.name, objectType: view.objectType },
  });
  return view;
}

export async function updateView(ctx: ActorContext, id: string, input: z.input<typeof savedViewSchema>) {
  assertPermission(ctx, "views.write");
  const data = savedViewSchema.parse(input);
  const existing = assertFound(
    await prisma.savedView.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Ansicht wurde nicht gefunden.",
  );
  if (existing.ownerId !== ctx.userId) throw Forbidden("Nur die Eigentümerin oder der Eigentümer kann diese Ansicht ändern.");

  return prisma.savedView.update({
    where: { id: existing.id },
    data: {
      name: data.name,
      filter: data.filter as never,
      columns: resolveColumns(data.objectType, data.columns) as never,
      sort: (data.sort ?? undefined) as never,
      isShared: data.isShared,
    },
  });
}

export async function deleteView(ctx: ActorContext, id: string) {
  assertPermission(ctx, "views.write");
  const existing = assertFound(
    await prisma.savedView.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Ansicht wurde nicht gefunden.",
  );
  if (existing.ownerId !== ctx.userId) throw Forbidden("Nur die Eigentümerin oder der Eigentümer kann diese Ansicht löschen.");
  await prisma.savedView.delete({ where: { id: existing.id } });
  await writeAudit(ctx, { action: "view.deleted", entityType: "SavedView", entityId: id, before: { name: existing.name } });
}

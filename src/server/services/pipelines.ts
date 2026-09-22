import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, ValidationError } from "@/lib/api/errors";

/**
 * Pipelines and their stages are configuration, not code: administrators
 * manage them at runtime and multiple pipelines per organization are supported.
 */
export const stageInputSchema = z.object({
  id: z.string().max(30).optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, "Nur Kleinbuchstaben, Zahlen und Unterstriche."),
  name: z.string().trim().min(1).max(80),
  probability: z.coerce.number().int().min(0).max(100).default(0),
  type: z.enum(["OPEN", "WON", "LOST"]).default("OPEN"),
});

export const pipelineInputSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(80),
  isDefault: z.boolean().default(false),
  stages: z.array(stageInputSchema).min(2, "Eine Pipeline braucht mindestens zwei Stages.").max(20),
});

export type PipelineDTO = {
  id: string;
  name: string;
  isDefault: boolean;
  position: number;
  stages: { id: string; key: string; name: string; position: number; probability: number; type: string; dealCount: number }[];
};

export async function listPipelines(ctx: ActorContext): Promise<PipelineDTO[]> {
  const pipelines = await prisma.pipeline.findMany({
    where: { ...scope(ctx), isArchived: false },
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: { _count: { select: { deals: { where: { deletedAt: null } } } } },
      },
    },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
  });

  return pipelines.map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.isDefault,
    position: pipeline.position,
    stages: pipeline.stages.map((stage) => ({
      id: stage.id,
      key: stage.key,
      name: stage.name,
      position: stage.position,
      probability: stage.probability,
      type: stage.type,
      dealCount: stage._count.deals,
    })),
  }));
}

export async function getDefaultPipeline(ctx: ActorContext) {
  const pipeline = await prisma.pipeline.findFirst({
    where: { ...scope(ctx), isArchived: false },
    include: { stages: { orderBy: { position: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
  });
  return pipeline;
}

export async function createPipeline(ctx: ActorContext, input: z.input<typeof pipelineInputSchema>) {
  assertPermission(ctx, "pipelines.manage");
  const data = pipelineInputSchema.parse(input);
  assertStageShape(data.stages);

  const existing = await prisma.pipeline.findFirst({ where: { ...scope(ctx), name: data.name } });
  if (existing) throw Conflict("Eine Pipeline mit diesem Namen existiert bereits.");

  const count = await prisma.pipeline.count({ where: scope(ctx) });
  const pipeline = await prisma.pipeline.create({
    data: {
      organizationId: ctx.organizationId,
      name: data.name,
      isDefault: data.isDefault || count === 0,
      position: count,
      stages: {
        create: data.stages.map((stage, index) => ({
          organizationId: ctx.organizationId,
          key: stage.key,
          name: stage.name,
          position: index,
          probability: stage.probability,
          type: stage.type,
        })),
      },
    },
    include: { stages: true },
  });

  if (pipeline.isDefault) await clearOtherDefaults(ctx, pipeline.id);

  await writeAudit(ctx, {
    action: "pipeline.created",
    entityType: "Pipeline",
    entityId: pipeline.id,
    after: { name: pipeline.name, stages: pipeline.stages.map((stage) => stage.name) },
  });

  return pipeline;
}

/**
 * Updates a pipeline and reconciles its stages. Stages that still hold deals
 * are never silently deleted — the caller must move those deals first.
 */
export async function updatePipeline(ctx: ActorContext, id: string, input: z.input<typeof pipelineInputSchema>) {
  assertPermission(ctx, "pipelines.manage");
  const data = pipelineInputSchema.parse(input);
  assertStageShape(data.stages);

  const pipeline = assertFound(
    await prisma.pipeline.findFirst({ where: { id, ...scope(ctx) }, include: { stages: true } }),
    "Die Pipeline wurde nicht gefunden.",
  );

  // Eine übergebene Stage wird über ihre id erkannt und, wenn keine mitkommt,
  // über ihren Schlüssel — der ist je Pipeline eindeutig. Ohne den zweiten Weg
  // gälte ein Aufruf ohne ids als „alle Stages entfernt, alle neu angelegt",
  // und das Neuanlegen scheitert dann an genau dieser Eindeutigkeit.
  const byId = new Map(pipeline.stages.map((stage) => [stage.id, stage]));
  const byKey = new Map(pipeline.stages.map((stage) => [stage.key, stage]));
  const matched = data.stages.map((stage) => ({
    stage,
    existing: (stage.id ? byId.get(stage.id) : undefined) ?? byKey.get(stage.key),
  }));

  const keptIds = new Set(matched.map((entry) => entry.existing?.id).filter(Boolean) as string[]);
  const removed = pipeline.stages.filter((stage) => !keptIds.has(stage.id));

  if (removed.length > 0) {
    const blocking = await prisma.deal.count({
      where: { stageId: { in: removed.map((stage) => stage.id) }, deletedAt: null, ...scope(ctx) },
    });
    if (blocking > 0) {
      throw Conflict(
        `Es befinden sich noch ${blocking} Deals in den zu entfernenden Stages. Bitte zuerst verschieben.`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.pipeline.update({
      where: { id: pipeline.id },
      data: { name: data.name, isDefault: data.isDefault },
    });

    // Erst entfernen, dann schreiben: Sonst kollidiert eine Stage, die den
    // Schlüssel einer gerade entfernten übernimmt, mit deren Eindeutigkeit.
    if (removed.length > 0) {
      await tx.pipelineStage.deleteMany({ where: { id: { in: removed.map((stage) => stage.id) } } });
    }

    for (const [index, { stage, existing }] of matched.entries()) {
      if (existing) {
        await tx.pipelineStage.update({
          where: { id: existing.id },
          data: { key: stage.key, name: stage.name, position: index, probability: stage.probability, type: stage.type },
        });
      } else {
        await tx.pipelineStage.create({
          data: {
            organizationId: ctx.organizationId,
            pipelineId: pipeline.id,
            key: stage.key,
            name: stage.name,
            position: index,
            probability: stage.probability,
            type: stage.type,
          },
        });
      }
    }
  });

  if (data.isDefault) await clearOtherDefaults(ctx, pipeline.id);

  await writeAudit(ctx, {
    action: "pipeline.updated",
    entityType: "Pipeline",
    entityId: pipeline.id,
    before: { name: pipeline.name, stages: pipeline.stages.map((stage) => stage.name) },
    after: { name: data.name, stages: data.stages.map((stage) => stage.name) },
  });

  return listPipelines(ctx);
}

export async function archivePipeline(ctx: ActorContext, id: string) {
  assertPermission(ctx, "pipelines.manage");
  const pipeline = assertFound(
    await prisma.pipeline.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Pipeline wurde nicht gefunden.",
  );

  const remaining = await prisma.pipeline.count({ where: { ...scope(ctx), isArchived: false } });
  if (remaining <= 1) throw Conflict("Die letzte aktive Pipeline kann nicht archiviert werden.");

  const openDeals = await prisma.deal.count({ where: { pipelineId: id, deletedAt: null, ...scope(ctx) } });
  if (openDeals > 0) throw Conflict(`Diese Pipeline enthält noch ${openDeals} Deals.`);

  await prisma.pipeline.update({ where: { id: pipeline.id }, data: { isArchived: true, isDefault: false } });
  await writeAudit(ctx, { action: "pipeline.archived", entityType: "Pipeline", entityId: id, before: { name: pipeline.name } });
}

function assertStageShape(stages: z.infer<typeof stageInputSchema>[]) {
  const keys = new Set<string>();
  for (const stage of stages) {
    if (keys.has(stage.key)) throw ValidationError(`Der Stage-Schlüssel "${stage.key}" kommt mehrfach vor.`);
    keys.add(stage.key);
  }
  if (!stages.some((stage) => stage.type === "WON")) {
    throw ValidationError("Eine Pipeline benötigt eine Gewonnen-Stage.");
  }
  if (!stages.some((stage) => stage.type === "LOST")) {
    throw ValidationError("Eine Pipeline benötigt eine Verloren-Stage.");
  }
}

async function clearOtherDefaults(ctx: ActorContext, pipelineId: string) {
  await prisma.pipeline.updateMany({
    where: { ...scope(ctx), id: { not: pipelineId } },
    data: { isDefault: false },
  });
}

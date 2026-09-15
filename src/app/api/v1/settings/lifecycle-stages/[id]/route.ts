import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { deleteLifecycleStage, updateLifecycleStage } from "@/server/services/settings";

const patchSchema = z.object({ label: z.string().trim().min(1).max(80), position: z.coerce.number().int().min(0).optional() });

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateLifecycleStage(ctx, params.id, await readBody(req, patchSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteLifecycleStage(ctx, params.id);
  return { ok: true };
});

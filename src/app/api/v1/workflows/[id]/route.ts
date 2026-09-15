import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { deleteWorkflow, getWorkflow, setWorkflowActive, updateWorkflow } from "@/server/services/workflows";
import { workflowInputSchema } from "@/server/workflows/types";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getWorkflow(ctx, params.id));

export const PUT = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateWorkflow(ctx, params.id, await readBody(req, workflowInputSchema)),
);

/** Activating and deactivating is separate from editing the definition. */
export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readBody(req, z.object({ isActive: z.boolean() }));
  await setWorkflowActive(ctx, params.id, body.isActive);
  return { ok: true };
});

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteWorkflow(ctx, params.id);
  return { ok: true };
});

import { route, readBody } from "@/lib/api/route";
import { taskUpdateSchema } from "@/lib/schemas/crm";
import { deleteTask, updateTask } from "@/server/services/tasks";

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateTask(ctx, params.id, await readBody(req, taskUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteTask(ctx, params.id);
  return { ok: true };
});

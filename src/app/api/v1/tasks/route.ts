import { route, readBody } from "@/lib/api/route";
import { taskInputSchema } from "@/lib/schemas/crm";
import { createTask, listTasks, taskListQuerySchema } from "@/server/services/tasks";

export const GET = route(async ({ ctx, url }) => {
  const query = taskListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
  return listTasks(ctx, query);
});

export const POST = route(async ({ req, ctx }) => createTask(ctx, await readBody(req, taskInputSchema)));

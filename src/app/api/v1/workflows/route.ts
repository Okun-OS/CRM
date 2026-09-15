import { route, readBody } from "@/lib/api/route";
import { createWorkflow, listWorkflows } from "@/server/services/workflows";
import { workflowInputSchema } from "@/server/workflows/types";

export const GET = route(async ({ ctx }) => listWorkflows(ctx));

export const POST = route(async ({ req, ctx }) => createWorkflow(ctx, await readBody(req, workflowInputSchema)));

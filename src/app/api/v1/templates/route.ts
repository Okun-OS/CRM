import { route, readBody } from "@/lib/api/route";
import { createTemplate, listTemplates, templateInputSchema } from "@/server/services/emails";

export const GET = route(async ({ ctx, url }) =>
  listTemplates(ctx, url.searchParams.get("includeInactive") === "1"),
);

export const POST = route(async ({ req, ctx }) => createTemplate(ctx, await readBody(req, templateInputSchema)));

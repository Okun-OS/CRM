import { route, readBody } from "@/lib/api/route";
import { emailComposeSchema, emailListQuerySchema, listEmails, saveDraft } from "@/server/services/emails";

export const GET = route(async ({ ctx, url }) =>
  listEmails(ctx, emailListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))),
);

export const POST = route(async ({ req, ctx }) => saveDraft(ctx, await readBody(req, emailComposeSchema)));

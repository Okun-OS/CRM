import { route, readBody } from "@/lib/api/route";
import { createTag, listTags, tagSchema } from "@/server/services/settings";

export const GET = route(async ({ ctx }) => listTags(ctx));

export const POST = route(async ({ req, ctx }) => createTag(ctx, await readBody(req, tagSchema)));

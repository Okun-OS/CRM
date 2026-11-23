import { route, readBody } from "@/lib/api/route";
import { z } from "zod";
import { lookupMetaPages } from "@/server/services/meta-settings";

/** Seiten, die das eingefügte Token erreicht. */
export const POST = route(
  async ({ req, ctx }) => lookupMetaPages(ctx, await readBody(req, z.object({ accessToken: z.string() }))),
  { permission: "settings.manage" },
);

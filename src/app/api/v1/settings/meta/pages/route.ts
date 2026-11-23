import { route, readBody } from "@/lib/api/route";
import { z } from "zod";
import { connectMetaPages } from "@/server/services/meta-settings";

/** Gewählte Seiten verbinden und für neue Leads abonnieren. */
export const POST = route(
  async ({ req, ctx }) =>
    connectMetaPages(ctx, await readBody(req, z.object({ accessToken: z.string(), pageIds: z.array(z.string()) }))),
  { permission: "settings.manage" },
);

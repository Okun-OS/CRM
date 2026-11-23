import { route, readBody } from "@/lib/api/route";
import { z } from "zod";
import { disconnectMetaPage, updateMetaPage } from "@/server/services/meta-settings";

const updateBody = z.object({
  ownerId: z.string().nullable().optional(),
  notifyEmails: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = route<{ id: string }>(
  async ({ req, ctx, params }) => updateMetaPage(ctx, params.id, await readBody(req, updateBody)),
  { permission: "settings.manage" },
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => disconnectMetaPage(ctx, params.id), {
  permission: "settings.manage",
});

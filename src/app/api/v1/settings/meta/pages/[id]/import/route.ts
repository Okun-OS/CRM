import { route, readBody } from "@/lib/api/route";
import { z } from "zod";
import { importExistingMetaLeads } from "@/server/services/meta-settings";

/** Bestehende Formular-Einsendungen der Seite übernehmen. */
export const POST = route<{ id: string }>(
  async ({ req, ctx, params }) =>
    importExistingMetaLeads(
      ctx,
      params.id,
      await readBody(
        req,
        z.object({
          since: z.string().nullable().optional(),
          formIds: z.array(z.string()).optional(),
          restoreDeleted: z.boolean().optional(),
        }),
      ),
    ),
  { permission: "settings.manage" },
);

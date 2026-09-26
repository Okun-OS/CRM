import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { stopEnrollment } from "@/server/services/acquisition/enrollment";

const schema = z.object({ note: z.string().trim().max(500).optional() });

/** Beendet eine laufende Einschreibung von Hand. */
export const DELETE = route<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readBody(req, schema).catch(() => ({ note: undefined }));
  await stopEnrollment(ctx, params.id, body.note);
});

import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { deleteNote, updateNote } from "@/server/services/notes";

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readBody(req, z.object({ body: z.string().min(1).max(20_000) }));
  await updateNote(ctx, params.id, body.body);
  return { ok: true };
});

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteNote(ctx, params.id);
  return { ok: true };
});

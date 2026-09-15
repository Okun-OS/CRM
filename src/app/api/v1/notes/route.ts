import { route, readBody } from "@/lib/api/route";
import { noteInputSchema } from "@/lib/schemas/crm";
import { createNote, listNotes, noteListQuerySchema } from "@/server/services/notes";

export const GET = route(async ({ ctx, url }) =>
  listNotes(ctx, noteListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))),
);

export const POST = route(async ({ req, ctx }) => createNote(ctx, await readBody(req, noteInputSchema)));

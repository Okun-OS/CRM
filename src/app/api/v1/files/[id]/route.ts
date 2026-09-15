import { route } from "@/lib/api/route";
import { deleteFile } from "@/server/services/files";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteFile(ctx, params.id);
  return { ok: true };
});

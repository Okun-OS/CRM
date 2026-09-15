import { NextResponse } from "next/server";
import { route } from "@/lib/api/route";
import { readFileContent } from "@/server/services/files";

/**
 * The only way to read a stored file. Ownership and permissions are checked on
 * every request; storage keys are never exposed to clients.
 */
export const GET = route<{ id: string }>(async ({ ctx, params }) => {
  const file = await readFileContent(ctx, params.id);
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `attachment; filename="${encodeURIComponent(file.filename)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

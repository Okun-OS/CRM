import { route } from "@/lib/api/route";
import { fileLinkSchema, listFiles, MAX_FILE_SIZE, uploadFile } from "@/server/services/files";
import { AppError, ValidationError } from "@/lib/api/errors";

export const GET = route(async ({ ctx, url }) =>
  listFiles(ctx, fileLinkSchema.parse(Object.fromEntries(url.searchParams.entries()))),
);

/** Multipart upload. The body is read into memory and capped at MAX_FILE_SIZE. */
export const POST = route(async ({ req, ctx }) => {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_SIZE + 1024) {
    throw new AppError("PAYLOAD_TOO_LARGE", "Die Datei ist zu groß.");
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw ValidationError("Es wurde keine Datei übermittelt.");

  const links = fileLinkSchema.parse({
    contactId: (form.get("contactId") as string) || undefined,
    companyId: (form.get("companyId") as string) || undefined,
    dealId: (form.get("dealId") as string) || undefined,
  });

  return uploadFile(ctx, {
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    data: Buffer.from(await file.arrayBuffer()),
    ...links,
  });
});

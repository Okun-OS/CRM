import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { AppError, ValidationError } from "@/lib/api/errors";
import { buildStorageKey, checksum, storage } from "@/server/storage/driver";
import { assertLinksInTenant, logSystemActivity } from "./activities";

/** Upload limits and allow-list. Executables are rejected outright. */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

const ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/zip",
];

export const fileLinkSchema = z.object({
  contactId: z.string().max(30).optional(),
  companyId: z.string().max(30).optional(),
  dealId: z.string().max(30).optional(),
});

export async function listFiles(ctx: ActorContext, links: z.infer<typeof fileLinkSchema>) {
  assertPermission(ctx, "files.read");
  const files = await prisma.fileObject.findMany({
    where: {
      ...scope(ctx),
      deletedAt: null,
      ...(links.contactId ? { contactId: links.contactId } : {}),
      ...(links.companyId ? { companyId: links.companyId } : {}),
      ...(links.dealId ? { dealId: links.dealId } : {}),
    },
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return files.map((file) => ({
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    uploadedBy: file.uploadedBy,
    createdAt: file.createdAt.toISOString(),
    downloadUrl: `/api/v1/files/${file.id}/content`,
  }));
}

export async function uploadFile(
  ctx: ActorContext,
  input: { filename: string; mimeType: string; data: Buffer } & z.infer<typeof fileLinkSchema>,
) {
  assertPermission(ctx, "files.write");

  if (input.data.byteLength === 0) throw ValidationError("Die Datei ist leer.");
  if (input.data.byteLength > MAX_FILE_SIZE) {
    throw new AppError("PAYLOAD_TOO_LARGE", `Die Datei überschreitet das Limit von ${MAX_FILE_SIZE / 1024 / 1024} MB.`);
  }
  if (!ALLOWED_MIME.includes(input.mimeType)) {
    throw ValidationError(`Dateien vom Typ "${input.mimeType}" sind nicht erlaubt.`);
  }

  const links = {
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    dealId: input.dealId ?? null,
  };
  if (!links.contactId && !links.companyId && !links.dealId) {
    throw ValidationError("Die Datei muss einem Datensatz zugeordnet sein.");
  }
  await assertLinksInTenant(ctx, links);

  const storageKey = buildStorageKey(ctx.organizationId, input.filename);
  await storage().put(storageKey, input.data, input.mimeType);

  const file = await prisma.fileObject.create({
    data: {
      organizationId: ctx.organizationId,
      filename: input.filename.slice(0, 200),
      mimeType: input.mimeType,
      size: input.data.byteLength,
      storageKey,
      storageProvider: "local",
      checksum: checksum(input.data),
      uploadedById: ctx.userId,
      ...links,
    },
  });

  await logSystemActivity(ctx, {
    subject: `Datei hochgeladen: ${file.filename}`,
    links,
    metadata: { fileId: file.id, size: file.size },
  });
  await writeAudit(ctx, {
    action: "file.uploaded",
    entityType: "FileObject",
    entityId: file.id,
    after: { filename: file.filename, size: file.size },
  });

  return {
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt.toISOString(),
    downloadUrl: `/api/v1/files/${file.id}/content`,
  };
}

/** Reads a file after verifying tenant ownership — never expose storage keys. */
export async function readFileContent(ctx: ActorContext, id: string) {
  assertPermission(ctx, "files.read");
  const file = assertFound(
    await prisma.fileObject.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Die Datei wurde nicht gefunden.",
  );
  const data = await storage().get(file.storageKey);
  return { data, filename: file.filename, mimeType: file.mimeType };
}

export async function deleteFile(ctx: ActorContext, id: string) {
  assertPermission(ctx, "files.delete");
  const file = assertFound(
    await prisma.fileObject.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Die Datei wurde nicht gefunden.",
  );

  await prisma.fileObject.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
  await storage().remove(file.storageKey);
  await writeAudit(ctx, {
    action: "file.deleted",
    entityType: "FileObject",
    entityId: id,
    before: { filename: file.filename },
  });
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "@/lib/env";

/**
 * File storage.
 *
 * Objects are addressed by an opaque storage key that contains the tenant id;
 * nothing is ever served from a public URL. Reads go through the authenticated
 * `/api/v1/files/:id/content` route, which checks organization membership and
 * permissions before touching the driver.
 */
export type StorageDriver = {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
};

function localRoot(): string {
  return resolve(process.cwd(), env().STORAGE_LOCAL_PATH);
}

/** Guards against path traversal via a crafted storage key. */
function resolveLocalPath(key: string): string {
  const root = localRoot();
  const target = resolve(root, key);
  if (!target.startsWith(`${root}/`)) throw new Error("Invalid storage key");
  return target;
}

const localDriver: StorageDriver = {
  async put(key, data) {
    const target = resolveLocalPath(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  },
  async get(key) {
    return readFile(resolveLocalPath(key));
  },
  async remove(key) {
    await unlink(resolveLocalPath(key)).catch(() => undefined);
  },
};

export function storage(): StorageDriver {
  switch (env().STORAGE_DRIVER) {
    case "local":
    default:
      return localDriver;
  }
}

/** Storage keys are tenant-prefixed and unguessable. */
export function buildStorageKey(organizationId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return join(organizationId, new Date().toISOString().slice(0, 7), `${randomUUID()}-${safeName}`);
}

export function checksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

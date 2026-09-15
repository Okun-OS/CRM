import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;
const PASSWORD_PREFIX = "scrypt";

/** Hashes a password with scrypt and a per-password random salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN);
  return `${PASSWORD_PREFIX}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Constant-time password verification. Returns false for malformed hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PASSWORD_PREFIX) return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const derived = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN);
  return timingSafeEqual(derived, expected);
}

/** Cryptographically random, URL-safe token (used for sessions and invites). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Deterministic hash for token lookup — raw tokens are never stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(env().ENCRYPTION_KEY).digest();
}

/** AES-256-GCM encryption for integration credentials at rest. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** HMAC-SHA256 signature used for outgoing webhook payloads. */
export function signPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

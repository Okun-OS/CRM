import { z } from "zod";

/**
 * Server-side environment. Validated once at startup so a misconfigured
 * deployment fails fast instead of failing at the first request.
 * Never import this from a client component.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /**
   * Not policed: NODE_ENV belongs to the runtime, not to this application, and
   * hosting platforms set values of their own. Anything that is not clearly a
   * development or test environment is treated as production — the safe
   * reading, and one that cannot take the deployment down over a label.
   */
  NODE_ENV: z
    .string()
    .optional()
    .transform((value) => (value === "development" || value === "test" ? value : "production"))
    .pipe(z.enum(["development", "test", "production"])),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  ENCRYPTION_KEY: z.string().min(16, "ENCRYPTION_KEY must be at least 16 characters"),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage"),
  TRUST_PROXY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
export const trustProxy = () => env().TRUST_PROXY === "1";

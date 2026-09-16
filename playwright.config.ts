import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/okun_crm_e2e";

/**
 * End-to-end tests drive the real application: real Next.js server, real API,
 * real PostgreSQL. The suite gets its own database so it never touches
 * development data.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec prisma migrate deploy && pnpm exec next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL,
      NODE_ENV: "production",
      APP_URL: `http://127.0.0.1:${PORT}`,
      SESSION_SECRET: "e2e-session-secret-00000000000000",
      ENCRYPTION_KEY: "e2e-encryption-key-0000000000000",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_PATH: "./storage-e2e",
    },
  },
});

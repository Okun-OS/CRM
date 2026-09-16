import { execSync } from "node:child_process";

/**
 * Applies the migrations to the test database once per run, so the schema under
 * test is exactly the schema that ships.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/okun_crm_test";
  process.env.DATABASE_URL = url;
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}

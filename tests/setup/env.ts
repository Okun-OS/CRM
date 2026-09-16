/**
 * Test environment. Every test runs against a real PostgreSQL database — the
 * guarantees under test (tenant isolation, constraints, transactions) cannot be
 * verified against a mock.
 */
Object.assign(process.env, { NODE_ENV: "test" });
process.env.SESSION_SECRET ??= "test-session-secret-0000000000000000";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-000000000000000";
process.env.APP_URL ??= "http://localhost:3000";
process.env.STORAGE_DRIVER ??= "local";
process.env.STORAGE_LOCAL_PATH ??= "./storage-test";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/okun_crm_test";

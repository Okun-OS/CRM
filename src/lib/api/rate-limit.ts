import { RateLimited } from "./errors";

/**
 * In-process sliding-window rate limiter.
 *
 * Deliberately simple: it protects a single instance against bursts and
 * credential stuffing. A multi-instance deployment should point
 * `consumeRateLimit` at a shared store (Redis) — see docs/ARCHITECTURE.md.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export type RateLimitRule = { key: string; limit: number; windowMs: number };

export function consumeRateLimit({ key, limit, windowMs }: RateLimitRule): void {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw RateLimited();
}

/** Test helper — clears all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

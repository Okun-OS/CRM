import { NextResponse } from "next/server";

/** Duck-typed Prisma Decimal check (decimal.js instances expose toFixed + d/e/s). */
function isDecimal(value: unknown): value is { toFixed: (dp?: number) => string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toFixed?: unknown }).toFixed === "function" &&
    "d" in value &&
    "e" in value &&
    "s" in value
  );
}

/**
 * Normalises values that JSON cannot represent faithfully: Decimals become
 * numbers with two fractional digits, Dates become ISO strings, BigInt becomes
 * a string.
 */
export function serialize<T>(value: T): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (isDecimal(value)) return Number(value.toFixed(2));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serialize(val);
    }
    return out;
  }
  return value;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(serialize({ data }) as object, init);
}

export function jsonCreated<T>(data: T): NextResponse {
  return jsonOk(data, { status: 201 });
}

export function jsonNoContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

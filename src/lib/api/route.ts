import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, Forbidden, Unauthenticated, ValidationError } from "./errors";
import { serialize } from "./json";
import { consumeRateLimit } from "./rate-limit";
import { CSRF_COOKIE, getActor } from "@/lib/auth/session";
import { assertPermission, type ActorContext } from "@/lib/context";
import type { Permission } from "@/lib/rbac";
import { logError } from "@/lib/logger";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_HEADER = "x-okun-csrf";

export type RouteContext<P = Record<string, string>> = {
  req: NextRequest;
  ctx: ActorContext;
  params: P;
  url: URL;
};

type Options = {
  /** Permission required to execute the route. */
  permission?: Permission;
  /** Set false for the public auth endpoints. */
  auth?: boolean;
  rateLimit?: { limit: number; windowMs: number; scope?: string };
};

/**
 * Wraps a route handler with authentication, CSRF protection, permission
 * checks, rate limiting and a single error-to-response mapping.
 *
 * Handlers return plain data (serialised to `{ data }`) or a NextResponse when
 * they need full control over the response.
 */
export function route<P = Record<string, string>>(
  handler: (rc: RouteContext<P>) => Promise<unknown>,
  options: Options = {},
) {
  const { auth = true, permission, rateLimit } = options;

  return async (req: NextRequest, segmentData: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const params = ((await segmentData?.params) ?? {}) as P;
      const url = new URL(req.url);

      let ctx: ActorContext | null = null;
      if (auth) {
        ctx = await getActor();
        if (!ctx) throw Unauthenticated();
        if (MUTATING_METHODS.has(req.method)) await assertCsrf(req);
        if (permission) assertPermission(ctx, permission);
      }

      if (rateLimit) {
        const identity = ctx?.userId ?? req.headers.get("x-real-ip") ?? "anonymous";
        consumeRateLimit({
          key: `${rateLimit.scope ?? url.pathname}:${identity}`,
          limit: rateLimit.limit,
          windowMs: rateLimit.windowMs,
        });
      }

      const result = await handler({ req, ctx: ctx as ActorContext, params, url });
      if (result instanceof NextResponse) return result;
      if (result === undefined) return new NextResponse(null, { status: 204 });
      return NextResponse.json(serialize({ data: result }) as object);
    } catch (error) {
      return toErrorResponse(error, req);
    }
  };
}

/** Double-submit CSRF check: header must match both cookie and stored token. */
async function assertCsrf(req: NextRequest): Promise<void> {
  const headerToken = req.headers.get(CSRF_HEADER);
  const cookieToken = (await cookies()).get(CSRF_COOKIE)?.value;
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    throw Forbidden("Ungültiges oder fehlendes CSRF-Token. Bitte Seite neu laden.");
  }
}

export function toErrorResponse(error: unknown, req?: NextRequest): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: serialize(error.details) } },
      { status: error.status },
    );
  }

  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join(".") || "_";
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Die Eingaben sind unvollständig oder ungültig.",
          details: { fields: fieldErrors },
        },
      },
      { status: 422 },
    );
  }

  // Unknown failure: log server-side, return an opaque message.
  logError("api.unhandled", error, { path: req?.nextUrl?.pathname, method: req?.method });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Es ist ein unerwarteter Fehler aufgetreten." } },
    { status: 500 },
  );
}

/** Parses and validates a JSON request body. */
export async function readBody<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw ValidationError("Der Anfragetext ist kein gültiges JSON.");
  }
  return schema.parse(raw);
}

import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, Forbidden, Unauthenticated, ValidationError } from "./errors";
import { serialize } from "./json";
import { consumeRateLimit } from "./rate-limit";
import { env, trustProxy } from "@/lib/env";
import { CSRF_COOKIE, getActor } from "@/lib/auth/session";
import { assertPermission, type ActorContext } from "@/lib/context";
import type { Permission } from "@/lib/rbac";
import { logError, logWarn } from "@/lib/logger";

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

      // Cross-origin writes are refused before anything else, including on the
      // public auth endpoints where there is no session to carry a CSRF token.
      if (MUTATING_METHODS.has(req.method)) assertSameOrigin(req);

      let ctx: ActorContext | null = null;
      if (auth) {
        ctx = await getActor();
        if (!ctx) throw Unauthenticated();
        if (MUTATING_METHODS.has(req.method)) await assertCsrf(req);
        if (permission) assertPermission(ctx, permission);
      }

      if (rateLimit) {
        // Authenticated requests are limited per user. Unauthenticated ones
        // share a per-instance bucket, which is only a burst guard — endpoints
        // that need per-account limits (login, registration) apply their own
        // key on the submitted identity, so one caller cannot lock out everyone.
        const forwarded = trustProxy() ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
        const identity = ctx?.userId ?? forwarded ?? "anonymous";
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

/**
 * Origin check for mutations. A browser always sends `Origin` on cross-origin
 * requests, so a mismatch means the call did not come from this application.
 * Requests without an Origin header (server-to-server API clients) are allowed
 * through — those carry no ambient cookies to abuse.
 */
/**
 * Origin-Prüfung für schreibende Anfragen.
 *
 * Maßgeblich ist, ob die Herkunft der Anfrage zu der Adresse passt, unter der
 * diese Anwendung gerade läuft. Der `Host`-Header ist dafür die verlässlichste
 * Quelle: Ein Browser setzt ihn auf das Ziel, eine fremde Seite kann ihn nicht
 * fälschen — bei einem Angriff von außen steht dort also unsere Adresse und in
 * `Origin` die fremde, und genau das fällt auf.
 *
 * `APP_URL` gilt zusätzlich, ist aber bewusst nicht die einzige Quelle: Eine
 * vergessene oder veraltete APP_URL soll nicht jede schreibende Anfrage der
 * gesamten Anwendung blockieren. Hinter einem Reverse Proxy zählt außerdem
 * `X-Forwarded-Host` — aber nur, wenn dem Proxy ausdrücklich vertraut wird.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return;

  let actual: string;
  try {
    actual = new URL(origin).host;
  } catch {
    throw Forbidden("Ungültiger Origin-Header.");
  }

  const allowed = new Set<string>([req.nextUrl.host]);

  const host = req.headers.get("host");
  if (host) allowed.add(host);

  try {
    allowed.add(new URL(env().APP_URL).host);
  } catch {
    // Unbrauchbare APP_URL: Die übrigen Quellen entscheiden weiterhin.
  }

  if (trustProxy()) {
    const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (forwarded) allowed.add(forwarded);
  }

  if (!allowed.has(actual)) {
    // Ohne diese Zeile ist eine Fehlkonfiguration von außen nicht zu erkennen.
    logWarn("security.origin_rejected", { origin: actual, allowed: Array.from(allowed) });
    throw Forbidden(
      "Anfragen von einer fremden Herkunft werden abgelehnt. Prüfen Sie, ob APP_URL zur aufgerufenen Adresse passt.",
    );
  }
}

/** Double-submit CSRF check: header must match both cookie and stored token. */
export async function assertCsrf(req: NextRequest): Promise<void> {
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

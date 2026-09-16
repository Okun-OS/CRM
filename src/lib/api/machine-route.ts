import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError, ValidationError } from "./errors";
import { serialize } from "./json";
import { consumeRateLimit } from "./rate-limit";
import { logError } from "@/lib/logger";
import {
  assertScope,
  authenticateApiKey,
  contextForApiKey,
  type ApiKeyPrincipal,
  type ApiKeyScope,
} from "@/server/services/api-keys";
import type { ActorContext } from "@/lib/context";

/**
 * Wrapper for machine-to-machine endpoints.
 *
 * These carry no session and no CSRF token — they authenticate with an API key
 * that decides both the tenant and the allowed scope. Everything else (error
 * mapping, rate limiting, serialisation) matches the interactive API.
 */
export type MachineContext = {
  req: NextRequest;
  principal: ApiKeyPrincipal;
  ctx: ActorContext;
  url: URL;
};

export function machineRoute(
  handler: (mc: MachineContext) => Promise<unknown>,
  options: { scope: ApiKeyScope; rateLimit?: { limit: number; windowMs: number } },
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      const principal = await authenticateApiKey(req.headers.get("authorization"));
      assertScope(principal, options.scope);

      const limit = options.rateLimit ?? { limit: 600, windowMs: 60_000 };
      consumeRateLimit({ key: `machine:${principal.keyId}`, limit: limit.limit, windowMs: limit.windowMs });

      const ctx = await contextForApiKey(principal);
      const result = await handler({ req, principal, ctx, url: new URL(req.url) });
      return NextResponse.json(serialize({ data: result }) as object);
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
      }
      logError("machine_route.failed", error, { path: new URL(req.url).pathname });
      return NextResponse.json(
        { error: { code: "internal_error", message: "Unerwarteter Fehler." } },
        { status: 500 },
      );
    }
  };
}

export async function readMachineBody<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw ValidationError("Der Request-Body ist kein gültiges JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw ValidationError("Die übermittelten Daten sind ungültig.", parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

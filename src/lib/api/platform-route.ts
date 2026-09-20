import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AppError, Forbidden, Unauthenticated } from "./errors";
import { serialize } from "./json";
import { consumeRateLimit } from "./rate-limit";
import { assertCsrf, assertSameOrigin } from "./route";
import { getPlatformActor } from "@/lib/auth/session";
import type { PlatformActor } from "@/lib/platform";
import { logError } from "@/lib/logger";

/**
 * Route-Hülle der Betreiber-Ebene.
 *
 * Gleiche Absicherung wie im Mandantenbereich — Origin-Prüfung, CSRF-Token,
 * einheitliche Fehlerhülle —, nur mit einem anderen Aktor: Hier entscheidet
 * `isPlatformAdmin`, nicht eine Mitgliedschaft. Ein Mandantenrecht öffnet
 * diesen Bereich nie, und dieser Bereich vergibt nie Mandantenrechte.
 */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type PlatformRouteContext<P = Record<string, string>> = {
  req: NextRequest;
  actor: PlatformActor;
  params: P;
  url: URL;
};

export function platformRoute<P = Record<string, string>>(
  handler: (rc: PlatformRouteContext<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, segmentData: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const params = ((await segmentData?.params) ?? {}) as P;
      const url = new URL(req.url);

      if (MUTATING_METHODS.has(req.method)) assertSameOrigin(req);

      const actor = await getPlatformActor();
      if (!actor) {
        // Bewusst nicht zwischen „nicht angemeldet" und „kein Betreiber"
        // unterschieden: Die Existenz dieses Bereichs muss niemand bestätigt
        // bekommen, der nichts damit zu tun hat.
        throw Unauthenticated("Für diesen Bereich ist eine Betreiberanmeldung erforderlich.");
      }
      if (MUTATING_METHODS.has(req.method)) await assertCsrf(req);

      consumeRateLimit({ key: `platform:${actor.userId}:${url.pathname}`, limit: 120, windowMs: 60_000 });

      const result = await handler({ req, actor, params, url });
      if (result instanceof NextResponse) return result;
      if (result === undefined) return new NextResponse(null, { status: 204 });
      return NextResponse.json(serialize({ data: result }) as object);
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message, details: error.details } },
          { status: error.status },
        );
      }
      logError("platform_route.failed", error, { path: new URL(req.url).pathname });
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Es ist ein unerwarteter Fehler aufgetreten." } },
        { status: 500 },
      );
    }
  };
}

export { Forbidden };

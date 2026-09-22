import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Forbidden, Unauthenticated } from "./errors";
import { serialize } from "./json";
import { consumeRateLimit } from "./rate-limit";
import { assertCsrf, assertSameOrigin, toErrorResponse } from "./route";
import { getPlatformActor } from "@/lib/auth/session";
import type { PlatformActor } from "@/lib/platform";

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
      // Dieselbe Fehlerabbildung wie im Mandanten-API: Eine eigene Kopie hier
      // hatte den Validierungsfall nicht abgedeckt, sodass eine unvollständige
      // Eingabe als Serverfehler zurückkam statt als 422 mit Feldhinweisen.
      return toErrorResponse(error, req);
    }
  };
}

export { Forbidden };

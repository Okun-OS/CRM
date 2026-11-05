import { route } from "@/lib/api/route";
import { destroySession } from "@/lib/auth/session";

/**
 * Abmelden geht für jede Sitzung — auch für ein Betreiberkonto ohne
 * Mitgliedschaft in einer Organisation, das keinen CRM-Kontext hat. Fremde
 * Seiten können das nicht auslösen: Schreibende Anfragen mit fremdem Origin
 * lehnt `route` vorab ab.
 */
export const POST = route(
  async () => {
    await destroySession();
    return { ok: true };
  },
  { auth: false },
);

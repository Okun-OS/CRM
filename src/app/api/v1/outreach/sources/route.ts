import { route } from "@/lib/api/route";
import { availableProspectingProviders } from "@/server/acquisition/providers/registry";

/**
 * Welche Quellen wirklich nutzbar sind.
 *
 * Bewusst nur die verfügbaren: Eine Quelle, die nichts liefert, gehört nicht
 * in eine Auswahlliste — sonst sähe die Oberfläche nach mehr aus, als da ist.
 */
export const GET = route(async ({ ctx }) => availableProspectingProviders(ctx), {
  permission: "prospects.read",
});

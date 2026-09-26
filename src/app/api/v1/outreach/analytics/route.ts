import { route } from "@/lib/api/route";
import { acquisitionFunnel, attributionBySource, needsAttention } from "@/server/services/acquisition/analytics";

/** Trichter, offene Punkte und Herkunft in einem Aufruf — die Übersichtsseite braucht alle drei. */
export const GET = route(async ({ ctx, url }) => {
  const days = Number(url.searchParams.get("days") ?? 90);
  const [funnel, attention, attribution] = await Promise.all([
    acquisitionFunnel(ctx, Number.isFinite(days) ? Math.min(Math.max(days, 7), 730) : 90),
    needsAttention(ctx),
    attributionBySource(ctx),
  ]);
  return { funnel, attention, attribution };
});

/**
 * Läuft einmal beim Start des Servers (Next.js instrumentation hook).
 *
 * Startet den Zustell-Worker für Webhooks — nur im Node-Serverprozess, nicht
 * während `next build` und nicht in Tests. Abschalten mit `WEBHOOK_WORKER=off`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV === "test" || process.env.WEBHOOK_WORKER === "off") return;

  const { startWebhookWorker } = await import("./server/services/webhook-worker");
  startWebhookWorker();
}

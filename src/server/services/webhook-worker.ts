import "server-only";
import { prisma } from "@/lib/db";
import { logError, logInfo } from "@/lib/logger";
import { processDueWebhookDeliveries } from "./webhooks";
import { purgeExpiredIdempotencyRecords } from "@/server/mailwin/idempotency";
import { announceDueNextActions } from "@/server/mailwin/webhooks";

/**
 * Hintergrundarbeit im Serverprozess.
 *
 * Webhook-Zustellungen (vor allem an Mailwin) sollen nicht davon abhängen, ob
 * jemand einen externen Cron eingerichtet hat: Fällige Zustellungen werden
 * alle 15 Sekunden versucht, fällig gewordene nächste Aktionen jede Minute an
 * Mailwin gemeldet (`lead.next_action_due`), abgelaufene Idempotenz-Einträge
 * und alte Aufrufprotokolle einmal pro Stunde entfernt.
 *
 * Mehrere Instanzen stören sich nicht: Jede Zustellung wird vor dem Senden
 * reserviert (`claim` in webhooks.ts) und nur einmal verschickt.
 * Abschalten mit `WEBHOOK_WORKER=off`.
 */
const DELIVERY_INTERVAL_MS = 15_000;
const DUE_INTERVAL_MS = 60_000;
const MAINTENANCE_INTERVAL_MS = 60 * 60_000;
/** Aufrufprotokolle der Integrationen werden 30 Tage aufbewahrt. */
export const REQUEST_LOG_RETENTION_MS = 30 * 24 * 60 * 60_000;

const state = globalThis as unknown as { okunWebhookWorker?: boolean };

export function startWebhookWorker(): void {
  if (state.okunWebhookWorker) return;
  state.okunWebhookWorker = true;

  let delivering = false;
  const deliver = async () => {
    if (delivering) return;
    delivering = true;
    try {
      await processDueWebhookDeliveries(100);
    } catch (error) {
      logError("webhook_worker.delivery_failed", error);
    } finally {
      delivering = false;
    }
  };

  let announcing = false;
  const announce = async () => {
    if (announcing) return;
    announcing = true;
    try {
      await announceDueNextActions();
    } catch (error) {
      logError("webhook_worker.due_failed", error);
    } finally {
      announcing = false;
    }
  };

  setInterval(() => void deliver(), DELIVERY_INTERVAL_MS).unref();
  setInterval(() => void announce(), DUE_INTERVAL_MS).unref();
  setInterval(() => void runMaintenance().catch((error) => logError("webhook_worker.maintenance_failed", error)), MAINTENANCE_INTERVAL_MS).unref();
  logInfo("webhook_worker.started", { intervalMs: DELIVERY_INTERVAL_MS });
}

export async function runMaintenance(now = new Date()): Promise<{ idempotency: number; requestLogs: number }> {
  const idempotency = await purgeExpiredIdempotencyRecords(now);
  const requestLogs = (
    await prisma.integrationRequestLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - REQUEST_LOG_RETENTION_MS) } },
    })
  ).count;
  return { idempotency, requestLogs };
}

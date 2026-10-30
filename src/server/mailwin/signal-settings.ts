import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/api/errors";
import { MAILWIN_STAGE_SIGNALS, type MailwinStageSignal } from "@/lib/crm/mailwin";

/**
 * Wie ein Arbeitsbereich auf Mailwin-Signale reagiert.
 *
 * - Welche Phase ein Signal auslöst, legt der Kunde je Pipeline fest. Ohne
 *   eigene Zuordnung gelten die Phasen der Standard-Pipeline (Schlüssel
 *   `proposal`, `meeting`, `negotiation`); fehlt eine solche Phase, bleibt die
 *   Phase unverändert.
 * - Gewonnen/Verloren ist standardmäßig ein **Vorschlag**. Auf „automatisch“
 *   gestellt, gilt das nur ab der eingestellten Verlässlichkeit — darunter
 *   bleibt es ein Vorschlag.
 * - Ein Angebotswert füllt standardmäßig nur einen leeren Deal-Wert.
 */
export const DEFAULT_STAGE_KEYS: Record<MailwinStageSignal, string> = {
  offer_sent: "proposal",
  meeting_booked: "meeting",
  contract_sent: "negotiation",
};

export const signalConfigSchema = z.object({
  /** Je Pipeline: Signal → Phase (null = Phase nicht ändern). Fehlende Einträge = Standard. */
  stageMapping: z
    .record(z.string().max(30), z.partialRecord(z.enum(MAILWIN_STAGE_SIGNALS), z.string().max(30).nullable()))
    .default({}),
  acceptance: z.enum(["suggest", "auto"]).default("suggest"),
  decline: z.enum(["suggest", "auto"]).default("suggest"),
  /** 0–1. Nur bei „auto“ relevant: darunter bleibt es ein Vorschlag. */
  autoMinConfidence: z.number().min(0).max(1).default(0.9),
  /**
   * Betrag aus `offer_sent`, wenn der Deal schon einen anderen Wert hat:
   * „suggest“ = Vorschlag zur Bestätigung, „fill“ = nur leere Werte füllen.
   * Überschrieben wird nie still; das frühere „overwrite“ gilt als „suggest“.
   */
  offerValue: z.preprocess(
    (value) => (value === "overwrite" ? "suggest" : value),
    z.enum(["suggest", "fill"]).default("suggest"),
  ),
});

export type SignalConfig = z.infer<typeof signalConfigSchema>;

const INTEGRATION = "mailwin";

export async function loadSignalConfig(organizationId: string): Promise<SignalConfig> {
  const row = await prisma.integrationSetting.findUnique({
    where: { organizationId_integration: { organizationId, integration: INTEGRATION } },
  });
  const parsed = signalConfigSchema.safeParse(row?.config ?? {});
  return parsed.success ? parsed.data : signalConfigSchema.parse({});
}

type StageRow = { id: string; key: string; name: string; type: string; position: number };

/** Zielphase für ein Signal in einer Pipeline — oder null, wenn die Phase bleibt. */
export function targetStageFor(
  config: SignalConfig,
  pipelineId: string,
  stages: StageRow[],
  signal: MailwinStageSignal,
): StageRow | null {
  const mapping = config.stageMapping[pipelineId];
  if (mapping && signal in mapping) {
    const id = mapping[signal];
    return id ? (stages.find((stage) => stage.id === id && stage.type === "OPEN") ?? null) : null;
  }
  return stages.find((stage) => stage.key === DEFAULT_STAGE_KEYS[signal] && stage.type === "OPEN") ?? null;
}

/** Für die Einstellungsseite: jede Pipeline mit der tatsächlich geltenden Zuordnung. */
export async function getSignalSettings(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  const config = await loadSignalConfig(ctx.organizationId);
  const pipelines = await prisma.pipeline.findMany({
    where: { ...scope(ctx), isArchived: false },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    include: { stages: { orderBy: { position: "asc" } } },
  });
  return {
    acceptance: config.acceptance,
    decline: config.decline,
    autoMinConfidence: config.autoMinConfidence,
    offerValue: config.offerValue,
    pipelines: pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: pipeline.stages.filter((stage) => stage.type === "OPEN").map((stage) => ({ id: stage.id, name: stage.name })),
      mapping: Object.fromEntries(
        MAILWIN_STAGE_SIGNALS.map((signal) => [signal, targetStageFor(config, pipeline.id, pipeline.stages, signal)?.id ?? null]),
      ) as Record<MailwinStageSignal, string | null>,
    })),
  };
}

export async function saveSignalSettings(ctx: ActorContext, input: z.input<typeof signalConfigSchema>) {
  assertPermission(ctx, "settings.manage");
  const config = signalConfigSchema.parse(input);

  // Jede genannte Phase muss eine offene Phase genau dieser Pipeline sein.
  for (const [pipelineId, mapping] of Object.entries(config.stageMapping)) {
    const stageIds = Object.values(mapping).filter((value): value is string => Boolean(value));
    if (stageIds.length === 0) continue;
    const count = await prisma.pipelineStage.count({
      where: { id: { in: stageIds }, pipelineId, ...scope(ctx), type: "OPEN" },
    });
    if (count !== new Set(stageIds).size) {
      throw ValidationError("Eine gewählte Phase gehört nicht zu dieser Pipeline oder ist keine offene Phase.");
    }
  }

  await prisma.integrationSetting.upsert({
    where: { organizationId_integration: { organizationId: ctx.organizationId, integration: INTEGRATION } },
    create: { organizationId: ctx.organizationId, integration: INTEGRATION, config },
    update: { config },
  });
  await writeAudit(ctx, { action: "mailwin.signal_settings_updated", entityType: "IntegrationSetting", after: config });
  return getSignalSettings(ctx);
}

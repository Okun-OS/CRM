"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-client";

type Stage = { id: string; name: string; type: string; probability: number; position: number };

/**
 * Stage rail on the deal page. Clicking a stage persists the change server-side,
 * which also writes the stage history entry and fires the workflow triggers.
 */
export function DealStagePicker({
  dealId,
  stages,
  currentStageId,
  canEdit,
}: {
  dealId: string;
  stages: Stage[];
  currentStageId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = React.useState<string | null>(null);
  const [lostStage, setLostStage] = React.useState<Stage | null>(null);
  const [lostReason, setLostReason] = React.useState("");

  const currentIndex = stages.findIndex((stage) => stage.id === currentStageId);

  async function move(stage: Stage, reason?: string) {
    if (!canEdit || stage.id === currentStageId) return;
    setPending(stage.id);
    try {
      await api.post(`/api/v1/deals/${dealId}/stage`, { stageId: stage.id, lostReason: reason });
      toast.success(`Stage geändert: ${stage.name}`);
      setLostStage(null);
      setLostReason("");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Stage konnte nicht geändert werden.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <ol className="flex flex-wrap gap-1.5" aria-label="Pipeline-Stages">
        {stages.map((stage, index) => {
          const isCurrent = stage.id === currentStageId;
          const isPast = index < currentIndex && stage.type === "OPEN";
          const isLoading = pending === stage.id;

          return (
            <li key={stage.id}>
              <button
                type="button"
                disabled={!canEdit || isLoading}
                onClick={() => (stage.type === "LOST" ? setLostStage(stage) : move(stage))}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  isCurrent
                    ? stage.type === "WON"
                      ? "border-success-500 bg-success-50 text-success-700"
                      : stage.type === "LOST"
                        ? "border-danger-500 bg-danger-50 text-danger-700"
                        : "border-brand-500 bg-brand-500 text-white"
                    : isPast
                      ? "border-brand-200 bg-brand-50 text-brand-700"
                      : "border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-600",
                  (!canEdit || isLoading) && "cursor-not-allowed opacity-70",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isPast || (isCurrent && stage.type === "WON") ? <Check className="h-3 w-3" /> : null}
                {stage.name}
                {stage.type === "OPEN" ? <span className="text-2xs opacity-60">{stage.probability}%</span> : null}
              </button>
            </li>
          );
        })}
      </ol>

      <Modal
        open={lostStage !== null}
        onClose={() => setLostStage(null)}
        title="Deal als verloren markieren"
        description="Ein Verlustgrund hilft später bei der Auswertung."
        size="sm"
        footer={
          <>
            <Button onClick={() => setLostStage(null)}>Abbrechen</Button>
            <Button
              variant="danger"
              loading={pending !== null}
              onClick={() => lostStage && move(lostStage, lostReason || undefined)}
            >
              Als verloren markieren
            </Button>
          </>
        }
      >
        <Field label="Verlustgrund" htmlFor="lostReason">
          <Textarea
            id="lostReason"
            rows={3}
            value={lostReason}
            onChange={(event) => setLostReason(event.target.value)}
            placeholder="z. B. Budget nicht freigegeben, Wettbewerber gewonnen…"
          />
        </Field>
      </Modal>
    </>
  );
}

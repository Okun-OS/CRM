"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Building2, CalendarClock, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Drawer } from "@/components/ui/modal";
import { Avatar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { DealForm } from "@/components/crm/forms/deal-form";
import { api, ApiError } from "@/lib/api-client";
import { formatCurrency, formatRelative } from "@/lib/format";
import {
  MOMENTUM_LABELS,
  MOMENTUM_TONE,
  OPERATIONAL_STATE_LABELS,
  OPERATIONAL_STATE_TONE,
} from "@/lib/crm/active";
import type { Momentum, OperationalState } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";

/**
 * Kanban board. Dropping a card calls the stage endpoint, which records the
 * stage history and fires the workflow triggers; the optimistic move is rolled
 * back if the server refuses.
 */
type Deal = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  lastActivityAt: string | null;
  nextActivityAt?: string | null;
  operationalState: OperationalState;
  nextActionTitle: string | null;
  nextActionAt: string | null;
  momentum: Momentum;
};

type Stage = {
  id: string;
  name: string;
  type: string;
  probability: number;
  position: number;
  totalAmount: number;
  deals: Deal[];
};

type Board = { pipeline: { id: string; name: string }; stages: Stage[] };

export function PipelineBoard({
  board,
  pipelines,
  currency,
  canEdit,
  canCreate,
}: {
  board: Board;
  pipelines: { id: string; name: string }[];
  currency: string;
  canEdit: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [stages, setStages] = React.useState<Stage[]>(board.stages);
  const [dragging, setDragging] = React.useState<Deal | null>(null);
  const [createInStage, setCreateInStage] = React.useState<string | null>(null);

  React.useEffect(() => setStages(board.stages), [board.stages]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragStart(event: DragStartEvent) {
    const dealId = String(event.active.id);
    const deal = stages.flatMap((stage) => stage.deals).find((item) => item.id === dealId);
    setDragging(deal ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const dealId = String(event.active.id);
    const targetStageId = event.over ? String(event.over.id) : null;
    if (!targetStageId) return;

    const sourceStage = stages.find((stage) => stage.deals.some((deal) => deal.id === dealId));
    if (!sourceStage || sourceStage.id === targetStageId) return;
    const deal = sourceStage.deals.find((item) => item.id === dealId);
    if (!deal) return;

    const previous = stages;
    setStages((current) =>
      current.map((stage) => {
        if (stage.id === sourceStage.id) {
          return {
            ...stage,
            deals: stage.deals.filter((item) => item.id !== dealId),
            totalAmount: stage.totalAmount - deal.amount,
          };
        }
        if (stage.id === targetStageId) {
          return { ...stage, deals: [deal, ...stage.deals], totalAmount: stage.totalAmount + deal.amount };
        }
        return stage;
      }),
    );

    try {
      await api.post(`/api/v1/deals/${dealId}/stage`, { stageId: targetStageId });
      const target = stages.find((stage) => stage.id === targetStageId);
      toast.success(`„${deal.name}" ist jetzt in ${target?.name ?? "einer neuen Stage"}.`);
      router.refresh();
    } catch (cause) {
      setStages(previous);
      toast.error(cause instanceof ApiError ? cause.message : "Die Stage konnte nicht geändert werden.");
    }
  }

  const totalValue = stages.filter((stage) => stage.type === "OPEN").reduce((sum, stage) => sum + stage.totalAmount, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {pipelines.length > 1 ? (
            <Select
              value={board.pipeline.id}
              onChange={(event) => router.push(`/pipeline?pipelineId=${event.target.value}`)}
              className="h-9 w-56"
              aria-label="Pipeline auswählen"
            >
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm font-medium text-ink-800">{board.pipeline.name}</p>
          )}
        </div>
        <p className="text-xs text-ink-500">
          Offener Pipeline-Wert:{" "}
          <span className="font-semibold text-ink-900 tabular-nums">{formatCurrency(totalValue, currency)}</span>
        </p>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              currency={currency}
              canEdit={canEdit}
              canCreate={canCreate}
              onCreate={() => setCreateInStage(stage.id)}
            />
          ))}
        </div>

        <DragOverlay>
          {dragging ? (
            <div className="w-72 rotate-1">
              <DealCard deal={dragging} currency={currency} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Drawer
        open={createInStage !== null}
        onClose={() => setCreateInStage(null)}
        title="Deal erstellen"
        width="lg"
      >
        <DealForm
          initial={{ pipelineId: board.pipeline.id, stageId: createInStage ?? undefined, amount: 0 }}
          onDone={() => {
            setCreateInStage(null);
            router.refresh();
          }}
          onCancel={() => setCreateInStage(null)}
        />
      </Drawer>
    </div>
  );
}

function StageColumn({
  stage,
  currency,
  canEdit,
  canCreate,
  onCreate,
}: {
  stage: Stage;
  currency: string;
  canEdit: boolean;
  canCreate: boolean;
  onCreate: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: !canEdit });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg border bg-ink-50/60 transition-colors",
        isOver ? "border-brand-400 bg-brand-50/60" : "border-ink-200",
      )}
      aria-label={stage.name}
    >
      <header className="flex items-center justify-between gap-2 border-b border-ink-200/70 px-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-ink-800">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                stage.type === "WON" ? "bg-success-500" : stage.type === "LOST" ? "bg-danger-500" : "bg-brand-500",
              )}
            />
            {stage.name}
            <span className="text-ink-400">{stage.deals.length}</span>
          </p>
          <p className="mt-0.5 text-2xs tabular-nums text-ink-500">{formatCurrency(stage.totalAmount, currency)}</p>
        </div>
        {canCreate && stage.type === "OPEN" ? (
          <Button variant="ghost" size="icon" onClick={onCreate} aria-label={`Deal in ${stage.name} erstellen`}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100dvh - 20rem)" }}>
        {stage.deals.length === 0 ? (
          <p className="rounded-md border border-dashed border-ink-200 px-3 py-6 text-center text-2xs text-ink-400">
            Keine Deals in dieser Stage
          </p>
        ) : (
          stage.deals.map((deal) => (
            <DraggableDeal key={deal.id} deal={deal} currency={currency} canEdit={canEdit} />
          ))
        )}
      </div>
    </section>
  );
}

function DraggableDeal({ deal, currency, canEdit }: { deal: Deal; currency: string; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id, disabled: !canEdit });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn(isDragging && "opacity-40")}>
      <DealCard deal={deal} currency={currency} />
    </div>
  );
}

function DealCard({ deal, currency, dragging }: { deal: Deal; currency: string; dragging?: boolean }) {
  return (
    <article
      className={cn(
        "rounded-md border border-ink-200 bg-white p-2.5 shadow-card transition-shadow",
        dragging ? "shadow-overlay" : "hover:shadow-raised",
      )}
    >
      <Link href={`/deals/${deal.id}`} className="block" onClick={(event) => event.stopPropagation()}>
        <p className="truncate text-xs font-medium text-ink-900">{deal.name}</p>
      </Link>
      <p className="mt-1 text-sm font-semibold tabular-nums text-ink-900">{formatCurrency(deal.amount, deal.currency || currency)}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge tone={OPERATIONAL_STATE_TONE[deal.operationalState]}>
          {OPERATIONAL_STATE_LABELS[deal.operationalState]}
        </Badge>
        {deal.momentum === "STALLED" || deal.momentum === "HIGH" ? (
          <Badge tone={MOMENTUM_TONE[deal.momentum]}>{MOMENTUM_LABELS[deal.momentum]}</Badge>
        ) : null}
      </div>

      {deal.nextActionTitle ? (
        <p className="mt-1.5 truncate text-2xs text-ink-600" title={deal.nextActionTitle}>
          → {deal.nextActionTitle}
          {deal.nextActionAt ? ` · ${formatRelative(deal.nextActionAt)}` : ""}
        </p>
      ) : null}

      {deal.company ? (
        <p className="mt-1 flex items-center gap-1 truncate text-2xs text-ink-500">
          <Building2 className="h-3 w-3 shrink-0" />
          {deal.company.name}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        {deal.owner ? <Avatar name={deal.owner.name} size="xs" /> : <span />}
        <span className="flex items-center gap-1 text-2xs text-ink-400">
          {deal.nextActivityAt ? (
            <>
              <CalendarClock className="h-3 w-3" />
              {formatRelative(deal.nextActivityAt)}
            </>
          ) : deal.lastActivityAt ? (
            formatRelative(deal.lastActivityAt)
          ) : (
            "Keine Aktivität"
          )}
        </span>
      </div>
    </article>
  );
}

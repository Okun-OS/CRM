"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { Drawer, ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/crm/forms/form-kit";
import { api, ApiError } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";

type Stage = { id?: string; key: string; name: string; probability: number; type: string; dealCount?: number };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: (Stage & { dealCount: number })[] };

export function PipelinesView({ pipelines }: { pipelines: Pipeline[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = React.useState<Pipeline | "new" | null>(null);
  const [archiving, setArchiving] = React.useState<Pipeline | null>(null);

  async function archive() {
    if (!archiving) return;
    try {
      await api.delete(`/api/v1/pipelines/${archiving.id}`);
      toast.success("Pipeline archiviert.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Pipeline konnte nicht archiviert werden.");
    } finally {
      setArchiving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
          Pipeline erstellen
        </Button>
      </div>

      {pipelines.map((pipeline) => (
        <Card key={pipeline.id} className="overflow-hidden">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {pipeline.name}
                {pipeline.isDefault ? <Badge tone="brand">Standard</Badge> : null}
              </span>
            }
            description={`${pipeline.stages.length} Stages`}
            action={
              <div className="flex items-center gap-1">
                <Button size="sm" variant="secondary" onClick={() => setEditing(pipeline)}>
                  Bearbeiten
                </Button>
                {!pipeline.isDefault ? (
                  <Button variant="ghost" size="icon" onClick={() => setArchiving(pipeline)} aria-label="Archivieren">
                    <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                  </Button>
                ) : null}
              </div>
            }
          />
          <ul className="divide-y divide-ink-100">
            {pipeline.stages.map((stage) => (
              <li key={stage.id} className="flex items-center gap-3 px-5 py-2.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    stage.type === "WON" ? "bg-success-500" : stage.type === "LOST" ? "bg-danger-500" : "bg-brand-500"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-800">{stage.name}</span>
                <span className="text-2xs text-ink-500">{stage.probability} %</span>
                <span className="w-20 text-right text-2xs text-ink-500">{formatNumber(stage.dealCount)} Deals</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Pipeline erstellen" : "Pipeline bearbeiten"}
        width="lg"
      >
        {editing ? (
          <PipelineForm
            pipeline={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={archive}
        title="Pipeline archivieren?"
        description="Archivierte Pipelines erscheinen nicht mehr zur Auswahl. Das ist nur möglich, wenn keine Deals mehr enthalten sind."
        confirmLabel="Archivieren"
      />
    </div>
  );
}

const DEFAULT_STAGES: Stage[] = [
  { key: "lead", name: "Lead", probability: 10, type: "OPEN" },
  { key: "qualified", name: "Qualifiziert", probability: 30, type: "OPEN" },
  { key: "proposal", name: "Angebot", probability: 60, type: "OPEN" },
  { key: "won", name: "Gewonnen", probability: 100, type: "WON" },
  { key: "lost", name: "Verloren", probability: 0, type: "LOST" },
];

function PipelineForm({
  pipeline,
  onDone,
  onCancel,
}: {
  pipeline: Pipeline | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(pipeline?.name ?? "");
  const [isDefault, setIsDefault] = React.useState(pipeline?.isDefault ?? false);
  const [stages, setStages] = React.useState<Stage[]>(
    pipeline?.stages.map((stage) => ({
      id: stage.id,
      key: stage.key,
      name: stage.name,
      probability: stage.probability,
      type: stage.type,
      dealCount: stage.dealCount,
    })) ?? DEFAULT_STAGES,
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const payload = {
        name,
        isDefault,
        stages: stages.map((stage) => ({
          id: stage.id,
          key: stage.key,
          name: stage.name,
          probability: stage.probability,
          type: stage.type,
        })),
      };
      if (pipeline) await api.put(`/api/v1/pipelines/${pipeline.id}`, payload);
      else await api.post("/api/v1/pipelines", payload);
      toast.success(pipeline ? "Pipeline gespeichert." : "Pipeline erstellt.");
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Pipeline konnte nicht gespeichert werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={error} />

      <Field label="Name" htmlFor="pipeline-name" required>
        <Input id="pipeline-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
      </Field>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
          className="h-4 w-4 rounded border-ink-300 text-brand-500"
        />
        Als Standard-Pipeline verwenden
      </label>

      <div className="space-y-2">
        <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">
          Stages · jede Pipeline braucht eine Gewonnen- und eine Verloren-Stage
        </p>

        {stages.map((stage, index) => (
          <div key={stage.id ?? `new-${index}`} className="grid grid-cols-12 items-end gap-2 rounded-md border border-ink-200 p-2">
            <div className="col-span-12 sm:col-span-4">
              <Field label="Name" htmlFor={`stage-name-${index}`}>
                <Input
                  id={`stage-name-${index}`}
                  value={stage.name}
                  onChange={(event) =>
                    setStages((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, name: event.target.value, key: item.id ? item.key : slugifyKey(event.target.value) }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <div className="col-span-6 sm:col-span-3">
              <Field label="Schlüssel" htmlFor={`stage-key-${index}`}>
                <Input
                  id={`stage-key-${index}`}
                  value={stage.key}
                  onChange={(event) =>
                    setStages((current) => current.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)))
                  }
                  disabled={Boolean(stage.id)}
                />
              </Field>
            </div>
            <div className="col-span-3 sm:col-span-2">
              <Field label="%" htmlFor={`stage-probability-${index}`}>
                <Input
                  id={`stage-probability-${index}`}
                  type="number"
                  min={0}
                  max={100}
                  value={stage.probability}
                  onChange={(event) =>
                    setStages((current) =>
                      current.map((item, i) => (i === index ? { ...item, probability: Number(event.target.value) } : item)),
                    )
                  }
                />
              </Field>
            </div>
            <div className="col-span-3 sm:col-span-2">
              <Field label="Typ" htmlFor={`stage-type-${index}`}>
                <Select
                  id={`stage-type-${index}`}
                  value={stage.type}
                  onChange={(event) =>
                    setStages((current) => current.map((item, i) => (i === index ? { ...item, type: event.target.value } : item)))
                  }
                >
                  <option value="OPEN">Offen</option>
                  <option value="WON">Gewonnen</option>
                  <option value="LOST">Verloren</option>
                </Select>
              </Field>
            </div>
            <div className="col-span-12 flex items-center justify-end gap-1 sm:col-span-1">
              <Button variant="ghost" size="icon" onClick={() => move(index, -1)} aria-label="Nach oben">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => move(index, 1)} aria-label="Nach unten">
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setStages((current) => current.filter((_, i) => i !== index))}
                aria-label="Stage entfernen"
                disabled={Boolean(stage.dealCount && stage.dealCount > 0)}
                title={stage.dealCount ? `${stage.dealCount} Deals in dieser Stage` : undefined}
              >
                <Trash2 className="h-3.5 w-3.5 text-ink-400" />
              </Button>
            </div>
          </div>
        ))}

        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setStages((current) => [...current, { key: "", name: "", probability: 50, type: "OPEN" }])}
        >
          Stage hinzufügen
        </Button>
      </div>

      <div className="flex justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={onCancel} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {pipeline ? "Speichern" : "Pipeline erstellen"}
        </Button>
      </div>
    </form>
  );
}

function slugifyKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

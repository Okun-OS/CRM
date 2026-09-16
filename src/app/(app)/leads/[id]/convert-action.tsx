"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useReference } from "@/components/app/reference-provider";
import { api, ApiError } from "@/lib/api-client";

/**
 * Lead conversion. The user decides whether a deal is created; contact and
 * company are created from the lead's data and stay linked to it.
 */
export function ConvertLeadAction({
  leadId,
  leadName,
  companyName,
}: {
  leadId: string;
  leadName: string;
  companyName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { data } = useReference();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createDeal, setCreateDeal] = React.useState(true);
  const [dealName, setDealName] = React.useState(`${leadName}${companyName ? ` – ${companyName}` : ""}`);
  const [dealAmount, setDealAmount] = React.useState("0");
  const [pipelineId, setPipelineId] = React.useState("");

  const pipelines = data?.pipelines ?? [];
  React.useEffect(() => {
    if (!pipelineId && pipelines[0]) setPipelineId(pipelines[0].id);
  }, [pipelines, pipelineId]);

  async function convert() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ contactId?: string; dealId?: string }>(`/api/v1/leads/${leadId}/convert`, {
        createDeal,
        dealName: createDeal ? dealName : undefined,
        dealAmount: createDeal ? Number(dealAmount) : undefined,
        pipelineId: createDeal ? pipelineId : undefined,
      });
      toast.success("Lead konvertiert.");
      setOpen(false);
      router.push(result.dealId ? `/deals/${result.dealId}` : result.contactId ? `/contacts/${result.contactId}` : "/leads");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Konvertierung ist fehlgeschlagen.");
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" icon={<GitMerge className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Konvertieren
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Lead konvertieren"
        description="Aus dem Lead entstehen ein Kontakt, optional ein Unternehmen und ein Deal."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button variant="primary" loading={busy} onClick={convert}>
              Jetzt konvertieren
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? (
            <div role="alert" className="rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {error}
            </div>
          ) : null}

          <p className="text-xs leading-relaxed text-ink-600">
            Der Kontakt wird aus den Lead-Daten erstellt{companyName ? `, das Unternehmen „${companyName}" wird angelegt oder wiederverwendet` : ""}
            . Der Lead bleibt zur Nachvollziehbarkeit erhalten.
          </p>

          <label className="flex items-center gap-2 text-sm text-ink-800">
            <Checkbox checked={createDeal} onChange={(event) => setCreateDeal(event.target.checked)} />
            Deal anlegen
          </label>

          {createDeal ? (
            <div className="space-y-3 rounded-md border border-ink-200 p-3">
              <Field label="Dealname" htmlFor="dealName">
                <Input id="dealName" value={dealName} onChange={(event) => setDealName(event.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Wert" htmlFor="dealAmount">
                  <Input
                    id="dealAmount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={dealAmount}
                    onChange={(event) => setDealAmount(event.target.value)}
                  />
                </Field>
                <Field label="Pipeline" htmlFor="pipelineId">
                  <Select id="pipelineId" value={pipelineId} onChange={(event) => setPipelineId(event.target.value)}>
                    {pipelines.map((pipeline) => (
                      <option key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

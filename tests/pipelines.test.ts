import { describe, expect, it } from "vitest";
import { createTestOrganization, defaultPipeline } from "./setup/factories";
import { createPipeline, listPipelines, updatePipeline } from "@/server/services/pipelines";
import { createDeal, getDeal } from "@/server/services/deals";

const STAGES = [
  { key: "anfrage", name: "Anfrage", probability: 10, type: "OPEN" as const },
  { key: "angebot", name: "Angebot", probability: 45, type: "OPEN" as const },
  { key: "gewonnen", name: "Gewonnen", probability: 100, type: "WON" as const },
  { key: "verloren", name: "Verloren", probability: 0, type: "LOST" as const },
];

describe("Pipelines", () => {
  it("legt eine Pipeline mit ihren Stages an", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await createPipeline(ctx, { name: "Serviceverträge", stages: STAGES });
    expect(pipeline.stages).toHaveLength(4);
  });

  it("aktualisiert eine Pipeline, deren Stages ohne id übergeben werden", async () => {
    const { ctx } = await createTestOrganization();
    const created = await createPipeline(ctx, { name: "Serviceverträge", stages: STAGES });

    // Ein Aufruf, der die Stages nur über ihren Schlüssel benennt, darf sie
    // nicht als „entfernt und neu" behandeln — das lief zuvor in die
    // Eindeutigkeit von (pipelineId, key) und endete als Serverfehler.
    const after = await updatePipeline(ctx, created.id, {
      name: "Service & Wartung",
      stages: STAGES.map((stage) => (stage.key === "angebot" ? { ...stage, probability: 60 } : stage)),
    });

    const pipeline = after.find((entry) => entry.id === created.id);
    expect(pipeline?.name).toBe("Service & Wartung");
    expect(pipeline?.stages).toHaveLength(4);
    expect(pipeline?.stages.find((stage) => stage.key === "angebot")?.probability).toBe(60);

    // Die Stages sind dieselben Datensätze geblieben, nicht neu angelegte.
    const before = created.stages.map((stage) => stage.id).sort();
    expect(pipeline?.stages.map((stage) => stage.id).sort()).toEqual(before);
  });

  it("benennt eine Stage um, ohne ihre Deals zu verlieren", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);
    const stage = pipeline.stages[0];

    const deal = await createDeal(ctx, {
      name: "Testabschluss",
      pipelineId: pipeline.id,
      stageId: stage.id,
      amount: 1000,
    });

    const stages = pipeline.stages.map((entry) => ({
      id: entry.id,
      key: entry.key,
      name: entry.key === stage.key ? "Erstkontakt" : entry.name,
      probability: entry.probability,
      type: entry.type,
    }));

    await updatePipeline(ctx, pipeline.id, { name: pipeline.name, stages });

    const [reloaded] = (await listPipelines(ctx)).filter((entry) => entry.id === pipeline.id);
    expect(reloaded.stages.find((entry) => entry.id === stage.id)?.name).toBe("Erstkontakt");

    // Der Deal hängt weiterhin an derselben Stage, die jetzt anders heisst.
    const reloadedDeal = await getDeal(ctx, deal.id);
    expect(reloadedDeal.stage.id).toBe(stage.id);
    expect(reloadedDeal.stage.name).toBe("Erstkontakt");
  });

  it("verweigert das Entfernen einer Stage, in der noch Deals liegen", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);
    const stage = pipeline.stages[0];

    await createDeal(ctx, { name: "Blockierer", pipelineId: pipeline.id, stageId: stage.id, amount: 500 });

    const remaining = pipeline.stages
      .filter((entry) => entry.id !== stage.id)
      .map((entry) => ({ id: entry.id, key: entry.key, name: entry.name, probability: entry.probability, type: entry.type }));

    await expect(updatePipeline(ctx, pipeline.id, { name: pipeline.name, stages: remaining })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

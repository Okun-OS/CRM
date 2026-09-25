import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOrganization } from "./setup/factories";
import { getTourState, TOUR_VERSION, updateTourState } from "@/server/services/tour";

describe("Produkttour", () => {
  it("bietet sich einem neuen Konto an", async () => {
    const { ctx } = await createTestOrganization();
    const state = await getTourState(ctx);
    expect(state.shouldStart).toBe(true);
    expect(state.seenVersion).toBe(0);
    expect(state.version).toBe(TOUR_VERSION);
    expect(state.progress).toBeNull();
  });

  it("merkt sich Kapitel und Schritt", async () => {
    const { ctx } = await createTestOrganization();
    await updateTourState(ctx, { status: "running", progress: { chapter: "kontakte", step: 2 } });

    const state = await getTourState(ctx);
    expect(state.progress).toEqual({ chapter: "kontakte", step: 2 });
    // Ein laufender Fortschritt darf die Tour nicht als gesehen markieren.
    expect(state.shouldStart).toBe(true);
  });

  it("startet nach dem Abschluss nicht erneut von selbst", async () => {
    const { ctx } = await createTestOrganization();
    await updateTourState(ctx, { status: "running", progress: { chapter: "deals", step: 1 } });
    const state = await updateTourState(ctx, { status: "finished" });

    expect(state.shouldStart).toBe(false);
    expect(state.seenVersion).toBe(TOUR_VERSION);
    expect(state.progress).toBeNull();
    expect(state.finishedAt).not.toBeNull();
  });

  it("hält den Zustand am Menschen, nicht an der Organisation", async () => {
    const first = await createTestOrganization();
    const second = await createTestOrganization();

    await updateTourState(first.ctx, { status: "finished" });

    expect((await getTourState(first.ctx)).shouldStart).toBe(false);
    expect((await getTourState(second.ctx)).shouldStart).toBe(true);
  });

  it("lässt sich erneut starten, ohne sich danach wieder aufzudrängen", async () => {
    const { ctx } = await createTestOrganization();
    await updateTourState(ctx, { status: "finished" });
    const restarted = await updateTourState(ctx, { status: "restart" });

    // Der Fortschritt ist zurückgesetzt, die Tour gilt aber weiterhin als
    // gesehen: Wer sie selbst startet, will sie nicht beim nächsten Anmelden
    // erneut vorgesetzt bekommen.
    expect(restarted.progress).toBeNull();
    expect(restarted.shouldStart).toBe(false);
  });

  it("weist unbrauchbare Fortschrittsangaben ab", async () => {
    const { ctx } = await createTestOrganization();
    await expect(
      updateTourState(ctx, { status: "running", progress: { chapter: "", step: 0 } }),
    ).rejects.toBeTruthy();
    await expect(
      updateTourState(ctx, { status: "running", progress: { chapter: "kontakte", step: -1 } }),
    ).rejects.toBeTruthy();
  });

  it("übergeht einen beschädigten gespeicherten Fortschritt", async () => {
    const { ctx } = await createTestOrganization();
    // Etwa nach einer Umstellung des Formats: Die Tour soll dann von vorn
    // beginnen statt mit einem Fehler stehen zu bleiben.
    await prisma.user.update({ where: { id: ctx.userId }, data: { tourProgress: { unsinn: true } } });

    const state = await getTourState(ctx);
    expect(state.progress).toBeNull();
    expect(state.shouldStart).toBe(true);
  });
});

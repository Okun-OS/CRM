import { describe, expect, it } from "vitest";
import { createMeeting, deleteMeeting, listMeetings, updateMeeting } from "@/server/services/meetings";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/local-datetime";
import { createTestOrganization } from "./setup/factories";

/** Rückmeldungen aus der Testphase zum Kalender. */
describe("Kalender", () => {
  it("zeigt einen mehrtägigen Termin auch in einer Woche, in der er nicht beginnt", async () => {
    const { ctx } = await createTestOrganization();
    const meeting = await createMeeting(ctx, {
      title: "Messe",
      startAt: new Date("2026-11-10T08:00:00Z"),
      endAt: new Date("2026-11-25T16:00:00Z"),
    });

    const laterWeek = await listMeetings(ctx, { from: new Date("2026-11-16T00:00:00Z"), to: new Date("2026-11-22T23:59:59Z") });
    expect(laterWeek.map((entry) => entry.id)).toContain(meeting.id);

    const afterwards = await listMeetings(ctx, { from: new Date("2026-11-26T00:00:00Z"), to: new Date("2026-11-30T23:59:59Z") });
    expect(afterwards.map((entry) => entry.id)).not.toContain(meeting.id);
  });

  it("lässt einen Termin bearbeiten und löschen, ohne den Owner zu verlieren", async () => {
    const { ctx } = await createTestOrganization();
    const meeting = await createMeeting(ctx, {
      title: "Erstgespräch",
      startAt: new Date("2026-11-12T08:00:00Z"),
      endAt: new Date("2026-11-12T09:00:00Z"),
    });

    const updated = await updateMeeting(ctx, meeting.id, { title: "Erstgespräch (verschoben)", startAt: "2026-11-13T08:00:00.000Z", endAt: "2026-11-13T10:30:00.000Z" });
    expect(updated).toMatchObject({ title: "Erstgespräch (verschoben)", endAt: "2026-11-13T10:30:00.000Z", owner: { id: ctx.userId } });

    await deleteMeeting(ctx, meeting.id);
    const rest = await listMeetings(ctx, { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-30T00:00:00Z") });
    expect(rest.map((entry) => entry.id)).not.toContain(meeting.id);
  });
});

describe("Datum + Uhrzeit im Eingabefeld", () => {
  it("rechnet zwischen Ortszeit und ISO-Zeitpunkt hin und zurück", () => {
    // In der Ortszeit des Testlaufs: 9:00 bleibt 9:00 — egal, in welcher Zone der Server läuft.
    const iso = fromLocalInputValue("2026-11-10T09:00");
    expect(iso).toBe(new Date(2026, 10, 10, 9, 0).toISOString());
    expect(toLocalInputValue(iso)).toBe("2026-11-10T09:00");
    expect(fromLocalInputValue("")).toBeNull();
    expect(toLocalInputValue(null)).toBe("");
  });
});

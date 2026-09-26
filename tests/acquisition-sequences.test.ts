import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOrganization } from "./setup/factories";
import { createProspect } from "@/server/services/acquisition/prospects";
import { addSuppression, checkSuppression } from "@/server/services/acquisition/suppression";
import {
  createSendingAccount,
  canSendNow,
  localParts,
  nextGapMs,
} from "@/server/services/acquisition/sending-accounts";
import { createSequence, setSequenceStatus, updateSequence } from "@/server/services/acquisition/sequences";
import { enrollProspects, listEnrollments, stopEnrollment } from "@/server/services/acquisition/enrollment";
import { classifyByRules, recordBounce, recordReply, reclassifyReply } from "@/server/services/acquisition/replies";
import { runDueSequenceSteps } from "@/server/services/acquisition/runner";
import type { ActorContext } from "@/lib/context";

const ACCOUNT = {
  label: "Vertrieb",
  fromName: "Sabine Vogt",
  fromEmail: "vertrieb@okun.test",
  dailyLimit: 50,
  sendWindowStart: 0,
  sendWindowEnd: 24,
  sendDays: [1, 2, 3, 4, 5, 6, 7],
  timezone: "Europe/Berlin",
  minGapSeconds: 15,
  maxGapSeconds: 15,
};

const SEQUENCE = {
  name: "Erstansprache",
  steps: [
    { type: "AUTOMATED_EMAIL" as const, delayDays: 0, subject: "Kurze Frage", bodyHtml: "<p>Guten Tag {{prospect.firstName}}</p>" },
    { type: "TASK" as const, delayDays: 3, taskTitle: "Nachfassen per Telefon" },
  ],
};

async function readyProspect(ctx: ActorContext, email: string, companyName = "Zielkunde GmbH") {
  const prospect = await createProspect(ctx, { companyName, email, firstName: "Jana", lastName: "Merten" });
  await prisma.prospect.update({ where: { id: prospect.id }, data: { stage: "READY" } });
  return prospect;
}

describe("Versandkonten", () => {
  it("lehnt ein unsinniges Sendefenster ab", async () => {
    const { ctx } = await createTestOrganization();
    await expect(
      createSendingAccount(ctx, { ...ACCOUNT, sendWindowStart: 18, sendWindowEnd: 8 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lehnt eine unbekannte Zeitzone ab", async () => {
    const { ctx } = await createTestOrganization();
    await expect(createSendingAccount(ctx, { ...ACCOUNT, timezone: "Mars/Olympus" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("liest Stunde und Wochentag in der Zeitzone des Kontos", () => {
    // 1. Januar 2026, 23:30 UTC ist in Berlin bereits der 2. Januar, 00:30.
    const parts = localParts(new Date("2026-01-01T23:30:00Z"), "Europe/Berlin");
    expect(parts.hour).toBe(0);
    expect(parts.weekday).toBe(5); // Freitag
  });

  it("sperrt den Versand außerhalb des Sendefensters", async () => {
    const { ctx } = await createTestOrganization();
    const account = await createSendingAccount(ctx, { ...ACCOUNT, sendWindowStart: 9, sendWindowEnd: 17 });

    const nightly = await canSendNow(ctx.organizationId, account, new Date("2026-01-05T03:00:00Z"));
    expect(nightly.ok).toBe(false);
    if (!nightly.ok) expect(nightly.retryAt).not.toBeNull();

    const daytime = await canSendNow(ctx.organizationId, account, new Date("2026-01-05T10:00:00Z"));
    expect(daytime.ok).toBe(true);
  });

  it("sperrt den Versand an Nicht-Sendetagen", async () => {
    const { ctx } = await createTestOrganization();
    const account = await createSendingAccount(ctx, { ...ACCOUNT, sendDays: [1, 2, 3, 4, 5] });
    // 3. Januar 2026 ist ein Samstag.
    const weekend = await canSendNow(ctx.organizationId, account, new Date("2026-01-03T10:00:00Z"));
    expect(weekend.ok).toBe(false);
  });

  it("hält das Tageskontingent ein", async () => {
    const { ctx } = await createTestOrganization();
    const account = await createSendingAccount(ctx, { ...ACCOUNT, dailyLimit: 2 });
    const now = new Date("2026-01-05T10:00:00Z");

    for (let i = 0; i < 2; i += 1) {
      await prisma.emailMessage.create({
        data: {
          organizationId: ctx.organizationId,
          direction: "OUTBOUND",
          status: "SENT",
          subject: `Nr ${i}`,
          bodyHtml: "<p>x</p>",
          fromAddress: account.fromEmail,
          toAddresses: [`a${i}@x.test`],
          sendingAccountId: account.id,
          sentAt: new Date("2026-01-05T09:00:00Z"),
        },
      });
    }

    const decision = await canSendNow(ctx.organizationId, account, now);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("Tageskontingent");
  });

  it("wahrt den Mindestabstand zur letzten Nachricht", async () => {
    const { ctx } = await createTestOrganization();
    const account = await createSendingAccount(ctx, { ...ACCOUNT, minGapSeconds: 600, maxGapSeconds: 900 });
    const now = new Date("2026-01-05T10:00:00Z");

    await prisma.emailMessage.create({
      data: {
        organizationId: ctx.organizationId,
        direction: "OUTBOUND",
        status: "SENT",
        subject: "Vorherige",
        bodyHtml: "<p>x</p>",
        fromAddress: account.fromEmail,
        toAddresses: ["a@x.test"],
        sendingAccountId: account.id,
        sentAt: new Date("2026-01-05T09:58:00Z"),
      },
    });

    const decision = await canSendNow(ctx.organizationId, account, now);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("Mindestabstand");
  });

  it("streut die Abstände, statt gleichmäßig zu senden", () => {
    const values = new Set(Array.from({ length: 40 }, () => nextGapMs({ minGapSeconds: 60, maxGapSeconds: 600 })));
    expect(values.size).toBeGreaterThan(5);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(60_000);
      expect(value).toBeLessThanOrEqual(600_000);
    }
  });

  it("pausiert ein Konto und blockiert damit den Versand", async () => {
    const { ctx } = await createTestOrganization();
    const account = await createSendingAccount(ctx, ACCOUNT);
    await prisma.sendingAccount.update({
      where: { id: account.id },
      data: { status: "PAUSED", pausedReason: "Zu viele Rückläufer" },
    });

    const decision = await canSendNow(ctx.organizationId, { ...account, status: "PAUSED", pausedReason: "Zu viele Rückläufer" });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("Rückläufer");
  });
});

describe("Sequenzen", () => {
  it("legt eine Sequenz als Entwurf an", async () => {
    const { ctx } = await createTestOrganization();
    const sequence = await createSequence(ctx, SEQUENCE);
    expect(sequence.status).toBe("DRAFT");
    expect(sequence.steps).toHaveLength(2);
    expect(sequence.steps[0].position).toBe(0);
  });

  it("verlangt Inhalt für einen E-Mail-Schritt", async () => {
    const { ctx } = await createTestOrganization();
    await expect(
      createSequence(ctx, { name: "Leer", steps: [{ type: "AUTOMATED_EMAIL", delayDays: 0 }] }),
    ).rejects.toBeTruthy();
  });

  it("verlangt einen Titel für einen Aufgabenschritt", async () => {
    const { ctx } = await createTestOrganization();
    await expect(
      createSequence(ctx, { name: "Ohne Titel", steps: [{ type: "TASK", delayDays: 1 }] }),
    ).rejects.toBeTruthy();
  });

  it("verweigert das Scharfschalten ohne Versandkonto", async () => {
    const { ctx } = await createTestOrganization();
    const sequence = await createSequence(ctx, SEQUENCE);
    await expect(setSequenceStatus(ctx, sequence.id, "ACTIVE")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("schaltet mit Versandkonto scharf", async () => {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, SEQUENCE);
    const active = await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    expect(active.status).toBe("ACTIVE");
  });

  it("beendet laufende Einschreibungen beim Archivieren", async () => {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, SEQUENCE);
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(ctx, "a@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    await setSequenceStatus(ctx, sequence.id, "ARCHIVED");
    const enrollments = await listEnrollments(ctx, { sequenceId: sequence.id });
    expect(enrollments[0].status).toBe("STOPPED");
    expect(enrollments[0].stoppedReason).toBe("SEQUENCE_ARCHIVED");
  });

  it("schützt ausgeführte Schritte vor dem Entfernen", async () => {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, SEQUENCE);
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(ctx, "b@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    await expect(
      updateSequence(ctx, sequence.id, { name: SEQUENCE.name, steps: [SEQUENCE.steps[1]] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("Einschreibung", () => {
  async function setup() {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, SEQUENCE);
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    return { ctx, sequence };
  }

  it("schreibt ein und plant den ersten Schritt", async () => {
    const { ctx, sequence } = await setup();
    const prospect = await readyProspect(ctx, "neu@ziel.test");

    const result = await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });
    expect(result.enrolled).toBe(1);

    const runs = await prisma.enrollmentStepRun.findMany({ where: { organizationId: ctx.organizationId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("PENDING");

    const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(updated.stage).toBe("IN_SEQUENCE");
  });

  it("weist ohne E-Mail-Adresse ab", async () => {
    const { ctx, sequence } = await setup();
    const prospect = await createProspect(ctx, { companyName: "Ohne Adresse GmbH" });
    await prisma.prospect.update({ where: { id: prospect.id }, data: { stage: "READY" } });

    const result = await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });
    expect(result.enrolled).toBe(0);
    expect(result.rejected[0].reason).toContain("E-Mail-Adresse");
  });

  it("weist bei Kontaktsperre ab", async () => {
    const { ctx, sequence } = await setup();
    const prospect = await readyProspect(ctx, "gesperrt@ziel.test");
    await addSuppression(ctx, { scope: "EMAIL", value: "gesperrt@ziel.test", reason: "UNSUBSCRIBED" });

    const result = await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });
    expect(result.enrolled).toBe(0);
    expect(result.rejected[0].reason).toContain("abgemeldet");
  });

  it("verhindert die doppelte Einschreibung in dieselbe Sequenz", async () => {
    const { ctx, sequence } = await setup();
    const prospect = await readyProspect(ctx, "doppelt@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    const second = await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });
    expect(second.enrolled).toBe(0);
    expect(second.rejected[0].reason).toContain("bereits");
  });

  it("verhindert zwei gleichzeitige Sequenzen für denselben Menschen", async () => {
    const { ctx, sequence } = await setup();
    const other = await createSequence(ctx, { ...SEQUENCE, name: "Zweite Kampagne" });
    await setSequenceStatus(ctx, other.id, "ACTIVE");

    const prospect = await readyProspect(ctx, "einmal@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    const second = await enrollProspects(ctx, { sequenceId: other.id, prospectIds: [prospect.id] });
    expect(second.enrolled).toBe(0);
    expect(second.rejected[0].reason).toContain("Erstansprache");
  });

  it("prüft ohne zu schreiben, wenn nur geprüft werden soll", async () => {
    const { ctx, sequence } = await setup();
    const prospect = await readyProspect(ctx, "probe@ziel.test");

    const dry = await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id], dryRun: true });
    expect(dry.enrolled).toBe(1);
    expect(await prisma.sequenceEnrollment.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
  });

  it("beendet eine Einschreibung von Hand und räumt offene Schritte ab", async () => {
    const { ctx, sequence } = await setup();
    const prospect = await readyProspect(ctx, "stopp@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });
    const [enrollment] = await listEnrollments(ctx, { sequenceId: sequence.id });

    await stopEnrollment(ctx, enrollment.id, "Kunde hat telefonisch abgesagt");

    const runs = await prisma.enrollmentStepRun.findMany({ where: { enrollmentId: enrollment.id } });
    expect(runs.every((run) => run.status === "SKIPPED")).toBe(true);
  });
});

describe("Läufer", () => {
  it("verschiebt statt zu senden, wenn kein Versandweg da ist", async () => {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, SEQUENCE);
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(ctx, "warte@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    // Ohne verbundenen Transport darf nichts gesendet und nichts vorgetäuscht
    // werden — der Schritt wird verschoben und begründet.
    const result = await runDueSequenceSteps(ctx.organizationId, new Date(Date.now() + 60_000));
    expect(result.deferred).toBe(1);
    expect(result.executed).toBe(0);

    const run = await prisma.enrollmentStepRun.findFirstOrThrow({ where: { organizationId: ctx.organizationId } });
    expect(run.status).toBe("PENDING");
    expect(run.outcomeReason).toBeTruthy();
    expect(await prisma.emailMessage.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
  });

  it("überspringt und beendet, wenn zwischenzeitlich gesperrt wurde", async () => {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, SEQUENCE);
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(ctx, "spaeter-gesperrt@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    // Die Sperre entsteht nach dem Planen — genau der Fall, für den die
    // Bedingungen unmittelbar vor der Ausführung erneut geprüft werden.
    await addSuppression(ctx, { scope: "EMAIL", value: "spaeter-gesperrt@ziel.test", reason: "UNSUBSCRIBED" });

    const result = await runDueSequenceSteps(ctx.organizationId, new Date(Date.now() + 60_000));
    expect(result.skipped).toBe(1);

    const [enrollment] = await listEnrollments(ctx, { sequenceId: sequence.id });
    expect(enrollment.status).toBe("STOPPED");
    expect(enrollment.stoppedReason).toBe("SUPPRESSED");
  });

  it("führt einen Aufgabenschritt aus und geht weiter", async () => {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, {
      name: "Nur Aufgaben",
      steps: [
        { type: "TASK", delayDays: 0, taskTitle: "Erstkontakt vorbereiten" },
        { type: "CALL_TASK", delayDays: 2, taskTitle: "Anrufen" },
      ],
    });
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(ctx, "aufgabe@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    const result = await runDueSequenceSteps(ctx.organizationId, new Date(Date.now() + 60_000));
    expect(result.executed).toBe(1);

    const tasks = await prisma.task.findMany({ where: { organizationId: ctx.organizationId } });
    expect(tasks.map((task) => task.title)).toContain("Erstkontakt vorbereiten");

    // Der zweite Schritt ist geplant, aber noch nicht fällig.
    const runs = await prisma.enrollmentStepRun.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { scheduledFor: "asc" },
    });
    expect(runs).toHaveLength(2);
    expect(runs[1].status).toBe("PENDING");
  });

  it("führt denselben Schritt nicht zweimal aus", async () => {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, {
      name: "Einmalig",
      steps: [{ type: "TASK", delayDays: 0, taskTitle: "Genau einmal" }],
    });
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(ctx, "einmalig@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    const later = new Date(Date.now() + 60_000);
    await runDueSequenceSteps(ctx.organizationId, later);
    const second = await runDueSequenceSteps(ctx.organizationId, later);

    expect(second.executed).toBe(0);
    const tasks = await prisma.task.count({ where: { organizationId: ctx.organizationId, title: "Genau einmal" } });
    expect(tasks).toBe(1);
  });

  it("beendet die Einschreibung nach dem letzten Schritt", async () => {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, {
      name: "Kurz",
      steps: [{ type: "TASK", delayDays: 0, taskTitle: "Einziger Schritt" }],
    });
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(ctx, "kurz@ziel.test");
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    await runDueSequenceSteps(ctx.organizationId, new Date(Date.now() + 60_000));
    const [enrollment] = await listEnrollments(ctx, { sequenceId: sequence.id });
    expect(enrollment.status).toBe("COMPLETED");
    expect(enrollment.stoppedReason).toBe("FINISHED");
  });
});

describe("Antworten", () => {
  it("stuft nach Regeln ein und bleibt bei Unsicherheit ehrlich", () => {
    expect(classifyByRules("Abwesenheitsnotiz", "Ich bin im Urlaub").classification).toBe("OUT_OF_OFFICE");
    expect(classifyByRules("", "Bitte austragen, kein Interesse").classification).toBe("UNSUBSCRIBE");
    expect(classifyByRules("", "Kein Bedarf, danke").classification).toBe("NOT_INTERESTED");
    expect(classifyByRules("", "Wann hätten Sie Zeit für ein Telefonat?").classification).toBe("MEETING_REQUEST");

    const unclear = classifyByRules("Re: Ihre Nachricht", "Hm.");
    expect(unclear.classification).toBe("UNKNOWN");
    expect(unclear.confidence).toBe(0);
  });

  async function enrolled(email: string) {
    const { ctx } = await createTestOrganization();
    await createSendingAccount(ctx, ACCOUNT);
    const sequence = await createSequence(ctx, SEQUENCE);
    await setSequenceStatus(ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(ctx, email);
    await enrollProspects(ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });
    const [enrollment] = await listEnrollments(ctx, { sequenceId: sequence.id });
    return { ctx, sequence, prospect, enrollment };
  }

  it("hält die Sequenz bei einer echten Antwort an", async () => {
    const { ctx, prospect, sequence } = await enrolled("antwort@ziel.test");

    await recordReply(ctx, {
      prospectId: prospect.id,
      fromAddress: "antwort@ziel.test",
      subject: "Re: Kurze Frage",
      body: "Klingt interessant, schicken Sie gerne Unterlagen.",
    });

    const [enrollment] = await listEnrollments(ctx, { sequenceId: sequence.id });
    expect(enrollment.status).toBe("STOPPED");
    expect(enrollment.stoppedReason).toBe("REPLIED");

    const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(updated.stage).toBe("INTERESTED");
    expect(updated.repliedAt).not.toBeNull();
  });

  it("hält die Sequenz bei einer Abwesenheitsnotiz NICHT an", async () => {
    const { ctx, prospect, sequence } = await enrolled("urlaub@ziel.test");

    await recordReply(ctx, {
      prospectId: prospect.id,
      fromAddress: "urlaub@ziel.test",
      subject: "Automatische Antwort: Abwesenheit",
      body: "Ich bin im Urlaub bis zum 12.",
    });

    const [enrollment] = await listEnrollments(ctx, { sequenceId: sequence.id });
    expect(enrollment.status).toBe("ACTIVE");

    const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(updated.stage).toBe("IN_SEQUENCE");
  });

  it("sperrt bei einer Abmeldung und beendet die Sequenz", async () => {
    const { ctx, prospect, sequence } = await enrolled("abmeldung@ziel.test");

    await recordReply(ctx, {
      prospectId: prospect.id,
      fromAddress: "abmeldung@ziel.test",
      subject: "Bitte austragen",
      body: "Bitte austragen, keine weiteren E-Mails.",
    });

    expect((await checkSuppression(ctx.organizationId, "abmeldung@ziel.test")).blocked).toBe(true);

    const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(updated.stage).toBe("DO_NOT_CONTACT");

    const [enrollment] = await listEnrollments(ctx, { sequenceId: sequence.id });
    expect(enrollment.stoppedReason).toBe("UNSUBSCRIBED");
  });

  it("zieht die Folgen erneut, wenn von Hand umgestuft wird", async () => {
    const { ctx, prospect } = await enrolled("unklar@ziel.test");

    const reply = await recordReply(ctx, {
      prospectId: prospect.id,
      fromAddress: "unklar@ziel.test",
      subject: "Re:",
      body: "Hm.",
    });
    expect(reply.classification).toBe("UNKNOWN");

    await reclassifyReply(ctx, reply.messageId, { classification: "UNSUBSCRIBE" });
    expect((await checkSuppression(ctx.organizationId, "unklar@ziel.test")).blocked).toBe(true);
  });

  it("sperrt die Adresse bei einem Rückläufer", async () => {
    const { ctx, prospect, enrollment } = await enrolled("tot@ziel.test");

    const message = await prisma.emailMessage.create({
      data: {
        organizationId: ctx.organizationId,
        direction: "OUTBOUND",
        status: "SENT",
        subject: "Kurze Frage",
        bodyHtml: "<p>x</p>",
        fromAddress: "vertrieb@okun.test",
        toAddresses: ["tot@ziel.test"],
        prospectId: prospect.id,
        enrollmentId: enrollment.id,
        sentAt: new Date(),
      },
    });

    await recordBounce(ctx, message.id, "550 5.1.1 recipient unknown");

    expect((await checkSuppression(ctx.organizationId, "tot@ziel.test")).blocked).toBe(true);
    const [after] = await listEnrollments(ctx, { prospectId: prospect.id });
    expect(after.stoppedReason).toBe("BOUNCED");
  });
});

describe("Mandantentrennung der Akquiseschicht", () => {
  it("hält Sequenzen und Einschreibungen getrennt", async () => {
    const first = await createTestOrganization();
    const second = await createTestOrganization();

    await createSendingAccount(first.ctx, ACCOUNT);
    const sequence = await createSequence(first.ctx, SEQUENCE);
    await setSequenceStatus(first.ctx, sequence.id, "ACTIVE");
    const prospect = await readyProspect(first.ctx, "geheim@ziel.test");
    await enrollProspects(first.ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] });

    expect(await listEnrollments(second.ctx, {})).toHaveLength(0);
    await expect(
      enrollProspects(second.ctx, { sequenceId: sequence.id, prospectIds: [prospect.id] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Der Lauf der einen Organisation rührt die andere nicht an.
    const result = await runDueSequenceSteps(second.ctx.organizationId, new Date(Date.now() + 60_000));
    expect(result.executed + result.deferred + result.skipped).toBe(0);
  });
});

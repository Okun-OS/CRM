import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { passwordSchema } from "@/lib/schemas/auth";
import { login, LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILED_ATTEMPTS } from "@/server/services/auth";
import { generatePassword, resetPassword, unlockAccount } from "@/server/services/account-recovery";
import { createPlatformUser } from "@/server/services/platform";
import { POST as postLogin } from "@/app/api/v1/auth/login/route";
import { createTestOrganization } from "./setup/factories";

/**
 * Anmeldesperre und Wiederherstellung des Zugangs über die Konsole
 * (`pnpm admin:set-password`, `pnpm admin:unlock`).
 */
const PASSWORD = "TestPasswort2026!";
const WRONG = "FalschesPasswort1";

beforeEach(() => resetRateLimits());

async function failTimes(email: string, times: number) {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await login({ email, password: WRONG }).catch(() => undefined);
  }
}

async function routeLogin(email: string, password: string) {
  const response = await postLogin(
    new NextRequest("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
    { params: Promise.resolve({}) },
  );
  return { status: response.status, json: await response.json() };
}

describe("Anmeldesperre", () => {
  it("sperrt nach zu vielen Fehlversuchen und nennt die Restzeit", async () => {
    const { user } = await createTestOrganization();
    await failTimes(user.email, LOGIN_MAX_FAILED_ATTEMPTS);

    const blocked = await login({ email: user.email, password: PASSWORD }).catch((error) => error);
    expect(blocked.message).toMatch(/gesperrt\. Bitte in 15 Minuten erneut versuchen\.$/);
  });

  it("sperrt nach Ablauf der Sperre nicht schon beim ersten Tippfehler wieder", async () => {
    const { user } = await createTestOrganization();
    const past = new Date(Date.now() - 60_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: LOGIN_MAX_FAILED_ATTEMPTS, lockedUntil: past, lastFailedLoginAt: new Date(past.getTime() - 15 * 60_000) },
    });

    await failTimes(user.email, 1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ failedLoginCount: 1, lockedUntil: null });
    await expect(login({ email: user.email, password: PASSWORD })).resolves.toMatchObject({ userId: user.id });
  });

  it("lässt alte Fehlversuche verfallen", async () => {
    const { user } = await createTestOrganization();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: LOGIN_MAX_FAILED_ATTEMPTS - 1,
        lastFailedLoginAt: new Date(Date.now() - LOGIN_FAILURE_WINDOW_MS - 60_000),
      },
    });
    await failTimes(user.email, 1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ failedLoginCount: 1, lockedUntil: null });
  });
});

describe("Hinweise der Anmeldung", () => {
  it("warnt vor der Sperre — gleichlautend für bestehende und unbekannte Adressen", async () => {
    const { user } = await createTestOrganization();
    const unknown = `niemand-${Date.now()}@example.test`;
    let known = { status: 0, json: {} as { error: { message: string } } };
    let other = known;
    for (let attempt = 0; attempt < LOGIN_MAX_FAILED_ATTEMPTS - 3; attempt += 1) {
      known = await routeLogin(user.email, WRONG);
      other = await routeLogin(unknown, WRONG);
    }
    expect(known.status).toBe(401);
    expect(known.json.error.message).toBe(
      "E-Mail-Adresse oder Passwort ist falsch. Noch 3 Versuche, dann wird die Anmeldung für 15 Minuten gesperrt.",
    );
    expect(other.json.error.message).toBe(known.json.error.message);
  });

  it("meldet die Sperre beim letzten Versuch und danach mit Restzeit", async () => {
    const { user } = await createTestOrganization();
    let last = { status: 0, json: {} as { error: { message: string } } };
    for (let attempt = 0; attempt < LOGIN_MAX_FAILED_ATTEMPTS; attempt += 1) last = await routeLogin(user.email, WRONG);
    expect(last.json.error.message).toContain("Die Anmeldung ist jetzt für 15 Minuten gesperrt.");

    const blocked = await routeLogin(user.email, PASSWORD);
    expect(blocked.json.error.message).toMatch(/Bitte in (15|14) Minuten erneut versuchen\.$/);
  });

  it("lässt nach dem Entsperren über die Konsole wieder Versuche zu, obwohl der Zähler im Speicher voll ist", async () => {
    const { user } = await createTestOrganization();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILED_ATTEMPTS; attempt += 1) await routeLogin(user.email, WRONG);

    await unlockAccount(user.email);
    const again = await routeLogin(user.email, WRONG);
    expect(again.json.error.message).toBe("E-Mail-Adresse oder Passwort ist falsch.");
  });
});

describe("Zugang über die Konsole wiederherstellen", () => {
  it("setzt ein zufälliges Passwort, hebt die Sperre auf und meldet alle Sitzungen ab", async () => {
    const { user, organization } = await createTestOrganization();
    await failTimes(user.email, LOGIN_MAX_FAILED_ATTEMPTS);
    await prisma.session.create({
      data: { tokenHash: hashToken(`alt-${Date.now()}`), userId: user.id, csrfToken: "csrf", expiresAt: new Date(Date.now() + 86_400_000) },
    });

    const result = await resetPassword(user.email.toUpperCase());
    expect(result).toMatchObject({ email: user.email, wasLocked: true, revokedSessions: 1 });
    expect(passwordSchema.safeParse(result.password).success).toBe(true);

    await expect(login({ email: user.email, password: result.password })).resolves.toMatchObject({ userId: user.id });
    await expect(login({ email: user.email, password: PASSWORD })).rejects.toThrow("falsch");
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { organizationId: organization.id, action: "user.password_reset", entityId: user.id } }),
    ).toBe(1);
  });

  it("übernimmt ein vorgegebenes Passwort nur, wenn es den Regeln entspricht", async () => {
    const { user } = await createTestOrganization();
    await expect(resetPassword(user.email, "kurz")).rejects.toThrow("mindestens 12 Zeichen");
    await expect(login({ email: user.email, password: PASSWORD })).resolves.toMatchObject({ userId: user.id });

    await resetPassword(user.email, "EigenesPasswort2026");
    await expect(login({ email: user.email, password: "EigenesPasswort2026" })).resolves.toMatchObject({ userId: user.id });
  });

  it("entsperrt ein Betreiberkonto, ohne das Passwort zu ändern", async () => {
    const email = `betreiber-${Date.now()}@example.test`;
    await createPlatformUser({ email, name: "Betreiber", password: PASSWORD });
    await failTimes(email, LOGIN_MAX_FAILED_ATTEMPTS);

    const result = await unlockAccount(email);
    expect(result).toMatchObject({ isPlatformAdmin: true, wasLocked: true, organizations: [] });
    await expect(login({ email, password: PASSWORD })).resolves.toMatchObject({ redirectTo: "/admin" });
    expect(await prisma.platformAuditLog.count({ where: { action: "user.unlocked", details: { equals: { email } } } })).toBe(1);
  });

  it("meldet eine unbekannte Adresse", async () => {
    await expect(unlockAccount("gibt-es-nicht@example.test")).rejects.toThrow("Kein Konto");
  });

  it("erzeugt gut abtippbare, starke Passwörter", () => {
    const passwords = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(passwords.size).toBe(50);
    for (const password of passwords) {
      expect(password).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
      expect(password).not.toMatch(/[lIO01]/);
    }
  });
});

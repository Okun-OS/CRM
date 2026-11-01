import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { NotFound, ValidationError } from "@/lib/api/errors";
import { emailField } from "@/lib/schemas/crm";
import { passwordSchema } from "@/lib/schemas/auth";

/**
 * Zugang wiederherstellen: Passwort neu setzen, Sperre aufheben.
 *
 * Das CRM verschickt keine E-Mails, ein „Passwort vergessen“ per Link gibt es
 * deshalb nicht. Wer an die Konsole des Servers kommt, darf das Passwort
 * setzen (`scripts/set-user-password.ts`) — über die Oberfläche geht es
 * bewusst nicht, sonst wäre es ein Weg zur Kontoübernahme.
 */

/** Ohne leicht verwechselbare Zeichen (l/I/1, O/0), damit es sich abtippen lässt. */
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** Vier Vierergruppen (rund 90 Bit), erfüllt die Passwortregeln. */
export function generatePassword(): string {
  const alphabet = LOWER + UPPER + DIGITS;
  for (;;) {
    const candidate = Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(""),
    ).join("-");
    if (passwordSchema.safeParse(candidate).success) return candidate;
  }
}

export type RecoveredAccount = {
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  organizations: { name: string; role: string }[];
  /** War das Konto beim Aufruf gesperrt? */
  wasLocked: boolean;
};

const CONSOLE_ACTOR = "Server-Konsole";

async function findAccount(rawEmail: string) {
  const parsed = emailField.safeParse(rawEmail);
  if (!parsed.success) throw ValidationError(`„${rawEmail}“ ist keine gültige E-Mail-Adresse.`);
  const email = parsed.data;
  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      isPlatformAdmin: true,
      lockedUntil: true,
      memberships: { select: { role: true, organization: { select: { id: true, name: true } } } },
    },
  });
  if (!user) throw NotFound(`Kein Konto mit der Adresse „${email}“.`);
  return user;
}

type Account = Awaited<ReturnType<typeof findAccount>>;

/** Nachvollziehbar in jeder Organisation des Kontos — und auf Betreiberebene. */
async function audit(user: Account, action: string) {
  for (const membership of user.memberships) {
    await prisma.auditLog.create({
      data: {
        organizationId: membership.organization.id,
        actorEmail: CONSOLE_ACTOR,
        action,
        entityType: "User",
        entityId: user.id,
        after: { email: user.email },
      },
    });
  }
  if (user.isPlatformAdmin) {
    await prisma.platformAuditLog.create({
      data: { actorEmail: CONSOLE_ACTOR, action, details: { email: user.email } },
    });
  }
}

function describe(user: Account): RecoveredAccount {
  return {
    email: user.email,
    name: user.name,
    isPlatformAdmin: user.isPlatformAdmin,
    organizations: user.memberships.map((membership) => ({ name: membership.organization.name, role: membership.role })),
    wasLocked: Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now()),
  };
}

/**
 * Setzt ein neues Passwort (ohne Angabe ein zufälliges), hebt eine Sperre auf
 * und meldet alle Sitzungen ab — wer das alte Passwort kannte, ist danach
 * draußen.
 */
export async function resetPassword(
  rawEmail: string,
  password?: string,
): Promise<RecoveredAccount & { password: string; revokedSessions: number }> {
  const user = await findAccount(rawEmail);
  const next = password ?? generatePassword();
  const checked = passwordSchema.safeParse(next);
  if (!checked.success) throw ValidationError(checked.error.issues.map((issue) => issue.message).join(" "));

  const [, revoked] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(next), failedLoginCount: 0, lockedUntil: null, lastFailedLoginAt: null },
    }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(user, "user.password_reset");
  return { ...describe(user), password: next, revokedSessions: revoked.count };
}

/** Hebt nur die Sperre nach Fehlversuchen auf; das Passwort bleibt. */
export async function unlockAccount(rawEmail: string): Promise<RecoveredAccount> {
  const user = await findAccount(rawEmail);
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastFailedLoginAt: null },
  });
  await audit(user, "user.unlocked");
  return describe(user);
}

/** Für die Fehlermeldung des Skripts: welche Konten es gibt. */
export async function listAccounts(take = 30) {
  return prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    take,
    select: { email: true, name: true, isPlatformAdmin: true, lockedUntil: true },
  });
}

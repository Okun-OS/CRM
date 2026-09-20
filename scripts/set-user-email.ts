/**
 * Ändert die Anmelde-E-Mail eines Kontos.
 *
 * Die Oberfläche kann das bewusst nicht: Die E-Mail ist die Anmeldeidentität,
 * und ohne Bestätigungsmail wäre eine Selbstbedienung ein Weg zur
 * Kontoübernahme. Für den Betrieb — etwa den ersten Administrator auf eine
 * echte Adresse umstellen — gibt es dieses Skript.
 *
 * Aufruf (auf Railway im Reiter „Console" des CRM-Dienstes):
 *   pnpm admin:set-email alt@beispiel.de kontakt@okun-systems.com
 *
 * Alle Sitzungen des Kontos werden dabei beendet: Wer die alte Adresse hatte,
 * soll sich mit der neuen neu anmelden müssen. Das Passwort bleibt unverändert.
 */
import "dotenv/config";

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

async function main() {
  const [rawFrom, rawTo] = process.argv.slice(2);
  if (!rawFrom || !rawTo) {
    console.error("Aufruf: pnpm admin:set-email <alte-adresse> <neue-adresse>");
    process.exit(1);
  }

  const from = normalise(rawFrom);
  const to = normalise(rawTo);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    console.error(`Die neue Adresse "${to}" ist keine gültige E-Mail-Adresse.`);
    process.exit(1);
  }

  const { prisma } = await import("@/lib/db");

  const user = await prisma.user.findUnique({
    where: { email: from },
    select: {
      id: true,
      name: true,
      email: true,
      memberships: {
        select: { role: true, status: true, organization: { select: { id: true, name: true } } },
      },
    },
  });

  if (!user) {
    console.error(`Kein Konto mit der Adresse "${from}" gefunden.`);
    const all = await prisma.user.findMany({ select: { email: true }, orderBy: { createdAt: "asc" }, take: 20 });
    if (all.length === 0) {
      console.error("Es existiert noch gar kein Konto — bitte zuerst unter /register registrieren.");
    } else {
      console.error("Vorhandene Konten:");
      for (const entry of all) console.error(`  - ${entry.email}`);
    }
    process.exit(1);
  }

  if (from !== to) {
    const taken = await prisma.user.findUnique({ where: { email: to }, select: { id: true } });
    if (taken) {
      console.error(`Die Adresse "${to}" wird bereits von einem anderen Konto verwendet.`);
      process.exit(1);
    }
  }

  const [updated, revoked] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { email: to }, select: { id: true, email: true } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);

  // Nachvollziehbar in jeder Organisation, der das Konto angehört.
  for (const membership of user.memberships) {
    await prisma.auditLog.create({
      data: {
        organizationId: membership.organization.id,
        actorId: user.id,
        actorEmail: to,
        action: "user.email_changed",
        entityType: "User",
        entityId: user.id,
        before: { email: from },
        after: { email: to },
      },
    });
  }

  console.log(`E-Mail geändert: ${from} → ${updated.email}`);
  console.log(`Name: ${user.name}`);
  for (const membership of user.memberships) {
    console.log(`Organisation: ${membership.organization.name} — Rolle ${membership.role} (${membership.status})`);
  }
  console.log(`Beendete Sitzungen: ${revoked.count}. Bitte mit der neuen Adresse und dem bisherigen Passwort anmelden.`);

  await prisma.$disconnect();
}

void main();

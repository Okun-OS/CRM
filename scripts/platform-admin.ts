/**
 * Verwaltet die Betreiber-Ebene (OKUN Software).
 *
 * Diese Ebene lässt sich bewusst nicht aus der Oberfläche heraus vergeben:
 * Wer Mandanten verwalten darf, wird an der Infrastruktur entschieden, nicht
 * von einem Kunden-Administrator. Auf Railway im Reiter „Console":
 *
 *   pnpm platform:admin grant   kontakt@okun-systems.com
 *   pnpm platform:admin revoke  kontakt@okun-systems.com
 *   pnpm platform:admin create  kontakt@okun-systems.com "Felix Okun" "EinPasswort2026!"
 *   pnpm platform:admin list
 *
 * `create` legt ein Konto an, das ausschließlich Betreiber ist — ohne
 * Mitgliedschaft in irgendeiner Kundenorganisation. Genau so soll es sein.
 */
import "dotenv/config";

function usage(): never {
  console.error("Aufruf:");
  console.error("  pnpm platform:admin list");
  console.error("  pnpm platform:admin grant  <e-mail>");
  console.error("  pnpm platform:admin revoke <e-mail>");
  console.error('  pnpm platform:admin create <e-mail> "<Name>" "<Passwort>"');
  process.exit(1);
}

async function main() {
  const [command, email, name, password] = process.argv.slice(2);
  if (!command) usage();

  const { prisma } = await import("@/lib/db");
  const { setPlatformAdmin, createPlatformUser } = await import("@/server/services/platform");

  try {
    if (command === "list") {
      const admins = await prisma.user.findMany({
        where: { isPlatformAdmin: true, deletedAt: null },
        select: { email: true, name: true, lastLoginAt: true },
        orderBy: { createdAt: "asc" },
      });
      if (admins.length === 0) {
        console.log("Es gibt noch keinen Betreiberzugang.");
        console.log('Anlegen mit: pnpm platform:admin create <e-mail> "<Name>" "<Passwort>"');
      } else {
        console.log(`Betreiberzugänge (${admins.length}):`);
        for (const admin of admins) {
          const seen = admin.lastLoginAt ? admin.lastLoginAt.toISOString().slice(0, 10) : "noch nie angemeldet";
          console.log(`  - ${admin.email} (${admin.name}) — ${seen}`);
        }
      }
      return;
    }

    if (!email) usage();

    if (command === "grant" || command === "revoke") {
      const enabled = command === "grant";
      const user = await setPlatformAdmin(email, enabled);
      console.log(
        enabled
          ? `${user.email} ist jetzt Betreiber und erreicht /admin.`
          : `${user.email} ist kein Betreiber mehr.`,
      );
      await prisma.platformAuditLog.create({
        data: {
          actorId: user.id,
          actorEmail: user.email,
          action: enabled ? "platform_admin.granted" : "platform_admin.revoked",
          details: { viaScript: true },
        },
      });
      return;
    }

    if (command === "create") {
      if (!name || !password) usage();
      if (password.length < 12) {
        console.error("Das Passwort muss mindestens 12 Zeichen haben.");
        process.exit(1);
      }
      const user = await createPlatformUser({ email, name, password });
      console.log(`Betreiberzugang angelegt: ${user.email}`);
      console.log("Anmeldung unter /login, danach /admin aufrufen.");
      await prisma.platformAuditLog.create({
        data: {
          actorId: user.id,
          actorEmail: user.email,
          action: "platform_admin.granted",
          details: { viaScript: true, created: true },
        },
      });
      return;
    }

    usage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Prisma meldet ein fehlendes Konto als P2025.
    if (message.includes("P2025") || message.includes("No record")) {
      console.error(`Kein Konto mit der Adresse "${email}" gefunden.`);
      console.error('Ein neues Betreiberkonto anlegen: pnpm platform:admin create <e-mail> "<Name>" "<Passwort>"');
    } else {
      console.error(message);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();

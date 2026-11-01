/**
 * Zugang wiederherstellen, wenn das Passwort vergessen oder das Konto nach
 * Fehlversuchen gesperrt ist. Das CRM verschickt keine E-Mails, deshalb gibt es
 * kein „Passwort vergessen“ — wer an die Server-Konsole kommt, macht es hier.
 * Auf Railway im Reiter „Console“ des CRM-Dienstes:
 *
 *   pnpm admin:set-password kontakt@okun-systems.com                  # neues Zufallspasswort
 *   pnpm admin:set-password kontakt@okun-systems.com "EigenesPasswort2026"
 *   pnpm admin:unlock       kontakt@okun-systems.com                  # nur entsperren
 *
 * Das neue Passwort erscheint genau einmal hier in der Konsole. Bitte nicht in
 * Chats kopieren, sondern direkt anmelden und unter Profil & Sicherheit ein
 * eigenes setzen. Ein selbst gewähltes Passwort als Argument landet im
 * Befehlsverlauf der Konsole — das Zufallspasswort ist deshalb der Normalfall.
 */
import "dotenv/config";

function usage(): never {
  console.error("Aufruf:");
  console.error("  pnpm admin:set-password <e-mail> [\"<neues Passwort>\"]");
  console.error("  pnpm admin:unlock <e-mail>");
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const unlockOnly = args[0] === "--unlock";
  const [email, password] = unlockOnly ? args.slice(1) : args;
  if (!email) usage();

  const { prisma } = await import("@/lib/db");
  const { AppError } = await import("@/lib/api/errors");
  const { listAccounts, resetPassword, unlockAccount } = await import("@/server/services/account-recovery");

  try {
    const reset = unlockOnly ? null : await resetPassword(email, password);
    const account = reset ?? (await unlockAccount(email));

    console.log("");
    console.log(`Konto     : ${account.email} (${account.name})${account.isPlatformAdmin ? " — Betreiber" : ""}`);
    for (const organization of account.organizations) {
      console.log(`Organisation: ${organization.name} — Rolle ${organization.role}`);
    }
    console.log(`Sperre    : ${account.wasLocked ? "war aktiv, ist aufgehoben" : "war nicht aktiv; Fehlversuche zurückgesetzt"}`);
    if (reset) {
      console.log(`Sitzungen : ${reset.revokedSessions} abgemeldet`);
      console.log("");
      console.log(password ? "Neues Passwort: wie angegeben" : `Neues Passwort: ${reset.password}`);
      console.log("");
      console.log("Bitte damit anmelden und unter Profil & Sicherheit ein eigenes Passwort setzen.");
    } else {
      console.log("Das Passwort ist unverändert.");
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      console.error(error.message);
      const accounts = await listAccounts();
      if (accounts.length === 0) {
        console.error("Es existiert noch gar kein Konto — bitte zuerst unter /register registrieren.");
      } else {
        console.error("Vorhandene Konten:");
        for (const entry of accounts) {
          const locked = entry.lockedUntil && entry.lockedUntil.getTime() > Date.now() ? " — gesperrt" : "";
          console.error(`  - ${entry.email} (${entry.name})${entry.isPlatformAdmin ? " — Betreiber" : ""}${locked}`);
        }
      }
      process.exitCode = 1;
    } else if (error instanceof AppError) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();

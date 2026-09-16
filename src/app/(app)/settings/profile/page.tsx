import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { listSessions } from "@/server/services/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { ProfileForms } from "./profile-forms";

export const metadata: Metadata = { title: "Profil & Sicherheit" };
export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;

  const [user, sessions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, email: true, timezone: true, locale: true, twoFactorEnabledAt: true },
    }),
    listSessions(actor),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="Profil & Sicherheit" description="Deine persönlichen Angaben, dein Passwort und deine aktiven Sitzungen." />
      <ProfileForms
        profile={{
          name: user?.name ?? actor.name,
          email: user?.email ?? actor.email,
          timezone: user?.timezone ?? "Europe/Berlin",
          locale: user?.locale ?? "de-DE",
        }}
        twoFactorEnabled={Boolean(user?.twoFactorEnabledAt)}
        sessions={sessions}
      />
    </div>
  );
}

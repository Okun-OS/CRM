import { redirect } from "next/navigation";
import { getActor, getPlatformActor } from "@/lib/auth/session";
import { AppShell } from "@/components/app/app-shell";

/**
 * Every authenticated screen renders inside this layout. The actor is resolved
 * on the server — an unauthenticated visitor never reaches the client bundle.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) {
    // Ein Betreiber gehört keinem Mandanten an — ihn auf die Anmeldung zu
    // schicken, während er angemeldet ist, ergäbe eine Schleife.
    if (await getPlatformActor()) redirect("/admin");
    redirect("/login");
  }

  return (
    <AppShell
      user={{ name: actor.name, email: actor.email }}
      organizationName={actor.organizationName}
      role={actor.role}
      permissions={actor.permissions}
    >
      {children}
    </AppShell>
  );
}

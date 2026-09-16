import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { AppShell } from "@/components/app/app-shell";

/**
 * Every authenticated screen renders inside this layout. The actor is resolved
 * on the server — an unauthenticated visitor never reaches the client bundle.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");

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

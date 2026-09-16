import { getActor } from "@/lib/auth/session";
import { SettingsNav } from "./settings-nav";

/**
 * Administration shell. The sub-navigation only shows sections the actor may
 * actually open — the server refuses the rest anyway.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <SettingsNav permissions={actor.permissions} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listInvitations, listMembers, listTeams } from "@/server/services/users";
import { assignableRoles } from "@/lib/rbac";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Benutzer & Teams" };
export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "users.read")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Für die Benutzerverwaltung fehlt dir die Berechtigung." />
      </Card>
    );
  }

  const canManage = can(actor, "users.manage");
  const [members, teams, invitations] = await Promise.all([
    listMembers(actor),
    listTeams(actor),
    canManage ? listInvitations(actor) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Benutzer & Teams"
        description="Wer Zugriff auf diese Organisation hat und mit welcher Rolle."
      />
      <UsersView
        members={members}
        teams={teams}
        invitations={invitations}
        canManage={canManage}
        assignableRoles={assignableRoles(actor.role)}
        currentUserId={actor.userId}
      />
    </div>
  );
}

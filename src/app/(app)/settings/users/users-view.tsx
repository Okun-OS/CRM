"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2, UserPlus } from "lucide-react";
import type { Role } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { Avatar } from "@/components/ui/misc";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/crm/forms/form-kit";
import { api, ApiError } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/rbac";
import { formatDate, formatRelative } from "@/lib/format";

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  team: { id: string; name: string } | null;
  lastLoginAt: string | null;
  twoFactorEnabled: boolean;
};

type Team = { id: string; name: string; parentTeam: { id: string; name: string } | null; memberCount: number };
type Invitation = { id: string; email: string; role: Role; expiresAt: string; expired: boolean };

export function UsersView({
  members,
  teams,
  invitations,
  canManage,
  assignableRoles,
  currentUserId,
}: {
  members: Member[];
  teams: Team[];
  invitations: Invitation[];
  canManage: boolean;
  assignableRoles: Role[];
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [inviting, setInviting] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<Member | null>(null);
  const [creatingTeam, setCreatingTeam] = React.useState(false);

  async function updateMember(member: Member, patch: Record<string, unknown>) {
    try {
      await api.patch(`/api/v1/users/${member.id}`, patch);
      toast.success("Mitglied aktualisiert.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Änderung war nicht möglich.");
    }
  }

  async function removeMember() {
    if (!removing) return;
    try {
      await api.delete(`/api/v1/users/${removing.id}`);
      toast.success("Mitglied entfernt.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Das Mitglied konnte nicht entfernt werden.");
    } finally {
      setRemoving(null);
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    try {
      await api.post(`/api/v1/invitations/${invitation.id}/revoke`);
      toast.success("Einladung zurückgezogen.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Die Einladung konnte nicht zurückgezogen werden.");
    }
  }

  async function deleteTeam(team: Team) {
    try {
      await api.delete(`/api/v1/teams/${team.id}`);
      toast.success("Team gelöscht.");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Das Team konnte nicht gelöscht werden.");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader
          title={`Mitglieder (${members.length})`}
          action={
            canManage ? (
              <Button size="sm" variant="primary" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setInviting(true)}>
                Einladen
              </Button>
            ) : null
          }
        />
        <DataTable>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Rolle</Th>
              <Th>Team</Th>
              <Th>Status</Th>
              <Th>Zuletzt aktiv</Th>
              {canManage ? <Th align="right">Aktion</Th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <Tr key={member.id}>
                <Td>
                  <span className="flex items-center gap-2">
                    <Avatar name={member.name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink-900">{member.name}</span>
                      <span className="block truncate text-2xs text-ink-500">{member.email}</span>
                    </span>
                  </span>
                </Td>
                <Td>
                  {canManage && member.userId !== currentUserId ? (
                    <Select
                      value={member.role}
                      onChange={(event) => updateMember(member, { role: event.target.value })}
                      className="h-8 w-40 text-xs"
                      aria-label={`Rolle von ${member.name}`}
                    >
                      {assignableRoles.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone="brand">{ROLE_LABELS[member.role]}</Badge>
                  )}
                </Td>
                <Td>
                  {canManage ? (
                    <Select
                      value={member.team?.id ?? ""}
                      onChange={(event) => updateMember(member, { teamId: event.target.value || null })}
                      className="h-8 w-36 text-xs"
                      aria-label={`Team von ${member.name}`}
                    >
                      <option value="">— kein Team —</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    member.team?.name ?? "—"
                  )}
                </Td>
                <Td>
                  {member.status === "ACTIVE" ? (
                    <Badge tone="success" dot>
                      Aktiv
                    </Badge>
                  ) : member.status === "INVITED" ? (
                    <Badge tone="warning">Eingeladen</Badge>
                  ) : (
                    <Badge tone="danger">Gesperrt</Badge>
                  )}
                </Td>
                <Td>
                  <span className="text-xs text-ink-600">
                    {member.lastLoginAt ? formatRelative(member.lastLoginAt) : "Noch nie"}
                  </span>
                </Td>
                {canManage ? (
                  <Td align="right">
                    {member.userId !== currentUserId ? (
                      <span className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateMember(member, { status: member.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED" })}
                        >
                          {member.status === "SUSPENDED" ? "Entsperren" : "Sperren"}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setRemoving(member)} aria-label="Entfernen">
                          <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                        </Button>
                      </span>
                    ) : (
                      <span className="text-2xs text-ink-400">Das bist du</span>
                    )}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </Card>

      {canManage && invitations.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader title={`Offene Einladungen (${invitations.length})`} />
          <ul className="divide-y divide-ink-100">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink-900">{invitation.email}</p>
                  <p className="text-2xs text-ink-500">
                    {ROLE_LABELS[invitation.role]} ·{" "}
                    {invitation.expired ? "abgelaufen" : `gültig bis ${formatDate(invitation.expiresAt)}`}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => revokeInvitation(invitation)}>
                  Zurückziehen
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          title={`Teams (${teams.length})`}
          action={
            canManage ? (
              <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreatingTeam(true)}>
                Team anlegen
              </Button>
            ) : null
          }
        />
        {teams.length === 0 ? (
          <EmptyState
            title="Noch keine Teams"
            description="Teams bündeln Mitglieder – etwa nach Region oder Produktlinie – und lassen sich später hierarchisch verschachteln."
            compact
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {teams.map((team) => (
              <li key={team.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-xs font-medium text-ink-900">{team.name}</p>
                  <p className="text-2xs text-ink-500">
                    {team.memberCount} Mitglied(er)
                    {team.parentTeam ? ` · übergeordnet: ${team.parentTeam.name}` : ""}
                  </p>
                </div>
                {canManage ? (
                  <Button variant="ghost" size="icon" onClick={() => deleteTeam(team)} aria-label="Team löschen">
                    <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <InviteModal
        open={inviting}
        onClose={() => setInviting(false)}
        assignableRoles={assignableRoles}
        onInvited={(url) => {
          setInviting(false);
          setInviteLink(url);
          router.refresh();
        }}
      />

      <Modal
        open={inviteLink !== null}
        onClose={() => setInviteLink(null)}
        title="Einladung erstellt"
        description="E-Mail-Versand benötigt eine verbundene Integration – bis dahin teilst du den Link direkt."
        size="sm"
        footer={<Button variant="primary" onClick={() => setInviteLink(null)}>Fertig</Button>}
      >
        <div className="space-y-2">
          <Input readOnly value={inviteLink ?? ""} onFocus={(event) => event.currentTarget.select()} />
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(inviteLink ?? "");
                toast.success("Link kopiert.");
              } catch {
                toast.error("Kopieren nicht möglich", "Bitte den Link manuell markieren.");
              }
            }}
          >
            Link kopieren
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={removeMember}
        title="Mitglied entfernen?"
        description={`${removing?.name ?? ""} verliert den Zugriff auf diese Organisation. Zugeordnete Datensätze bleiben erhalten.`}
        confirmLabel="Entfernen"
      />

      <TeamModal open={creatingTeam} onClose={() => setCreatingTeam(false)} teams={teams} onCreated={() => {
        setCreatingTeam(false);
        router.refresh();
      }} />
    </div>
  );
}

function InviteModal({
  open,
  onClose,
  assignableRoles,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  assignableRoles: Role[];
  onInvited: (url: string) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>(assignableRoles.includes("SALES") ? "SALES" : assignableRoles[0]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await api.post<{ inviteUrl: string }>("/api/v1/users", { email, role });
      setEmail("");
      onInvited(result.inviteUrl);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die Einladung konnte nicht erstellt werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mitglied einladen"
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Abbrechen
          </Button>
          <Button variant="primary" loading={pending} disabled={!email} onClick={submit}>
            Einladung erstellen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="E-Mail-Adresse" htmlFor="invite-email" required>
          <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus />
        </Field>
        <Field label="Rolle" htmlFor="invite-role">
          <Select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {assignableRoles.map((item) => (
              <option key={item} value={item}>
                {ROLE_LABELS[item]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function TeamModal({
  open,
  onClose,
  teams,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  teams: Team[];
  onCreated: () => void;
}) {
  const [name, setName] = React.useState("");
  const [parentTeamId, setParentTeamId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api.post("/api/v1/teams", { name, parentTeamId: parentTeamId || null });
      setName("");
      setParentTeamId("");
      onCreated();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Das Team konnte nicht angelegt werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Team anlegen"
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Abbrechen
          </Button>
          <Button variant="primary" loading={pending} disabled={!name} onClick={submit}>
            Team anlegen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Name" htmlFor="team-name" required>
          <Input id="team-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        {teams.length > 0 ? (
          <Field label="Übergeordnetes Team" htmlFor="team-parent">
            <Select id="team-parent" value={parentTeamId} onChange={(event) => setParentTeamId(event.target.value)}>
              <option value="">— keines —</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { roleMatrix } from "@/server/services/users";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, PERMISSIONS } from "@/lib/rbac";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { DataTable, Td, Th, Tr } from "@/components/ui/table";
import { Check, Minus } from "lucide-react";

export const metadata: Metadata = { title: "Rollen & Rechte" };
export const dynamic = "force-dynamic";

/**
 * The permission matrix is generated from the RBAC catalogue, so this screen
 * always reflects what the server actually enforces.
 */
export default async function RolesPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "users.read")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Für die Rollenübersicht fehlt dir die Berechtigung." />
      </Card>
    );
  }

  const matrix = roleMatrix();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rollen & Rechte"
        description="Welche Rolle welche Aktionen ausführen darf. Die Prüfung erfolgt serverseitig bei jedem Aufruf."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {matrix.map((entry) => (
          <Card key={entry.role}>
            <CardBody className="p-4">
              <p className="text-sm font-semibold text-ink-900">{ROLE_LABELS[entry.role]}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">{ROLE_DESCRIPTIONS[entry.role]}</p>
              <p className="mt-2 text-2xs text-ink-400">{entry.permissions.length} Berechtigungen</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Berechtigungsmatrix" description="Generiert aus dem Berechtigungskatalog der Anwendung." />
        <DataTable>
          <thead>
            <tr>
              <Th>Berechtigung</Th>
              {matrix.map((entry) => (
                <Th key={entry.role} align="center">
                  {ROLE_LABELS[entry.role]}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((permission) => (
              <Tr key={permission}>
                <Td>
                  <code className="font-mono text-xs text-ink-700">{permission}</code>
                </Td>
                {matrix.map((entry) => (
                  <Td key={entry.role} align="center">
                    {entry.permissions.includes(permission) ? (
                      <Check className="mx-auto h-3.5 w-3.5 text-success-500" aria-label="erlaubt" />
                    ) : (
                      <Minus className="mx-auto h-3.5 w-3.5 text-ink-300" aria-label="nicht erlaubt" />
                    )}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </div>
  );
}

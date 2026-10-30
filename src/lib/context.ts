import type { Role } from "@/generated/prisma/enums";
import { Forbidden } from "./api/errors";
import { permissionsForRole, type Permission } from "./rbac";

/**
 * The authenticated actor for one request. Framework-free on purpose: every
 * service takes this object, which makes tenant scoping and permission checks
 * testable without an HTTP layer.
 */
export type ActorContext = {
  organizationId: string;
  organizationName: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
  sessionId?: string;
  ip?: string;
  userAgent?: string;
  /**
   * Gesetzt, wenn die Anfrage nicht aus der Oberfläche kommt, sondern über
   * eine Integrationsschnittstelle — z. B. „mailwin“. Landet im Audit-Log und
   * in der Zeitleiste und verhindert, dass eine Änderung als Webhook an genau
   * das System zurückgeht, das sie ausgelöst hat.
   */
  origin?: "mailwin";
  /** Der Zugang (z. B. API-Schlüssel), über den die Integration angefragt hat. */
  credentialId?: string;
};

export function can(ctx: ActorContext, permission: Permission): boolean {
  return ctx.permissions.includes(permission);
}

/** Throws a 403 unless the actor holds the permission. Use in every service. */
export function assertPermission(ctx: ActorContext, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw Forbidden(`Für diese Aktion fehlt die Berechtigung "${permission}".`);
  }
}

/** Builds a context for a known membership — used by the session layer and tests. */
export function buildContext(input: {
  organizationId: string;
  organizationName: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}): ActorContext {
  return { ...input, permissions: permissionsForRole(input.role) };
}

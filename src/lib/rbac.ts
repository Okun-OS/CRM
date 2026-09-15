import { Role } from "@/generated/prisma/enums";

/**
 * Permission catalogue. Permissions are checked on the server for every
 * mutating and reading API call — the UI only hides what the server already
 * refuses.
 */
export const PERMISSIONS = [
  "contacts.read",
  "contacts.write",
  "contacts.delete",
  "companies.read",
  "companies.write",
  "companies.delete",
  "leads.read",
  "leads.write",
  "leads.delete",
  "deals.read",
  "deals.write",
  "deals.delete",
  "activities.read",
  "activities.write",
  "tasks.read",
  "tasks.write",
  "notes.read",
  "notes.write",
  "meetings.read",
  "meetings.write",
  "files.read",
  "files.write",
  "files.delete",
  "emails.read",
  "emails.send",
  "templates.read",
  "templates.write",
  "views.read",
  "views.write",
  "reports.read",
  "imports.run",
  "exports.run",
  "workflows.read",
  "workflows.manage",
  "webhooks.manage",
  "properties.manage",
  "pipelines.manage",
  "settings.manage",
  "users.read",
  "users.manage",
  "audit.read",
  "organization.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = [
  "contacts.read",
  "companies.read",
  "leads.read",
  "deals.read",
  "activities.read",
  "tasks.read",
  "notes.read",
  "meetings.read",
  "files.read",
  "emails.read",
  "templates.read",
  "views.read",
  "users.read",
];

const SALES: Permission[] = [
  ...READ_ONLY,
  "contacts.write",
  "companies.write",
  "leads.write",
  "deals.write",
  "activities.write",
  "tasks.write",
  "notes.write",
  "meetings.write",
  "files.write",
  "emails.send",
  "views.write",
  "reports.read",
  "exports.run",
  "workflows.read",
];

const MANAGER: Permission[] = [
  ...SALES,
  "contacts.delete",
  "companies.delete",
  "leads.delete",
  "deals.delete",
  "files.delete",
  "templates.write",
  "imports.run",
  "workflows.manage",
  "pipelines.manage",
  "properties.manage",
  "audit.read",
];

const ADMIN: Permission[] = [
  ...MANAGER,
  "settings.manage",
  "users.manage",
  "webhooks.manage",
  "organization.manage",
];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN,
  MANAGER,
  SALES,
  USER: READ_ONLY,
};

/** Every permission granted to a role, de-duplicated. */
export function permissionsForRole(role: Role): Permission[] {
  return Array.from(new Set(ROLE_PERMISSIONS[role]));
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super-Administrator",
  ADMIN: "Administrator",
  MANAGER: "Manager",
  SALES: "Vertrieb",
  USER: "Benutzer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN: "Vollzugriff inklusive Organisationsverwaltung und Übertragung der Inhaberschaft.",
  ADMIN: "Verwaltet Benutzer, Einstellungen, Integrationen und alle CRM-Daten.",
  MANAGER: "Verwaltet CRM-Strukturen, Importe und Automatisierungen, darf Datensätze löschen.",
  SALES: "Arbeitet mit Kontakten, Unternehmen, Leads, Deals und Aktivitäten.",
  USER: "Lesender Zugriff auf CRM-Daten.",
};

/** Roles a member with `actorRole` is allowed to assign. */
export function assignableRoles(actorRole: Role): Role[] {
  switch (actorRole) {
    case "SUPER_ADMIN":
      return ["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES", "USER"];
    case "ADMIN":
      return ["ADMIN", "MANAGER", "SALES", "USER"];
    default:
      return [];
  }
}

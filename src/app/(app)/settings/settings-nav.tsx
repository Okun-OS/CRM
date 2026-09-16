"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building,
  FileSearch,
  GitMerge,
  KeyRound,
  ListTree,
  Plug,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  UserCircle,
  Users,
  Webhook,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Permission } from "@/lib/rbac";

const SECTIONS: { label: string; items: { href: string; label: string; icon: React.ReactNode; permission?: Permission }[] }[] = [
  {
    label: "Konto",
    items: [{ href: "/settings/profile", label: "Profil & Sicherheit", icon: <UserCircle className="h-4 w-4" /> }],
  },
  {
    label: "Organisation",
    items: [
      { href: "/settings/organization", label: "Unternehmen", icon: <Building className="h-4 w-4" />, permission: "organization.manage" },
      { href: "/settings/users", label: "Benutzer & Teams", icon: <Users className="h-4 w-4" />, permission: "users.read" },
      { href: "/settings/roles", label: "Rollen & Rechte", icon: <KeyRound className="h-4 w-4" />, permission: "users.read" },
    ],
  },
  {
    label: "CRM-Konfiguration",
    items: [
      { href: "/settings/properties", label: "Eigenschaften", icon: <SlidersHorizontal className="h-4 w-4" />, permission: "properties.manage" },
      { href: "/settings/pipelines", label: "Pipelines", icon: <ListTree className="h-4 w-4" />, permission: "pipelines.manage" },
      { href: "/settings/crm-options", label: "Status & Tags", icon: <ListTree className="h-4 w-4" />, permission: "settings.manage" },
    ],
  },
  {
    label: "Daten",
    items: [
      { href: "/settings/import", label: "Import", icon: <Upload className="h-4 w-4" />, permission: "imports.run" },
      { href: "/settings/duplicates", label: "Duplikate", icon: <GitMerge className="h-4 w-4" />, permission: "contacts.write" },
      { href: "/settings/privacy", label: "Datenschutz", icon: <ShieldCheck className="h-4 w-4" />, permission: "settings.manage" },
    ],
  },
  {
    label: "Erweiterungen",
    items: [
      { href: "/settings/integrations", label: "Integrationen", icon: <Plug className="h-4 w-4" />, permission: "settings.manage" },
      { href: "/settings/webhooks", label: "Webhooks", icon: <Webhook className="h-4 w-4" />, permission: "webhooks.manage" },
    ],
  },
  {
    label: "Protokoll",
    items: [
      { href: "/settings/audit", label: "Audit Log", icon: <ScrollText className="h-4 w-4" />, permission: "audit.read" },
      { href: "/settings/system", label: "System", icon: <FileSearch className="h-4 w-4" />, permission: "settings.manage" },
    ],
  },
];

export function SettingsNav({ permissions }: { permissions: Permission[] }) {
  const pathname = usePathname();
  const allowed = new Set(permissions);

  return (
    <nav className="lg:sticky lg:top-20 lg:self-start" aria-label="Einstellungen">
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:block lg:space-y-4 lg:overflow-visible lg:pb-0">
        {SECTIONS.map((section) => {
          const items = section.items.filter((item) => !item.permission || allowed.has(item.permission));
          if (items.length === 0) return null;

          return (
            <li key={section.label}>
              <p className="hidden px-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-400 lg:block">
                {section.label}
              </p>
              <ul className="flex gap-1 lg:block lg:space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm transition-colors",
                          active ? "bg-brand-50 font-medium text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                        )}
                      >
                        <span className={active ? "text-brand-500" : "text-ink-400"}>{item.icon}</span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

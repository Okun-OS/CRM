"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronLeft,
  FileText,
  Gauge,
  KanbanSquare,
  ListChecks,
  Mail,
  Settings,
  Sparkles,
  Target,
  Users,
  Workflow,
  Activity as ActivityIcon,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { OkunCrmLogo, OkunCrmIcon, PoweredByOkunSoftware } from "@/components/brand/marks";
import type { Permission } from "@/lib/rbac";

/**
 * Primary navigation on the dark OKUN brand surface. Sections mirror how a
 * sales team works: overview → records → selling → communication → automation →
 * insight → administration.
 */
type NavItem = { href: string; label: string; icon: React.ReactNode; permission?: Permission };
type NavSection = { label?: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/heute", label: "Heute", icon: <Zap className="h-4 w-4" /> },
      { href: "/dashboard", label: "Dashboard", icon: <Gauge className="h-4 w-4" /> },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/contacts", label: "Kontakte", icon: <Users className="h-4 w-4" />, permission: "contacts.read" },
      { href: "/companies", label: "Unternehmen", icon: <Building2 className="h-4 w-4" />, permission: "companies.read" },
      { href: "/leads", label: "Leads", icon: <Sparkles className="h-4 w-4" />, permission: "leads.read" },
      { href: "/deals", label: "Deals", icon: <Target className="h-4 w-4" />, permission: "deals.read" },
    ],
  },
  {
    label: "Vertrieb",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: <KanbanSquare className="h-4 w-4" />, permission: "deals.read" },
      { href: "/activities", label: "Aktivitäten", icon: <ActivityIcon className="h-4 w-4" />, permission: "activities.read" },
      { href: "/tasks", label: "Aufgaben", icon: <ListChecks className="h-4 w-4" />, permission: "tasks.read" },
      { href: "/calendar", label: "Kalender", icon: <CalendarDays className="h-4 w-4" />, permission: "meetings.read" },
    ],
  },
  {
    label: "Kommunikation",
    items: [
      { href: "/emails", label: "E-Mails", icon: <Mail className="h-4 w-4" />, permission: "emails.read" },
      { href: "/templates", label: "Vorlagen", icon: <FileText className="h-4 w-4" />, permission: "templates.read" },
    ],
  },
  {
    label: "Automatisierung",
    items: [{ href: "/workflows", label: "Workflows", icon: <Workflow className="h-4 w-4" />, permission: "workflows.read" }],
  },
  {
    label: "Berichte",
    items: [{ href: "/reports", label: "Reports", icon: <BarChart3 className="h-4 w-4" />, permission: "reports.read" }],
  },
  {
    label: "Administration",
    items: [{ href: "/settings", label: "Einstellungen", icon: <Settings className="h-4 w-4" /> }],
  },
];

export function Sidebar({
  permissions,
  collapsed,
  onToggle,
  onNavigate,
}: {
  permissions: Permission[];
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const allowed = React.useMemo(() => new Set(permissions), [permissions]);

  return (
    <nav
      className={cn(
        "okun-surface-dark flex h-full flex-col border-r border-white/5 text-white transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-60",
      )}
      aria-label="Hauptnavigation"
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b border-white/5", collapsed ? "justify-center px-2" : "px-4")}>
        <Link href="/dashboard" onClick={onNavigate} className="flex min-w-0 items-center">
          {collapsed ? <OkunCrmIcon className="h-8 w-8" /> : <OkunCrmLogo tone="inverse" className="h-9" />}
        </Link>
      </div>

      <div className="okun-scrollbar-none flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section, index) => {
          const items = section.items.filter((item) => !item.permission || allowed.has(item.permission));
          if (items.length === 0) return null;

          return (
            <div key={section.label ?? index} className={cn(index > 0 && "mt-4")}>
              {section.label && !collapsed ? (
                <p className="px-2.5 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-white/35">
                  {section.label}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        data-tour={`nav${item.href.replace(/\//g, "-")}`}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                          collapsed && "justify-center px-0",
                          active
                            ? "bg-white/10 text-white"
                            : "text-white/60 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        <span className={cn("shrink-0", active ? "text-accent-400" : "text-white/50 group-hover:text-white/80")}>
                          {item.icon}
                        </span>
                        {collapsed ? null : <span className="truncate">{item.label}</span>}
                        {active ? (
                          <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-gradient-to-b from-accent-400 to-brand-500" />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-white/5 px-3 py-3">
        {collapsed ? (
          <div className="flex justify-center">
            <OkunCrmIcon className="h-5 w-5 opacity-60" />
          </div>
        ) : (
          <PoweredByOkunSoftware tone="inverse" />
        )}
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "mt-3 hidden w-full items-center gap-2 rounded-md px-2 py-1.5 text-2xs text-white/40 transition-colors hover:bg-white/5 hover:text-white/70 lg:flex",
            collapsed && "justify-center",
          )}
          aria-label={collapsed ? "Navigation ausklappen" : "Navigation einklappen"}
        >
          <ChevronLeft className={cn("h-3.5 w-3.5 transition-transform", collapsed && "rotate-180")} />
          {collapsed ? null : "Einklappen"}
        </button>
      </div>
    </nav>
  );
}

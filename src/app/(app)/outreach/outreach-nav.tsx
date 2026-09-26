"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutGrid, ListChecks, Settings2, Target, Workflow } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Permission } from "@/lib/rbac";

/**
 * Navigation innerhalb der Akquise.
 *
 * Bewusst dasselbe Muster wie in den Einstellungen: waagerecht auf schmalen
 * Schirmen, senkrecht und mitlaufend auf breiten. Outreach soll sich nicht
 * wie eine zweite Anwendung anfühlen.
 */
const ITEMS: { href: string; label: string; icon: React.ReactNode; permission?: Permission }[] = [
  { href: "/outreach", label: "Überblick", icon: <LayoutGrid className="h-4 w-4" /> },
  { href: "/outreach/prospects", label: "Prospects", icon: <Target className="h-4 w-4" />, permission: "prospects.read" },
  { href: "/outreach/lists", label: "Listen", icon: <ListChecks className="h-4 w-4" />, permission: "prospects.read" },
  { href: "/outreach/sequences", label: "Sequenzen", icon: <Workflow className="h-4 w-4" />, permission: "outreach.sequences.read" },
  { href: "/outreach/inbox", label: "Antworten", icon: <Inbox className="h-4 w-4" />, permission: "outreach.replies" },
  { href: "/outreach/settings", label: "Versand", icon: <Settings2 className="h-4 w-4" />, permission: "outreach.settings" },
];

export function OutreachNav({ permissions }: { permissions: Permission[] }) {
  const pathname = usePathname();
  const allowed = new Set(permissions);
  const items = ITEMS.filter((item) => !item.permission || allowed.has(item.permission));

  return (
    <nav aria-label="Akquise">
      <ul className="flex gap-1 overflow-x-auto border-b border-ink-200 pb-0">
        {items.map((item) => {
          const active = item.href === "/outreach" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                data-tour={`outreach-${item.href.split("/").pop()}`}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-brand-500 font-medium text-ink-900"
                    : "border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800",
                )}
              >
                <span className={active ? "text-brand-600" : "text-ink-400"}>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ReferenceProvider } from "./reference-provider";
import type { Permission } from "@/lib/rbac";
import type { Role } from "@/generated/prisma/enums";

const COLLAPSE_KEY = "okun.nav.collapsed";

/**
 * Application frame: dark navigation, light working surface. The sidebar
 * collapses on desktop and becomes an overlay on smaller screens.
 */
export function AppShell({
  user,
  organizationName,
  role,
  permissions,
  children,
}: {
  user: { name: string; email: string };
  organizationName: string;
  role: Role;
  permissions: Permission[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* private mode or blocked storage — the default is fine */
    }
  }, []);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggle = React.useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <ReferenceProvider>
      <div className="flex h-dvh overflow-hidden bg-[color:var(--surface-page)]">
        <div className="hidden lg:block">
          <Sidebar permissions={permissions} collapsed={collapsed} onToggle={toggle} />
        </div>

        {mobileOpen ? (
          <div className="fixed inset-0 z-[60] flex lg:hidden">
            <div className="animate-okun-fade" onClick={() => setMobileOpen(false)}>
              <div className="absolute inset-0 bg-okun-950/50" />
            </div>
            <div className="relative">
              <Sidebar
                permissions={permissions}
                collapsed={false}
                onToggle={toggle}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            user={user}
            organizationName={organizationName}
            role={role}
            permissions={permissions}
            onOpenNav={() => setMobileOpen(true)}
          />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[100rem] px-4 py-5 lg:px-6 lg:py-6">{children}</div>
          </main>
        </div>
      </div>
    </ReferenceProvider>
  );
}

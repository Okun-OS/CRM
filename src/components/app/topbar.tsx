"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Menu, Settings, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, Dropdown, DropdownItem } from "@/components/ui/misc";
import { CommandPalette } from "./command-palette";
import { NotificationsMenu } from "./notifications-menu";
import { QuickCreate } from "./quick-create";
import { api } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Permission } from "@/lib/rbac";
import type { Role } from "@/generated/prisma/enums";

export function Topbar({
  user,
  organizationName,
  role,
  permissions,
  onOpenNav,
}: {
  user: { name: string; email: string };
  organizationName: string;
  role: Role;
  permissions: Permission[];
  onOpenNav: () => void;
}) {
  const router = useRouter();

  async function logout() {
    await api.post("/api/v1/auth/logout").catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-ink-200 bg-white/90 px-3 backdrop-blur lg:px-5">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenNav} aria-label="Navigation öffnen">
        <Menu className="h-4 w-4" />
      </Button>

      <div className="hidden min-w-0 flex-1 md:block">
        <CommandPalette />
      </div>
      <div className="flex-1 md:hidden" />

      <div className="flex items-center gap-1.5">
        <QuickCreate permissions={permissions} />
        <NotificationsMenu />

        <Dropdown
          trigger={
            <button
              type="button"
              className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-ink-100"
              aria-label="Benutzermenü"
            >
              <Avatar name={user.name} size="sm" />
            </button>
          }
        >
          {() => (
            <>
              <div className="border-b border-ink-200 px-2.5 py-2">
                <p className="truncate text-sm font-medium text-ink-900">{user.name}</p>
                <p className="truncate text-2xs text-ink-500">{user.email}</p>
                <p className="mt-1 text-2xs text-ink-400">
                  {organizationName} · {ROLE_LABELS[role]}
                </p>
              </div>
              <div className="py-1">
                <Link href="/settings/profile">
                  <DropdownItem icon={<UserIcon className="h-4 w-4" />}>Profil</DropdownItem>
                </Link>
                <Link href="/settings">
                  <DropdownItem icon={<Settings className="h-4 w-4" />}>Einstellungen</DropdownItem>
                </Link>
              </div>
              <div className="border-t border-ink-200 pt-1">
                <DropdownItem icon={<LogOut className="h-4 w-4" />} onClick={logout}>
                  Abmelden
                </DropdownItem>
              </div>
            </>
          )}
        </Dropdown>
      </div>
    </header>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function signOut() {
    setPending(true);
    await api.post("/api/v1/auth/logout").catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-white/80 transition-colors hover:bg-white/5 disabled:opacity-60"
    >
      <LogOut className="h-3.5 w-3.5" />
      Abmelden
    </button>
  );
}

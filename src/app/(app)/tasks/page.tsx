import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { TasksView } from "./tasks-view";

export const metadata: Metadata = { title: "Aufgaben" };
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader title="Aufgaben" description="Was als Nächstes zu tun ist – für dich und dein Team." />
      <TasksView canWrite={can(actor, "tasks.write")} />
    </div>
  );
}

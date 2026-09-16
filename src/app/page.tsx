import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";

export default async function RootPage() {
  const actor = await getActor();
  redirect(actor ? "/dashboard" : "/login");
}

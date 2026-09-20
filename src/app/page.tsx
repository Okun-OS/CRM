import { redirect } from "next/navigation";
import { getActor, getPlatformActor } from "@/lib/auth/session";

export default async function RootPage() {
  const actor = await getActor();
  if (actor) redirect("/dashboard");
  redirect((await getPlatformActor()) ? "/admin" : "/login");
}

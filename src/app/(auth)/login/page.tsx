import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage() {
  if (await getActor()) redirect("/dashboard");

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Willkommen zurück</h2>
      <p className="mt-1.5 text-sm text-ink-500">Melde dich an, um mit deinem Vertrieb weiterzuarbeiten.</p>
      <div className="mt-8">
        <LoginForm />
      </div>
      <p className="mt-8 text-sm text-ink-500">
        Noch kein Konto?{" "}
        <Link href="/register" className="font-medium text-brand-600 hover:text-brand-700">
          Organisation registrieren
        </Link>
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Organisation registrieren" };

export default async function RegisterPage() {
  if (await getActor()) redirect("/dashboard");

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Organisation einrichten</h2>
      <p className="mt-1.5 text-sm text-ink-500">
        Lege deine Organisation an. Pipeline, Lifecycle Stages und Lead-Status werden direkt mit eingerichtet.
      </p>
      <div className="mt-8">
        <RegisterForm />
      </div>
      <p className="mt-8 text-sm text-ink-500">
        Bereits registriert?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
          Zur Anmeldung
        </Link>
      </p>
    </div>
  );
}

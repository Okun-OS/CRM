"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-client";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    try {
      const result = await api.post<{ redirectTo?: string }>("/api/v1/auth/login", {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      // Der Server entscheidet das Ziel: Betreiber haben keine Mitgliedschaft
      // und damit kein Dashboard.
      router.replace(result?.redirectTo ?? "/dashboard");
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else {
        setError("Die Anmeldung ist fehlgeschlagen.");
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <div role="alert" className="rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </div>
      ) : null}

      <Field label="E-Mail-Adresse" htmlFor="email" error={fieldErrors.email} required>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus placeholder="name@unternehmen.de" />
      </Field>

      <Field label="Passwort" htmlFor="password" error={fieldErrors.password} required>
        <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••••••" />
      </Field>

      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Anmelden
      </Button>
    </form>
  );
}

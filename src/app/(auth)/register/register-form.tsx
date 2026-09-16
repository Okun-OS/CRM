"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-client";

export function RegisterForm() {
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
      await api.post("/api/v1/auth/register", {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        organizationName: String(form.get("organizationName") ?? ""),
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fields);
      } else {
        setError("Die Registrierung ist fehlgeschlagen.");
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

      <Field label="Organisation" htmlFor="organizationName" error={fieldErrors.organizationName} required>
        <Input id="organizationName" name="organizationName" required autoFocus placeholder="Muster GmbH" />
      </Field>

      <Field label="Dein Name" htmlFor="name" error={fieldErrors.name} required>
        <Input id="name" name="name" required autoComplete="name" placeholder="Anna Weber" />
      </Field>

      <Field label="E-Mail-Adresse" htmlFor="email" error={fieldErrors.email} required>
        <Input id="email" name="email" type="email" required autoComplete="email" placeholder="name@unternehmen.de" />
      </Field>

      <Field
        label="Passwort"
        htmlFor="password"
        error={fieldErrors.password}
        hint="Mindestens 12 Zeichen, mit Groß- und Kleinbuchstaben sowie einer Ziffer."
        required
      >
        <Input id="password" name="password" type="password" required autoComplete="new-password" />
      </Field>

      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        Organisation anlegen
      </Button>
    </form>
  );
}

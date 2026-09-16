"use client";

import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

/**
 * Shared submit handling for record forms: pending state, API field errors and
 * toast feedback, so every form in the product behaves identically.
 */
export function useRecordForm<T>({
  submit,
  onSuccess,
  successMessage,
}: {
  submit: () => Promise<T>;
  onSuccess?: (result: T) => void;
  successMessage: string;
}) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      setPending(true);
      setFormError(null);
      setFieldErrors({});
      try {
        const result = await submit();
        toast.success(successMessage);
        onSuccess?.(result);
        return result;
      } catch (cause) {
        if (cause instanceof ApiError) {
          setFormError(cause.message);
          setFieldErrors(cause.fields);
          if (Object.keys(cause.fields).length === 0) toast.error(cause.message);
        } else {
          setFormError("Es ist ein unerwarteter Fehler aufgetreten.");
          toast.error("Es ist ein unerwarteter Fehler aufgetreten.");
        }
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [submit, onSuccess, successMessage, toast],
  );

  return { pending, formError, fieldErrors, handleSubmit };
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
      {message}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">{title}</p>
        {description ? <p className="mt-0.5 text-xs text-ink-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Strips empty strings so optional fields are omitted rather than blanked. */
export function cleanPayload<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === "" || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

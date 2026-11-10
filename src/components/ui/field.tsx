import * as React from "react";
import { cn } from "@/lib/cn";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/local-datetime";

/** Form field wrapper: label, optional hint, inline validation message. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-xs font-medium text-ink-700">
          {label}
          {required ? <span className="ml-0.5 text-danger-600">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  "w-full rounded-md border bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 transition-colors " +
  "border-ink-200 hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 " +
  "disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500 aria-[invalid=true]:border-danger-500";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL_BASE, "h-9", className)} {...props} />;
  },
);

/**
 * Datum + Uhrzeit. Nimmt einen ISO-Zeitpunkt entgegen und gibt einen zurück;
 * angezeigt und eingegeben wird in Ortszeit (siehe `lib/local-datetime`).
 */
export function DateTimeInput({
  value,
  onChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
}) {
  return (
    <Input
      type="datetime-local"
      value={toLocalInputValue(value)}
      onChange={(event) => onChange(fromLocalInputValue(event.target.value))}
      {...props}
    />
  );
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(CONTROL_BASE, "py-2 leading-relaxed", className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          CONTROL_BASE,
          "okun-select h-9 cursor-pointer appearance-none pr-9 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded border-ink-300 text-brand-500 transition-colors",
        "focus:ring-2 focus:ring-brand-500/25 focus:ring-offset-0",
        className,
      )}
      {...props}
    />
  );
}

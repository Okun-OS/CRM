"use client";

import * as React from "react";
import type { PropertyDefinitionDTO } from "@/lib/properties";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";

/**
 * Renders the organization's custom properties as real form controls, typed by
 * the property definition. The same component is used in create drawers and on
 * detail pages, so a new property appears everywhere at once.
 */
export function PropertyFields({
  definitions,
  values,
  onChange,
  errors,
}: {
  definitions: PropertyDefinitionDTO[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
}) {
  if (definitions.length === 0) return null;

  const groups = new Map<string, PropertyDefinitionDTO[]>();
  for (const definition of definitions) {
    const group = definition.groupName ?? "Eigenschaften";
    groups.set(group, [...(groups.get(group) ?? []), definition]);
  }

  return (
    <div className="space-y-5">
      {Array.from(groups.entries()).map(([group, items]) => (
        <div key={group} className="space-y-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">{group}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((definition) => (
              <PropertyField
                key={definition.id}
                definition={definition}
                value={values[definition.key]}
                error={errors?.[`properties.${definition.key}`]}
                onChange={(value) => onChange(definition.key, value)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PropertyField({
  definition,
  value,
  onChange,
  error,
}: {
  definition: PropertyDefinitionDTO;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}) {
  const id = `property-${definition.key}`;
  const common = { id, "aria-invalid": Boolean(error) };

  return (
    <Field
      label={definition.label}
      htmlFor={id}
      hint={definition.description ?? undefined}
      error={error}
      required={definition.isRequired}
      className={definition.type === "TEXTAREA" || definition.type === "MULTISELECT" ? "sm:col-span-2" : undefined}
    >
      {definition.type === "TEXTAREA" ? (
        <Textarea {...common} rows={3} value={asString(value)} onChange={(event) => onChange(event.target.value)} />
      ) : definition.type === "BOOLEAN" ? (
        <label className="flex h-9 items-center gap-2 text-sm text-ink-700">
          <Checkbox {...common} checked={value === true} onChange={(event) => onChange(event.target.checked)} />
          Ja
        </label>
      ) : definition.type === "SELECT" ? (
        <Select {...common} value={asString(value)} onChange={(event) => onChange(event.target.value || null)}>
          <option value="">— nicht gesetzt —</option>
          {definition.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : definition.type === "MULTISELECT" ? (
        <div className="flex flex-wrap gap-2 rounded-md border border-ink-200 bg-white p-2">
          {definition.options.map((option) => {
            const selected = Array.isArray(value) && (value as string[]).includes(option.value);
            return (
              <label
                key={option.value}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-ink-200 px-2 py-1 text-xs text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <Checkbox
                  checked={selected}
                  onChange={(event) => {
                    const current = Array.isArray(value) ? [...(value as string[])] : [];
                    onChange(
                      event.target.checked
                        ? [...current, option.value]
                        : current.filter((item) => item !== option.value),
                    );
                  }}
                />
                {option.label}
              </label>
            );
          })}
        </div>
      ) : (
        <Input
          {...common}
          type={inputType(definition.type)}
          step={definition.type === "CURRENCY" ? "0.01" : undefined}
          value={asString(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function inputType(type: PropertyDefinitionDTO["type"]): string {
  switch (type) {
    case "NUMBER":
    case "CURRENCY":
      return "number";
    case "DATE":
      return "date";
    case "DATETIME":
      return "datetime-local";
    case "EMAIL":
      return "email";
    case "URL":
      return "url";
    case "PHONE":
      return "tel";
    default:
      return "text";
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" && value.length >= 20 && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    // Date-time values arrive as ISO strings; the input needs a local value.
    return value.slice(0, 16);
  }
  return String(value);
}

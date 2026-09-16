"use client";

import * as React from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { fieldsFor, type CrmField } from "@/lib/crm/fields";
import { OPERATOR_LABELS, OPERATORS_BY_TYPE, type FilterCondition, type FilterGroup, type Operator } from "@/lib/filters";
import { useReference } from "@/components/app/reference-provider";

/**
 * Filter builder.
 *
 * The available fields come from the same registry the API validates against,
 * and the operator list is derived from the field's data type — so the UI can
 * never offer a filter the backend would reject. Custom properties appear
 * alongside built-in fields.
 */
export function FilterBuilder({
  objectType,
  value,
  onChange,
  onClose,
}: {
  objectType: CrmObjectType;
  value: FilterGroup;
  onChange: (filter: FilterGroup) => void;
  onClose?: () => void;
}) {
  const { data } = useReference();
  const customProperties = data?.properties[objectType] ?? [];

  const options = React.useMemo(() => {
    const builtIn = fieldsFor(objectType)
      .filter((field) => field.filterable !== false)
      .map((field) => ({ key: field.key, label: field.label, field }));
    const custom = customProperties.map((definition) => ({
      key: `property:${definition.key}`,
      label: `${definition.label} (Eigenschaft)`,
      field: {
        key: `property:${definition.key}`,
        label: definition.label,
        type: propertyFilterType(definition.type),
      } as CrmField,
    }));
    return [...builtIn, ...custom];
  }, [objectType, customProperties]);

  const update = (index: number, patch: Partial<FilterCondition>) => {
    const conditions = value.conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition));
    onChange({ ...value, conditions });
  };

  const remove = (index: number) => {
    onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) });
  };

  const add = () => {
    const first = options[0];
    if (!first) return;
    onChange({
      ...value,
      conditions: [...value.conditions, { field: first.key, operator: defaultOperator(first.field), value: "" }],
    });
  };

  return (
    <div className="w-[min(40rem,calc(100vw-2rem))] p-3">
      <div className="flex items-center justify-between pb-2">
        <p className="text-xs font-semibold text-ink-900">Filter</p>
        <div className="flex items-center gap-2">
          <Select
            value={value.combinator}
            onChange={(event) => onChange({ ...value, combinator: event.target.value as "AND" | "OR" })}
            className="h-7 w-auto text-xs"
            aria-label="Verknüpfung"
          >
            <option value="AND">Alle Bedingungen (UND)</option>
            <option value="OR">Beliebige Bedingung (ODER)</option>
          </Select>
          {onClose ? (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Filter schließen">
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {value.conditions.length === 0 ? (
        <p className="rounded-md bg-ink-50 px-3 py-4 text-center text-xs text-ink-500">
          Noch keine Bedingung. Füge eine hinzu, um die Liste einzugrenzen.
        </p>
      ) : (
        <ul className="space-y-2">
          {value.conditions.map((condition, index) => {
            const option = options.find((item) => item.key === condition.field) ?? options[0];
            const operators = OPERATORS_BY_TYPE[option.field.type];
            const needsValue = condition.operator !== "known" && condition.operator !== "unknown";

            return (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  value={condition.field}
                  onChange={(event) => {
                    const next = options.find((item) => item.key === event.target.value);
                    update(index, {
                      field: event.target.value,
                      operator: next ? defaultOperator(next.field) : condition.operator,
                      value: "",
                    });
                  }}
                  className="h-8 w-44 text-xs"
                  aria-label="Feld"
                >
                  {options.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </Select>

                <Select
                  value={condition.operator}
                  onChange={(event) => update(index, { operator: event.target.value as Operator })}
                  className="h-8 w-36 text-xs"
                  aria-label="Operator"
                >
                  {operators.map((operator) => (
                    <option key={operator} value={operator}>
                      {OPERATOR_LABELS[operator]}
                    </option>
                  ))}
                </Select>

                {needsValue ? (
                  <FilterValueInput
                    field={option.field}
                    objectType={objectType}
                    value={condition.value}
                    onChange={(next) => update(index, { value: next })}
                  />
                ) : null}

                <Button variant="ghost" size="icon" onClick={() => remove(index)} aria-label="Bedingung entfernen">
                  <Trash2 className="h-3.5 w-3.5 text-ink-400" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-ink-200 pt-3">
        <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={add}>
          Bedingung hinzufügen
        </Button>
        {value.conditions.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => onChange({ combinator: value.combinator, conditions: [] })}>
            Zurücksetzen
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FilterValueInput({
  field,
  objectType,
  value,
  onChange,
}: {
  field: CrmField;
  objectType: CrmObjectType;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { data } = useReference();
  const text = value === null || value === undefined ? "" : String(value);

  if (field.optionSource === "owner") {
    return (
      <Select value={text} onChange={(event) => onChange(event.target.value)} className="h-8 w-44 text-xs">
        <option value="">— auswählen —</option>
        {data?.members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
    );
  }

  if (field.optionSource === "lifecycleStage" || field.optionSource === "leadStatus") {
    const items = field.optionSource === "lifecycleStage" ? data?.lifecycleStages : data?.leadStatuses;
    return (
      <Select value={text} onChange={(event) => onChange(event.target.value)} className="h-8 w-44 text-xs">
        <option value="">— auswählen —</option>
        {items?.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </Select>
    );
  }

  if (field.optionSource === "stage") {
    return (
      <Select value={text} onChange={(event) => onChange(event.target.value)} className="h-8 w-44 text-xs">
        <option value="">— auswählen —</option>
        {data?.pipelines.flatMap((pipeline) =>
          pipeline.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {pipeline.name} · {stage.name}
            </option>
          )),
        )}
      </Select>
    );
  }

  if (field.optionSource === "pipeline") {
    return (
      <Select value={text} onChange={(event) => onChange(event.target.value)} className="h-8 w-44 text-xs">
        <option value="">— auswählen —</option>
        {data?.pipelines.map((pipeline) => (
          <option key={pipeline.id} value={pipeline.id}>
            {pipeline.name}
          </option>
        ))}
      </Select>
    );
  }

  if (field.optionSource === "dealStatus") {
    return (
      <Select value={text} onChange={(event) => onChange(event.target.value)} className="h-8 w-44 text-xs">
        <option value="OPEN">Offen</option>
        <option value="WON">Gewonnen</option>
        <option value="LOST">Verloren</option>
      </Select>
    );
  }

  if (field.type === "date" || field.type === "datetime") {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={/^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-36 text-xs"
        />
        <Select
          value={/^[+-]\d+[dwmy]$/.test(text) ? text : ""}
          onChange={(event) => event.target.value && onChange(event.target.value)}
          className="h-8 w-36 text-xs"
          aria-label="Relativer Zeitraum"
        >
          <option value="">Relativ…</option>
          <option value="-7d">vor 7 Tagen</option>
          <option value="-14d">vor 14 Tagen</option>
          <option value="-30d">vor 30 Tagen</option>
          <option value="-3m">vor 3 Monaten</option>
          <option value="+7d">in 7 Tagen</option>
          <option value="+30d">in 30 Tagen</option>
        </Select>
      </div>
    );
  }

  if (field.type === "number" || field.type === "currency") {
    return (
      <Input
        type="number"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-36 text-xs"
        placeholder="Wert"
      />
    );
  }

  return (
    <Input
      value={text}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-44 text-xs"
      placeholder="Wert"
      aria-label={`Wert für ${field.label} (${objectType})`}
    />
  );
}

function defaultOperator(field: CrmField): Operator {
  return OPERATORS_BY_TYPE[field.type][0];
}

function propertyFilterType(type: string) {
  switch (type) {
    case "NUMBER":
    case "CURRENCY":
      return "number" as const;
    case "DATE":
      return "date" as const;
    case "DATETIME":
      return "datetime" as const;
    case "BOOLEAN":
      return "boolean" as const;
    case "SELECT":
    case "MULTISELECT":
      return "enum" as const;
    default:
      return "string" as const;
  }
}

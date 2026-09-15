import { z } from "zod";
import { ValidationError } from "./api/errors";
import { columnForType, type PropertyDefinitionDTO } from "./properties";

/**
 * Filter engine.
 *
 * A saved view stores a FilterGroup tree; this module turns that tree into a
 * Prisma `where` clause. Operators are validated against the field's data type,
 * so a UI can offer exactly the operators the backend accepts.
 */
export const OPERATORS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "starts_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "before",
  "after",
  "in",
  "not_in",
  "known",
  "unknown",
] as const;

export type Operator = (typeof OPERATORS)[number];

export type FilterFieldType =
  | "string"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "boolean"
  | "enum"
  | "id";

export const OPERATORS_BY_TYPE: Record<FilterFieldType, Operator[]> = {
  string: ["eq", "neq", "contains", "not_contains", "starts_with", "known", "unknown"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "known", "unknown"],
  currency: ["eq", "neq", "gt", "gte", "lt", "lte", "known", "unknown"],
  date: ["eq", "before", "after", "known", "unknown"],
  datetime: ["eq", "before", "after", "known", "unknown"],
  boolean: ["eq"],
  enum: ["eq", "neq", "in", "not_in", "known", "unknown"],
  id: ["eq", "neq", "in", "not_in", "known", "unknown"],
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "ist",
  neq: "ist nicht",
  contains: "enthält",
  not_contains: "enthält nicht",
  starts_with: "beginnt mit",
  gt: "größer als",
  gte: "größer oder gleich",
  lt: "kleiner als",
  lte: "kleiner oder gleich",
  before: "vor",
  after: "nach",
  in: "ist eine von",
  not_in: "ist keine von",
  known: "ist bekannt",
  unknown: "ist unbekannt",
};

export const conditionSchema = z.object({
  field: z.string().min(1).max(80),
  operator: z.enum(OPERATORS),
  value: z.unknown().optional(),
});

export type FilterCondition = z.infer<typeof conditionSchema>;

export type FilterGroup = {
  combinator: "AND" | "OR";
  conditions: FilterCondition[];
  groups?: FilterGroup[];
};

export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    combinator: z.enum(["AND", "OR"]).default("AND"),
    conditions: z.array(conditionSchema).max(25).default([]),
    groups: z.array(filterGroupSchema).max(5).optional(),
  }),
);

export const EMPTY_FILTER: FilterGroup = { combinator: "AND", conditions: [] };

/**
 * Resolves relative date tokens used by saved views:
 * `now`, `today`, `-14d`, `+30d`, `-3m`. Falls back to Date parsing.
 */
export function resolveDateValue(input: unknown): Date {
  const raw = String(input ?? "").trim();
  const now = new Date();
  if (raw === "now") return now;
  if (raw === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const relative = /^([+-])(\d{1,4})([dwmy])$/.exec(raw);
  if (relative) {
    const sign = relative[1] === "-" ? -1 : 1;
    const amount = Number(relative[2]) * sign;
    const date = new Date(now);
    if (relative[3] === "d") date.setDate(date.getDate() + amount);
    if (relative[3] === "w") date.setDate(date.getDate() + amount * 7);
    if (relative[3] === "m") date.setMonth(date.getMonth() + amount);
    if (relative[3] === "y") date.setFullYear(date.getFullYear() + amount);
    return date;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw ValidationError(`"${raw}" ist kein gültiger Datumswert.`);
  }
  return parsed;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** Builds the leaf `where` fragment for one scalar field. */
function scalarClause(type: FilterFieldType, operator: Operator, value: unknown): unknown {
  if (!OPERATORS_BY_TYPE[type].includes(operator)) {
    throw ValidationError(`Operator "${operator}" ist für dieses Feld nicht zulässig.`);
  }

  switch (operator) {
    case "known":
      return type === "string" ? { not: null, notIn: [""] } : { not: null };
    case "unknown":
      return type === "string" ? { in: [null as unknown as string, ""] } : null;
    default:
      break;
  }

  if (type === "boolean") return { equals: value === true || value === "true" };

  if (type === "date" || type === "datetime") {
    const date = resolveDateValue(value);
    if (operator === "before") return { lt: date };
    if (operator === "after") return { gt: date };
    return { gte: startOfDay(date), lte: endOfDay(date) };
  }

  if (type === "number" || type === "currency") {
    const num = Number(value);
    if (!Number.isFinite(num)) throw ValidationError("Für diesen Filter wird eine Zahl benötigt.");
    switch (operator) {
      case "eq":
        return { equals: num };
      case "neq":
        return { not: num };
      case "gt":
        return { gt: num };
      case "gte":
        return { gte: num };
      case "lt":
        return { lt: num };
      case "lte":
        return { lte: num };
      default:
        throw ValidationError(`Operator "${operator}" ist für Zahlen nicht zulässig.`);
    }
  }

  // string / enum / id
  const text = value === null || value === undefined ? "" : String(value);
  switch (operator) {
    case "eq":
      return type === "string" ? { equals: text, mode: "insensitive" } : { equals: text };
    case "neq":
      return { not: text };
    case "contains":
      return { contains: text, mode: "insensitive" };
    case "not_contains":
      return { not: { contains: text, mode: "insensitive" } };
    case "starts_with":
      return { startsWith: text, mode: "insensitive" };
    case "in":
      return { in: Array.isArray(value) ? value.map(String) : [text] };
    case "not_in":
      return { notIn: Array.isArray(value) ? value.map(String) : [text] };
    default:
      throw ValidationError(`Operator "${operator}" ist für Textfelder nicht zulässig.`);
  }
}

/** Expands a dotted path ("company.name") into a nested where object. */
function nest(path: string, clause: unknown): Record<string, unknown> {
  const segments = path.split(".");
  return segments.reduceRight<Record<string, unknown>>(
    (acc, segment, index) => (index === segments.length - 1 ? { [segment]: clause } : { [segment]: acc }),
    {} as Record<string, unknown>,
  );
}

export type FilterFieldResolver = (field: string) =>
  | { kind: "scalar"; path: string; type: FilterFieldType }
  | { kind: "property"; definition: PropertyDefinitionDTO }
  | null;

/** Custom-property conditions filter through the typed PropertyValue relation. */
function propertyClause(definition: PropertyDefinitionDTO, operator: Operator, value: unknown): unknown {
  const column = columnForType(definition.type);

  if (operator === "unknown") {
    return { none: { definitionId: definition.id, NOT: { [column]: null } } };
  }
  if (operator === "known") {
    return { some: { definitionId: definition.id, NOT: { [column]: null } } };
  }

  if (column === "valueJson") {
    // MULTISELECT: membership test on the stored array.
    return { some: { definitionId: definition.id, valueJson: { array_contains: [String(value)] } } };
  }

  const type: FilterFieldType =
    column === "valueNumber"
      ? "number"
      : column === "valueDate"
        ? "datetime"
        : column === "valueBoolean"
          ? "boolean"
          : definition.type === "SELECT"
            ? "enum"
            : "string";

  return { some: { definitionId: definition.id, [column]: scalarClause(type, operator, value) } };
}

/**
 * Converts a validated FilterGroup into a Prisma `where` object.
 * Unknown fields are rejected — a filter never silently matches everything.
 */
export function buildWhere(group: FilterGroup, resolve: FilterFieldResolver): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];

  for (const condition of group.conditions ?? []) {
    const resolved = resolve(condition.field);
    if (!resolved) throw ValidationError(`Unbekanntes Filterfeld: "${condition.field}".`);

    if (resolved.kind === "property") {
      clauses.push({ propertyValues: propertyClause(resolved.definition, condition.operator, condition.value) });
      continue;
    }

    clauses.push(nest(resolved.path, scalarClause(resolved.type, condition.operator, condition.value)));
  }

  for (const child of group.groups ?? []) {
    const nested = buildWhere(child, resolve);
    if (Object.keys(nested).length > 0) clauses.push(nested);
  }

  if (clauses.length === 0) return {};
  return group.combinator === "OR" ? { OR: clauses } : { AND: clauses };
}

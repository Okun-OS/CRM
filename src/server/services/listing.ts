import { z } from "zod";
import type { CrmObjectType } from "@/generated/prisma/enums";
import type { ActorContext } from "@/lib/context";
import { buildWhere, filterGroupSchema, type FilterFieldResolver, type FilterGroup } from "@/lib/filters";
import { findField, fieldsFor, SEARCH_FIELDS } from "@/lib/crm/fields";
import { listDefinitions } from "@/lib/properties";
import { paginationSchema, skipTake, type Pagination } from "@/lib/api/pagination";
import { ValidationError } from "@/lib/api/errors";
import { liveScope } from "@/lib/tenant";

/**
 * Shared query handling for every CRM list view: search, filters, sorting and
 * pagination, resolved against the field registry and the organization's custom
 * properties.
 */
export const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  sortField: z.string().max(80).optional(),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  filter: filterGroupSchema.optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/** Parses list parameters from a URL; `filter` is a JSON-encoded FilterGroup. */
export function readListQuery(url: URL): ListQuery {
  const rawFilter = url.searchParams.get("filter");
  let filter: unknown;
  if (rawFilter) {
    try {
      filter = JSON.parse(rawFilter);
    } catch {
      throw ValidationError("Der Filter konnte nicht gelesen werden.");
    }
  }
  return listQuerySchema.parse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    sortField: url.searchParams.get("sortField") ?? undefined,
    sortDirection: url.searchParams.get("sortDirection") ?? undefined,
    filter,
  });
}

async function fieldResolver(ctx: ActorContext, objectType: CrmObjectType): Promise<FilterFieldResolver> {
  const definitions = await listDefinitions(ctx, objectType);
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  return (field: string) => {
    if (field.startsWith("property:")) {
      const definition = byKey.get(field.slice("property:".length));
      return definition ? { kind: "property" as const, definition } : null;
    }
    const registered = findField(objectType, field);
    if (!registered || registered.filterable === false) return null;
    return { kind: "scalar" as const, path: registered.path ?? registered.key, type: registered.type };
  };
}

function searchClause(objectType: CrmObjectType, search?: string) {
  if (!search) return undefined;
  const term = search.trim();
  if (term.length === 0) return undefined;
  return {
    OR: SEARCH_FIELDS[objectType].map((field) => ({
      [field]: { contains: term, mode: "insensitive" as const },
    })),
  };
}

function orderByClause(objectType: CrmObjectType, query: ListQuery) {
  const fallback = { createdAt: query.sortDirection };
  if (!query.sortField) return fallback;
  const field = findField(objectType, query.sortField);
  if (!field || field.sortable === false) return fallback;
  return { [field.path ?? field.key]: query.sortDirection };
}

export type ListArgs = {
  where: Record<string, unknown>;
  orderBy: Record<string, unknown>;
  skip: number;
  take: number;
  pagination: Pagination;
};

/** Builds tenant-scoped Prisma arguments for a CRM list query. */
export async function buildListArgs(
  ctx: ActorContext,
  objectType: CrmObjectType,
  query: ListQuery,
): Promise<ListArgs> {
  const resolve = await fieldResolver(ctx, objectType);
  const filterWhere = query.filter ? buildWhere(query.filter as FilterGroup, resolve) : {};
  const search = searchClause(objectType, query.search);

  const where: Record<string, unknown> = {
    ...liveScope(ctx),
    ...(Object.keys(filterWhere).length > 0 ? filterWhere : {}),
    ...(search ? { AND: [search] } : {}),
  };

  return {
    where,
    orderBy: orderByClause(objectType, query),
    ...skipTake(query),
    pagination: query,
  };
}

/** Columns a client may request, validated against the registry. */
export function resolveColumns(objectType: CrmObjectType, requested?: string[]): string[] {
  const available = new Set(fieldsFor(objectType).map((field) => field.key));
  const valid = (requested ?? []).filter((key) => available.has(key) || key.startsWith("property:"));
  return valid.length > 0 ? valid : fieldsFor(objectType).filter((f) => f.defaultVisible).map((f) => f.key);
}

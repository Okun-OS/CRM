import { z } from "zod";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type Pagination = z.infer<typeof paginationSchema>;

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function paginate<T>(items: T[], total: number, { page, pageSize }: Pagination): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function skipTake({ page, pageSize }: Pagination) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** Parses `?page=&pageSize=` from a URL, falling back to safe defaults. */
export function readPagination(url: URL): Pagination {
  return paginationSchema.parse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
}

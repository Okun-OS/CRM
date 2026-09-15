import { route } from "@/lib/api/route";
import { globalSearch, searchQuerySchema } from "@/server/services/search";

export const GET = route(
  async ({ ctx, url }) =>
    globalSearch(
      ctx,
      searchQuerySchema.parse({ q: url.searchParams.get("q") ?? "", limit: url.searchParams.get("limit") ?? undefined }),
    ),
  { rateLimit: { limit: 120, windowMs: 60_000, scope: "search" } },
);

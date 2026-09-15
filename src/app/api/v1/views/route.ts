import { route, readBody } from "@/lib/api/route";
import type { CrmObjectType } from "@/generated/prisma/enums";
import { createView, listViews, savedViewSchema } from "@/server/services/views";
import { ValidationError } from "@/lib/api/errors";

export const GET = route(async ({ ctx, url }) => {
  const objectType = url.searchParams.get("objectType") as CrmObjectType | null;
  if (!objectType) throw ValidationError("Der Parameter objectType wird benötigt.");
  return listViews(ctx, objectType);
});

export const POST = route(async ({ req, ctx }) => createView(ctx, await readBody(req, savedViewSchema)));

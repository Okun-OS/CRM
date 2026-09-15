import { route, readBody } from "@/lib/api/route";
import type { CrmObjectType } from "@/generated/prisma/enums";
import {
  createDefinition,
  listAllDefinitions,
  propertyDefinitionSchema,
} from "@/server/services/property-definitions";

export const GET = route(async ({ ctx, url }) => {
  const objectType = url.searchParams.get("objectType") as CrmObjectType | null;
  return listAllDefinitions(ctx, objectType ?? undefined);
});

export const POST = route(async ({ req, ctx }) => createDefinition(ctx, await readBody(req, propertyDefinitionSchema)));

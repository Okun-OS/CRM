import { route } from "@/lib/api/route";
import { getOrganization } from "@/server/services/organizations";

/** Bootstrap payload for the client: who am I, where am I, what may I do. */
export const GET = route(async ({ ctx }) => {
  const organization = await getOrganization(ctx);
  return {
    user: { id: ctx.userId, name: ctx.name, email: ctx.email },
    organization,
    role: ctx.role,
    permissions: ctx.permissions,
  };
});

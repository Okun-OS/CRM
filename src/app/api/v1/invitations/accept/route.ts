import { route, readBody } from "@/lib/api/route";
import { acceptInvitationSchema } from "@/lib/schemas/auth";
import { acceptInvitation } from "@/server/services/users";
import { createSession, requestMeta } from "@/lib/auth/session";

export const POST = route(
  async ({ req }) => {
    const user = await acceptInvitation(await readBody(req, acceptInvitationSchema));
    await createSession(user.userId, user.organizationId, await requestMeta());
    return { userId: user.userId, organizationId: user.organizationId };
  },
  { auth: false, rateLimit: { limit: 10, windowMs: 60 * 60 * 1000, scope: "invitations:accept" } },
);

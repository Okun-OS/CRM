import { route, readBody } from "@/lib/api/route";
import { inviteMember, inviteSchema, listMembers } from "@/server/services/users";

export const GET = route(async ({ ctx }) => listMembers(ctx));

/** Creates an invitation; the returned link is shown once to the administrator. */
export const POST = route(async ({ req, ctx }) => inviteMember(ctx, await readBody(req, inviteSchema)));

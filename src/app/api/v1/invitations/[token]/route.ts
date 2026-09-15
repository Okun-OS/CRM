import { route } from "@/lib/api/route";
import { readInvitation } from "@/server/services/users";

/** Public: the acceptance screen needs to show which organization invited you. */
export const GET = route<{ token: string }>(async ({ params }) => readInvitation(params.token), {
  auth: false,
  rateLimit: { limit: 30, windowMs: 60 * 60 * 1000, scope: "invitations:read" },
});

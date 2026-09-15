import { route } from "@/lib/api/route";
import { listInvitations } from "@/server/services/users";

export const GET = route(async ({ ctx }) => listInvitations(ctx));

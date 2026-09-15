import { route } from "@/lib/api/route";
import { listSessions } from "@/server/services/auth";

export const GET = route(async ({ ctx }) => listSessions(ctx));

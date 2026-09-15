import { route, readBody } from "@/lib/api/route";
import { createTeam, listTeams, teamSchema } from "@/server/services/users";

export const GET = route(async ({ ctx }) => listTeams(ctx));

export const POST = route(async ({ req, ctx }) => createTeam(ctx, await readBody(req, teamSchema)));

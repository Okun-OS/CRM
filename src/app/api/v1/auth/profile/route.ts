import { route, readBody } from "@/lib/api/route";
import { profileSchema } from "@/lib/schemas/auth";
import { updateProfile } from "@/server/services/auth";

export const PATCH = route(async ({ req, ctx }) => updateProfile(ctx, await readBody(req, profileSchema)));

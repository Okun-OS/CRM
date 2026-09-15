import { NextResponse } from "next/server";
import { route, readBody } from "@/lib/api/route";
import { registerSchema } from "@/lib/schemas/auth";
import { register } from "@/server/services/auth";
import { createSession, requestMeta } from "@/lib/auth/session";

export const POST = route(
  async ({ req }) => {
    const body = await readBody(req, registerSchema);
    const user = await register(body);
    await createSession(user.userId, user.organizationId, await requestMeta());
    return NextResponse.json({ data: { userId: user.userId, email: user.email, name: user.name } }, { status: 201 });
  },
  { auth: false, rateLimit: { limit: 5, windowMs: 60 * 60 * 1000, scope: "auth:register" } },
);

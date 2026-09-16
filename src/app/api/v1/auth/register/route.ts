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
  // Registration is rare; a generous instance-wide ceiling keeps automated
  // sign-up floods out without blocking legitimate traffic behind one NAT.
  { auth: false, rateLimit: { limit: 60, windowMs: 60 * 60 * 1000, scope: "auth:register" } },
);

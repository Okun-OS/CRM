import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import { env, isProduction, trustProxy } from "@/lib/env";
import { buildContext, type ActorContext } from "@/lib/context";

export const SESSION_COOKIE = "okun_session";
/** Readable by the browser on purpose: double-submit CSRF token. */
export const CSRF_COOKIE = "okun_csrf";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days, sliding
const TOUCH_INTERVAL_MS = 1000 * 60 * 5;

export type RequestMeta = { ip?: string; userAgent?: string };

/** Client IP; X-Forwarded-For is only honoured when TRUST_PROXY is enabled. */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const userAgent = h.get("user-agent")?.slice(0, 500) ?? undefined;
  if (!trustProxy()) return { userAgent };
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  return { ip: ip ?? undefined, userAgent };
}

export async function createSession(
  userId: string,
  organizationId: string | null,
  meta: RequestMeta = {},
): Promise<void> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      activeOrganizationId: organizationId,
      csrfToken,
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt,
    },
  });

  const jar = await cookies();
  const secure = isProduction();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: expiresAt,
  });
  jar.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

export type SessionRecord = {
  id: string;
  userId: string;
  csrfToken: string;
  activeOrganizationId: string | null;
};

/** Loads and validates the session behind the request cookie. */
export async function loadSession(): Promise<SessionRecord | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      csrfToken: true,
      activeOrganizationId: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
    },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }

  return {
    id: session.id,
    userId: session.userId,
    csrfToken: session.csrfToken,
    activeOrganizationId: session.activeOrganizationId,
  };
}

/**
 * Resolves the full actor context: session → user → active membership.
 * Returns null when unauthenticated or when the membership is not active.
 */
export async function getActor(): Promise<ActorContext | null> {
  const session = await loadSession();
  if (!session) return null;

  const user = await prisma.user.findFirst({
    where: { id: session.userId, deletedAt: null },
    select: { id: true, email: true, name: true },
  });
  if (!user) return null;

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      status: "ACTIVE",
      organization: { deletedAt: null },
      ...(session.activeOrganizationId ? { organizationId: session.activeOrganizationId } : {}),
    },
    select: {
      organizationId: true,
      role: true,
      organization: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;

  const meta = await requestMeta();
  return buildContext({
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: membership.role,
    sessionId: session.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/** Switches the active organization of the current session. */
export async function setActiveOrganization(organizationId: string): Promise<void> {
  const session = await loadSession();
  if (!session) return;
  await prisma.session.update({
    where: { id: session.id },
    data: { activeOrganizationId: organizationId },
  });
}

export function appUrl(path = "/"): string {
  return new URL(path, env().APP_URL).toString();
}

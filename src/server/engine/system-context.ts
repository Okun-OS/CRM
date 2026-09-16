import { prisma } from "@/lib/db";
import { buildContext, type ActorContext } from "@/lib/context";

/**
 * Builds the actor a background run acts as.
 *
 * Background work is never anonymous: it runs as a real member of the
 * organization, so permission checks, the audit log and the timeline all name
 * someone. Preference order is the user the automation belongs to, then its
 * creator, then an administrator of the organization.
 */
export async function systemContextFor(
  organizationId: string,
  preferredUserIds: (string | null | undefined)[] = [],
): Promise<ActorContext | null> {
  const candidates = preferredUserIds.filter((id): id is string => Boolean(id));

  for (const userId of candidates) {
    const membership = await prisma.membership.findFirst({
      where: { organizationId, userId, status: "ACTIVE" },
      include: { user: { select: { id: true, email: true, name: true } }, organization: { select: { name: true } } },
    });
    if (membership) {
      return buildContext({
        organizationId,
        organizationName: membership.organization.name,
        userId: membership.user.id,
        email: membership.user.email,
        name: membership.user.name,
        role: membership.role,
      });
    }
  }

  const admin = await prisma.membership.findFirst({
    where: { organizationId, status: "ACTIVE", role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, email: true, name: true } }, organization: { select: { name: true } } },
  });
  if (!admin) return null;

  return buildContext({
    organizationId,
    organizationName: admin.organization.name,
    userId: admin.user.id,
    email: admin.user.email,
    name: admin.user.name,
    role: admin.role,
  });
}

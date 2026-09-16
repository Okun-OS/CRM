import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { buildContext, type ActorContext } from "@/lib/context";
import type { Role } from "@/generated/prisma/enums";
import { provisionOrganization } from "@/server/services/organizations";

/** Creates an isolated organization with one member and returns its context. */
export async function createTestOrganization(options: { name?: string; role?: Role } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const name = options.name ?? `Testorganisation ${suffix}`;

  const { organization, user } = await prisma.$transaction(async (tx) => {
    const organization = await provisionOrganization(tx, { name, slug: `test-${suffix}` });
    const user = await tx.user.create({
      data: {
        email: `owner-${suffix}@example.test`,
        name: `Owner ${suffix}`,
        passwordHash: await hashPassword("TestPasswort2026!"),
      },
    });
    await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: options.role ?? "SUPER_ADMIN",
        status: "ACTIVE",
      },
    });
    return { organization, user };
  });

  const ctx = buildContext({
    organizationId: organization.id,
    organizationName: organization.name,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: options.role ?? "SUPER_ADMIN",
  });

  return { organization, user, ctx };
}

/** Adds a second member with a different role to an existing organization. */
export async function addMember(ctx: ActorContext, role: Role) {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `member-${suffix}@example.test`,
      name: `Member ${suffix}`,
      passwordHash: await hashPassword("TestPasswort2026!"),
    },
  });
  await prisma.membership.create({
    data: { organizationId: ctx.organizationId, userId: user.id, role, status: "ACTIVE" },
  });

  return {
    user,
    ctx: buildContext({
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      userId: user.id,
      email: user.email,
      name: user.name,
      role,
    }),
  };
}

export async function defaultPipeline(ctx: ActorContext) {
  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId: ctx.organizationId },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline) throw new Error("Test-Fixture: keine Pipeline vorhanden");
  return pipeline;
}

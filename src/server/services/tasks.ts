import { z } from "zod";
import type { TaskStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";
import { writeAudit, diff } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { taskInputSchema, taskUpdateSchema } from "@/lib/schemas/crm";
import { ValidationError } from "@/lib/api/errors";
import { logSystemActivity, touchLastActivity } from "./activities";
import { assertOwnerInOrganization, assertRelationsExist } from "./record-helpers";
import { notify } from "./notifications";

/** Task management with the views the sales team actually works from. */
export const TASK_VIEWS = ["today", "overdue", "upcoming", "completed", "all", "mine", "team"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const taskListQuerySchema = paginationSchema.extend({
  view: z.enum(TASK_VIEWS).default("mine"),
  ownerId: z.string().max(30).optional(),
  contactId: z.string().max(30).optional(),
  companyId: z.string().max(30).optional(),
  dealId: z.string().max(30).optional(),
  leadId: z.string().max(30).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  search: z.string().trim().max(120).optional(),
});

export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

const taskInclude = {
  owner: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true } },
  lead: { select: { id: true, firstName: true, lastName: true, companyName: true } },
} as const;

function viewWhere(ctx: ActorContext, view: TaskView) {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const open = { status: { in: ["OPEN", "IN_PROGRESS"] as TaskStatus[] } };

  switch (view) {
    case "today":
      return { ...open, dueAt: { lte: endOfToday } };
    case "overdue":
      return { ...open, dueAt: { lt: now } };
    case "upcoming":
      return { ...open, dueAt: { gt: endOfToday } };
    case "completed":
      return { status: "COMPLETED" as TaskStatus };
    case "mine":
      return { ...open, ownerId: ctx.userId };
    case "team":
      return { ...open, ownerId: { not: ctx.userId } };
    default:
      return {};
  }
}

export async function listTasks(ctx: ActorContext, query: TaskListQuery) {
  assertPermission(ctx, "tasks.read");

  const where = {
    ...scope(ctx),
    deletedAt: null,
    ...viewWhere(ctx, query.view),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.contactId ? { contactId: query.contactId } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.dealId ? { dealId: query.dealId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [rows, total, counts] = await Promise.all([
    prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      ...skipTake(query),
    }),
    prisma.task.count({ where }),
    taskCounts(ctx),
  ]);

  return { ...paginate(rows.map(mapTask), total, query), counts };
}

export async function taskCounts(ctx: ActorContext) {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const base = { ...scope(ctx), deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] as TaskStatus[] } };

  const [today, overdue, upcoming, mine] = await Promise.all([
    prisma.task.count({ where: { ...base, dueAt: { lte: endOfToday, gte: now } } }),
    prisma.task.count({ where: { ...base, dueAt: { lt: now } } }),
    prisma.task.count({ where: { ...base, dueAt: { gt: endOfToday } } }),
    prisma.task.count({ where: { ...base, ownerId: ctx.userId } }),
  ]);

  return { today, overdue, upcoming, mine };
}

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: Date | null;
  remindAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  owner: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  lead: { id: string; firstName: string | null; lastName: string | null; companyName: string | null } | null;
};

function mapTask(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString() ?? null,
    remindAt: row.remindAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    owner: row.owner,
    contact: row.contact ? { id: row.contact.id, name: `${row.contact.firstName} ${row.contact.lastName}`.trim() } : null,
    company: row.company,
    deal: row.deal,
    lead: row.lead
      ? {
          id: row.lead.id,
          name: [row.lead.firstName, row.lead.lastName].filter(Boolean).join(" ") || row.lead.companyName || "Lead",
        }
      : null,
    isOverdue: Boolean(row.dueAt && row.dueAt.getTime() < Date.now() && row.status !== "COMPLETED"),
  };
}

export type TaskDTO = ReturnType<typeof mapTask>;

export async function createTask(ctx: ActorContext, input: z.input<typeof taskInputSchema>) {
  assertPermission(ctx, "tasks.write");
  const data = taskInputSchema.parse(input);

  await assertRelationsExist(ctx, {
    contactId: data.contactId,
    companyId: data.companyId,
    dealId: data.dealId,
    leadId: data.leadId,
  });
  await assertOwnerInOrganization(ctx, data.ownerId);

  const task = await prisma.task.create({
    data: {
      organizationId: ctx.organizationId,
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      dueAt: data.dueAt,
      remindAt: data.remindAt,
      ownerId: data.ownerId ?? ctx.userId,
      createdById: ctx.userId,
      contactId: data.contactId,
      companyId: data.companyId,
      dealId: data.dealId,
      leadId: data.leadId,
    },
    include: taskInclude,
  });

  await logSystemActivity(ctx, {
    type: "TASK",
    subject: `Aufgabe erstellt: ${task.title}`,
    links: { contactId: task.contactId, companyId: task.companyId, dealId: task.dealId, leadId: task.leadId },
    metadata: { taskId: task.id, dueAt: task.dueAt?.toISOString() ?? null },
  });
  await writeAudit(ctx, { action: "task.created", entityType: "Task", entityId: task.id, after: { title: task.title } });

  if (task.ownerId && task.ownerId !== ctx.userId) {
    await notify(ctx, {
      userId: task.ownerId,
      type: "TASK_ASSIGNED",
      title: `Neue Aufgabe: ${task.title}`,
      body: `${ctx.name} hat dir eine Aufgabe zugewiesen.`,
      link: `/tasks?taskId=${task.id}`,
      entityType: "Task",
      entityId: task.id,
    });
  }

  await emitDomainEvent(ctx, {
    name: "task.created",
    entityType: "TASK",
    entityId: task.id,
    payload: { id: task.id, title: task.title },
  });

  return mapTask(task as TaskRow);
}

export async function updateTask(ctx: ActorContext, id: string, input: z.input<typeof taskUpdateSchema>) {
  assertPermission(ctx, "tasks.write");
  const data = taskUpdateSchema.parse(input);

  const existing = assertFound(
    await prisma.task.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Die Aufgabe wurde nicht gefunden.",
  );
  await assertOwnerInOrganization(ctx, data.ownerId);
  await assertRelationsExist(ctx, {
    contactId: data.contactId,
    companyId: data.companyId,
    dealId: data.dealId,
    leadId: data.leadId,
  });

  const completing = data.status === "COMPLETED" && existing.status !== "COMPLETED";
  const reopening = data.status && data.status !== "COMPLETED" && existing.status === "COMPLETED";

  const task = await prisma.task.update({
    where: { id: existing.id },
    data: {
      ...data,
      completedAt: completing ? new Date() : reopening ? null : existing.completedAt,
    },
    include: taskInclude,
  });

  const delta = diff(existing as unknown as Record<string, unknown>, data as Record<string, unknown>);
  if (delta.changed.length > 0) {
    await writeAudit(ctx, {
      action: completing ? "task.completed" : "task.updated",
      entityType: "Task",
      entityId: id,
      before: delta.before,
      after: delta.after,
    });
  }

  if (completing) {
    const links = { contactId: task.contactId, companyId: task.companyId, dealId: task.dealId, leadId: task.leadId };
    await logSystemActivity(ctx, {
      type: "TASK",
      subject: `Aufgabe erledigt: ${task.title}`,
      links,
      metadata: { taskId: task.id },
    });
    await touchLastActivity(ctx, links);
    await emitDomainEvent(ctx, {
      name: "task.completed",
      entityType: "TASK",
      entityId: task.id,
      payload: { id: task.id, title: task.title },
    });
  }

  if (data.ownerId && data.ownerId !== existing.ownerId && data.ownerId !== ctx.userId) {
    await notify(ctx, {
      userId: data.ownerId,
      type: "TASK_ASSIGNED",
      title: `Aufgabe zugewiesen: ${task.title}`,
      link: `/tasks?taskId=${task.id}`,
      entityType: "Task",
      entityId: task.id,
    });
  }

  return mapTask(task as TaskRow);
}

export async function deleteTask(ctx: ActorContext, id: string) {
  assertPermission(ctx, "tasks.write");
  const existing = assertFound(
    await prisma.task.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Die Aufgabe wurde nicht gefunden.",
  );
  await prisma.task.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await writeAudit(ctx, { action: "task.deleted", entityType: "Task", entityId: id, before: { title: existing.title } });
}

/** Used by the workflow engine to create follow-up tasks. */
export async function createTaskFromAutomation(
  ctx: ActorContext,
  input: {
    title: string;
    description?: string;
    dueInDays?: number;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    ownerId?: string;
    contactId?: string;
    companyId?: string;
    dealId?: string;
    leadId?: string;
  },
) {
  if (!input.title.trim()) throw ValidationError("Für die Aufgabe fehlt ein Titel.");
  const dueAt = input.dueInDays !== undefined ? new Date(Date.now() + input.dueInDays * 86_400_000) : undefined;
  return createTask(ctx, {
    title: input.title,
    description: input.description,
    priority: input.priority ?? "MEDIUM",
    dueAt,
    ownerId: input.ownerId,
    contactId: input.contactId,
    companyId: input.companyId,
    dealId: input.dealId,
    leadId: input.leadId,
  });
}

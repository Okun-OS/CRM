import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";
import { writeAudit } from "@/lib/audit";
import { noteInputSchema } from "@/lib/schemas/crm";
import { Forbidden, ValidationError } from "@/lib/api/errors";
import { assertLinksInTenant, logSystemActivity, touchLastActivity } from "./activities";

/**
 * Notes carry context that people rely on, so edits keep a revision history
 * instead of silently overwriting what a colleague wrote.
 */
export const noteListQuerySchema = paginationSchema.extend({
  contactId: z.string().max(30).optional(),
  companyId: z.string().max(30).optional(),
  dealId: z.string().max(30).optional(),
  leadId: z.string().max(30).optional(),
});

const noteInclude = {
  author: { select: { id: true, name: true } },
  revisions: {
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { editedBy: { select: { id: true, name: true } } },
  },
} as const;

type NoteRow = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
  author: { id: string; name: string } | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  leadId: string | null;
  revisions: { id: string; body: string; createdAt: Date; editedBy: { id: string; name: string } | null }[];
};

function mapNote(row: NoteRow) {
  return {
    id: row.id,
    body: row.body,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    links: { contactId: row.contactId, companyId: row.companyId, dealId: row.dealId, leadId: row.leadId },
    revisions: row.revisions.map((revision) => ({
      id: revision.id,
      body: revision.body,
      editedBy: revision.editedBy,
      createdAt: revision.createdAt.toISOString(),
    })),
  };
}

export async function listNotes(ctx: ActorContext, query: z.infer<typeof noteListQuerySchema>) {
  assertPermission(ctx, "notes.read");
  const where = {
    ...scope(ctx),
    deletedAt: null,
    ...(query.contactId ? { contactId: query.contactId } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.dealId ? { dealId: query.dealId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.note.findMany({ where, include: noteInclude, orderBy: { createdAt: "desc" }, ...skipTake(query) }),
    prisma.note.count({ where }),
  ]);

  return paginate(rows.map((row) => mapNote(row as NoteRow)), total, query);
}

export async function createNote(ctx: ActorContext, input: z.input<typeof noteInputSchema>) {
  assertPermission(ctx, "notes.write");
  const data = noteInputSchema.parse(input);

  const links = {
    contactId: data.contactId ?? null,
    companyId: data.companyId ?? null,
    dealId: data.dealId ?? null,
    leadId: data.leadId ?? null,
  };
  if (!links.contactId && !links.companyId && !links.dealId && !links.leadId) {
    throw ValidationError("Eine Notiz muss einem Datensatz zugeordnet sein.");
  }
  await assertLinksInTenant(ctx, links);

  const note = await prisma.note.create({
    data: { organizationId: ctx.organizationId, body: data.body, authorId: ctx.userId, ...links },
    include: noteInclude,
  });

  await prisma.activity.create({
    data: {
      organizationId: ctx.organizationId,
      type: "NOTE",
      source: "MANUAL",
      subject: "Notiz hinzugefügt",
      body: data.body.slice(0, 500),
      actorId: ctx.userId,
      noteId: note.id,
      ...links,
    },
  });
  await touchLastActivity(ctx, links);
  await writeAudit(ctx, { action: "note.created", entityType: "Note", entityId: note.id });

  return mapNote(note as NoteRow);
}

/** Editing keeps the previous text as a revision; only the author or a manager may edit. */
export async function updateNote(ctx: ActorContext, id: string, body: string) {
  assertPermission(ctx, "notes.write");
  const parsed = z.string().trim().min(1).max(20_000).parse(body);

  const existing = assertFound(
    await prisma.note.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Die Notiz wurde nicht gefunden.",
  );

  const isAuthor = existing.authorId === ctx.userId;
  const mayEditOthers = ctx.permissions.includes("settings.manage");
  if (!isAuthor && !mayEditOthers) {
    throw Forbidden("Nur die Autorin oder der Autor kann diese Notiz bearbeiten.");
  }
  if (existing.body === parsed) return;

  await prisma.$transaction([
    prisma.noteRevision.create({
      data: { noteId: existing.id, body: existing.body, editedById: ctx.userId },
    }),
    prisma.note.update({ where: { id: existing.id }, data: { body: parsed, editedAt: new Date() } }),
  ]);

  await writeAudit(ctx, {
    action: "note.updated",
    entityType: "Note",
    entityId: id,
    before: { body: existing.body.slice(0, 500) },
    after: { body: parsed.slice(0, 500) },
  });

  await logSystemActivity(ctx, {
    subject: "Notiz bearbeitet",
    links: {
      contactId: existing.contactId,
      companyId: existing.companyId,
      dealId: existing.dealId,
      leadId: existing.leadId,
    },
    metadata: { noteId: existing.id },
  });
}

export async function deleteNote(ctx: ActorContext, id: string) {
  assertPermission(ctx, "notes.write");
  const existing = assertFound(
    await prisma.note.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Die Notiz wurde nicht gefunden.",
  );
  if (existing.authorId !== ctx.userId && !ctx.permissions.includes("settings.manage")) {
    throw Forbidden("Nur die Autorin oder der Autor kann diese Notiz löschen.");
  }
  await prisma.note.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await writeAudit(ctx, { action: "note.deleted", entityType: "Note", entityId: id });
}

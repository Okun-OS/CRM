import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit, diff } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { meetingInputSchema, meetingUpdateSchema } from "@/lib/schemas/crm";
import { ValidationError } from "@/lib/api/errors";
import { logSystemActivity, touchLastActivity } from "./activities";
import { assertOwnerInOrganization, assertRelationsExist } from "./record-helpers";
import { notify } from "./notifications";

/**
 * CRM meetings. External calendar providers are not connected yet — the
 * integration layer (`src/server/integrations`) defines where that plugs in.
 */
export const meetingRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  ownerId: z.string().max(30).optional(),
  contactId: z.string().max(30).optional(),
  companyId: z.string().max(30).optional(),
  dealId: z.string().max(30).optional(),
});

const meetingInclude = {
  owner: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true } },
  attendees: {
    include: {
      user: { select: { id: true, name: true, email: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  },
} as const;

type MeetingRow = {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  meetingUrl: string | null;
  status: string;
  createdAt: Date;
  owner: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  attendees: {
    id: string;
    email: string | null;
    name: string | null;
    response: string | null;
    user: { id: string; name: string; email: string } | null;
    contact: { id: string; firstName: string; lastName: string; email: string | null } | null;
  }[];
};

function mapMeeting(row: MeetingRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    location: row.location,
    meetingUrl: row.meetingUrl,
    status: row.status,
    owner: row.owner,
    contact: row.contact ? { id: row.contact.id, name: `${row.contact.firstName} ${row.contact.lastName}`.trim() } : null,
    company: row.company,
    deal: row.deal,
    attendees: row.attendees.map((attendee) => ({
      id: attendee.id,
      name: attendee.user?.name ?? (attendee.contact ? `${attendee.contact.firstName} ${attendee.contact.lastName}`.trim() : attendee.name),
      email: attendee.user?.email ?? attendee.contact?.email ?? attendee.email,
      type: attendee.user ? ("user" as const) : ("contact" as const),
      response: attendee.response,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

export type MeetingDTO = ReturnType<typeof mapMeeting>;

export async function listMeetings(ctx: ActorContext, query: z.infer<typeof meetingRangeSchema>) {
  assertPermission(ctx, "meetings.read");
  if (query.to < query.from) throw ValidationError("Das Enddatum liegt vor dem Startdatum.");

  const rows = await prisma.meeting.findMany({
    where: {
      ...scope(ctx),
      deletedAt: null,
      startAt: { gte: query.from, lte: query.to },
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
    },
    include: meetingInclude,
    orderBy: { startAt: "asc" },
    take: 500,
  });

  return rows.map((row) => mapMeeting(row as MeetingRow));
}

export async function getMeeting(ctx: ActorContext, id: string) {
  assertPermission(ctx, "meetings.read");
  const meeting = assertFound(
    await prisma.meeting.findFirst({ where: { id, ...scope(ctx), deletedAt: null }, include: meetingInclude }),
    "Der Termin wurde nicht gefunden.",
  );
  return mapMeeting(meeting as MeetingRow);
}

export async function createMeeting(ctx: ActorContext, input: z.input<typeof meetingInputSchema>) {
  assertPermission(ctx, "meetings.write");
  const data = meetingInputSchema.parse(input);

  await assertRelationsExist(ctx, { contactId: data.contactId, companyId: data.companyId, dealId: data.dealId });
  await assertOwnerInOrganization(ctx, data.ownerId);

  const attendeeUserIds = Array.from(new Set(data.attendeeUserIds ?? []));
  const attendeeContactIds = Array.from(new Set(data.attendeeContactIds ?? []));

  if (attendeeUserIds.length > 0) {
    const members = await prisma.membership.count({
      where: { userId: { in: attendeeUserIds }, ...scope(ctx), status: "ACTIVE" },
    });
    if (members !== attendeeUserIds.length) throw ValidationError("Mindestens ein Teilnehmer ist kein Mitglied dieser Organisation.");
  }
  if (attendeeContactIds.length > 0) {
    const contacts = await prisma.contact.count({
      where: { id: { in: attendeeContactIds }, ...scope(ctx), deletedAt: null },
    });
    if (contacts !== attendeeContactIds.length) throw ValidationError("Mindestens ein Kontakt gehört nicht zu dieser Organisation.");
  }

  const meeting = await prisma.meeting.create({
    data: {
      organizationId: ctx.organizationId,
      title: data.title,
      description: data.description,
      startAt: data.startAt,
      endAt: data.endAt,
      location: data.location,
      meetingUrl: data.meetingUrl,
      status: data.status,
      ownerId: data.ownerId ?? ctx.userId,
      contactId: data.contactId,
      companyId: data.companyId,
      dealId: data.dealId,
      attendees: {
        create: [
          ...attendeeUserIds.map((userId) => ({ organizationId: ctx.organizationId, userId })),
          ...attendeeContactIds.map((contactId) => ({ organizationId: ctx.organizationId, contactId })),
        ],
      },
    },
    include: meetingInclude,
  });

  const links = { contactId: meeting.contactId, companyId: meeting.companyId, dealId: meeting.dealId };

  await prisma.activity.create({
    data: {
      organizationId: ctx.organizationId,
      type: "MEETING",
      source: "MANUAL",
      subject: `Termin: ${meeting.title}`,
      body: meeting.description,
      occurredAt: meeting.startAt,
      actorId: ctx.userId,
      meetingId: meeting.id,
      ...links,
    },
  });

  if (meeting.contactId) {
    await prisma.contact.updateMany({
      where: { id: meeting.contactId, ...scope(ctx) },
      data: { nextActivityAt: meeting.startAt },
    });
  }
  await touchLastActivity(ctx, links);

  await writeAudit(ctx, {
    action: "meeting.created",
    entityType: "Meeting",
    entityId: meeting.id,
    after: { title: meeting.title, startAt: meeting.startAt.toISOString() },
  });

  for (const userId of attendeeUserIds.filter((id) => id !== ctx.userId)) {
    await notify(ctx, {
      userId,
      type: "MEETING_UPCOMING",
      title: `Termin: ${meeting.title}`,
      body: `${ctx.name} hat dich zu einem Termin eingeladen.`,
      link: `/calendar?meetingId=${meeting.id}`,
      entityType: "Meeting",
      entityId: meeting.id,
    });
  }

  await emitDomainEvent(ctx, {
    name: "meeting.created",
    entityType: "MEETING",
    entityId: meeting.id,
    payload: { id: meeting.id, title: meeting.title, startAt: meeting.startAt.toISOString() },
  });

  return mapMeeting(meeting as MeetingRow);
}

export async function updateMeeting(ctx: ActorContext, id: string, input: z.input<typeof meetingUpdateSchema>) {
  assertPermission(ctx, "meetings.write");
  const data = meetingUpdateSchema.parse(input);

  const existing = assertFound(
    await prisma.meeting.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Der Termin wurde nicht gefunden.",
  );

  const startAt = data.startAt ?? existing.startAt;
  const endAt = data.endAt ?? existing.endAt;
  if (endAt <= startAt) throw ValidationError("Das Ende muss nach dem Beginn liegen.");

  await assertRelationsExist(ctx, { contactId: data.contactId, companyId: data.companyId, dealId: data.dealId });
  await assertOwnerInOrganization(ctx, data.ownerId);

  const meeting = await prisma.meeting.update({
    where: { id: existing.id },
    data: { ...data, startAt, endAt },
    include: meetingInclude,
  });

  const delta = diff(existing as unknown as Record<string, unknown>, data as Record<string, unknown>);
  if (delta.changed.length > 0) {
    await writeAudit(ctx, {
      action: "meeting.updated",
      entityType: "Meeting",
      entityId: id,
      before: delta.before,
      after: delta.after,
    });
    await logSystemActivity(ctx, {
      subject: `Termin aktualisiert: ${meeting.title}`,
      links: { contactId: meeting.contactId, companyId: meeting.companyId, dealId: meeting.dealId },
      metadata: { changed: delta.changed },
    });
  }

  return mapMeeting(meeting as MeetingRow);
}

export async function deleteMeeting(ctx: ActorContext, id: string) {
  assertPermission(ctx, "meetings.write");
  const existing = assertFound(
    await prisma.meeting.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Der Termin wurde nicht gefunden.",
  );
  await prisma.meeting.update({ where: { id: existing.id }, data: { deletedAt: new Date(), status: "CANCELLED" } });
  await writeAudit(ctx, { action: "meeting.deleted", entityType: "Meeting", entityId: id, before: { title: existing.title } });
}

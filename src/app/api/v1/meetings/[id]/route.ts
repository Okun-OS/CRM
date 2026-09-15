import { route, readBody } from "@/lib/api/route";
import { meetingUpdateSchema } from "@/lib/schemas/crm";
import { deleteMeeting, getMeeting, updateMeeting } from "@/server/services/meetings";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getMeeting(ctx, params.id));

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateMeeting(ctx, params.id, await readBody(req, meetingUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteMeeting(ctx, params.id);
  return { ok: true };
});

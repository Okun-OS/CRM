import { route, readBody } from "@/lib/api/route";
import { meetingInputSchema } from "@/lib/schemas/crm";
import { createMeeting, listMeetings, meetingRangeSchema } from "@/server/services/meetings";

export const GET = route(async ({ ctx, url }) =>
  listMeetings(ctx, meetingRangeSchema.parse(Object.fromEntries(url.searchParams.entries()))),
);

export const POST = route(async ({ req, ctx }) => createMeeting(ctx, await readBody(req, meetingInputSchema)));

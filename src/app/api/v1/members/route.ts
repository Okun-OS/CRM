import { route } from "@/lib/api/route";
import { listOrganizationMembers } from "@/server/services/record-helpers";

/** Lightweight member list for owner pickers — available to every member. */
export const GET = route(async ({ ctx }) => listOrganizationMembers(ctx));

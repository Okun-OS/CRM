import { route } from "@/lib/api/route";
import { leadConversion } from "@/server/services/reports";

export const GET = route(async ({ ctx }) => leadConversion(ctx));

import { route } from "@/lib/api/route";
import { auditQuerySchema, listAuditLog } from "@/server/services/audit";

export const GET = route(async ({ ctx, url }) =>
  listAuditLog(ctx, auditQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))),
);

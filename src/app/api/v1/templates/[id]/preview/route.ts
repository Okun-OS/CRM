import { route } from "@/lib/api/route";
import { previewTemplate } from "@/server/services/emails";

export const GET = route<{ id: string }>(async ({ ctx, params, url }) =>
  previewTemplate(ctx, params.id, {
    contactId: url.searchParams.get("contactId") ?? undefined,
    companyId: url.searchParams.get("companyId") ?? undefined,
    dealId: url.searchParams.get("dealId") ?? undefined,
  }),
);

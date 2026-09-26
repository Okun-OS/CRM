import { route, readBody } from "@/lib/api/route";
import { conversionInputSchema, convertProspect, previewConversion } from "@/server/services/acquisition/conversion";

/** Vorschau: Was würde die Übernahme tun? */
export const GET = route<{ id: string }>(async ({ ctx, params }) => previewConversion(ctx, params.id));

export const POST = route<{ id: string }>(async ({ req, ctx, params }) =>
  convertProspect(ctx, params.id, await readBody(req, conversionInputSchema)),
);

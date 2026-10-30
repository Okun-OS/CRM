import { mailwinRoute } from "@/server/mailwin/http";
import { listMailwinPipelines } from "@/server/mailwin/service";

/** Aktive Pipelines mit ihren Phasen; die Standard-Pipeline steht zuerst. */
export const GET = mailwinRoute(async ({ ctx }) => ({ status: 200, body: await listMailwinPipelines(ctx) }));

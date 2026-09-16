import { machineRoute, readMachineBody } from "@/lib/api/machine-route";
import { ingestBatchSchema, ingestEvents } from "@/server/services/ingestion";

/**
 * Inbound events from other OKUN products. Authenticated with an API key whose
 * organization decides the tenant; each event carries its own idempotency key.
 */
export const POST = machineRoute(
  async ({ req, ctx }) => {
    const body = await readMachineBody(req, ingestBatchSchema);
    return { results: await ingestEvents(ctx, body) };
  },
  { scope: "events:write" },
);

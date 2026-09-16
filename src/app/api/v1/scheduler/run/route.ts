import { machineRoute } from "@/lib/api/machine-route";
import { runSweepForOrganization } from "@/server/engine/sweep";

/**
 * The periodic pass: due next actions, stagnation detection and everything
 * scheduled. Called by an external scheduler (see docs/OPERATIONS.md).
 */
export const POST = machineRoute(
  async ({ principal }) => runSweepForOrganization(principal.organizationId),
  { scope: "scheduler:run", rateLimit: { limit: 60, windowMs: 60_000 } },
);

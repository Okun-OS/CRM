import { platformRoute } from "@/lib/api/platform-route";
import { getCustomer } from "@/server/services/platform";

export const GET = platformRoute<{ id: string }>(async ({ actor, params }) => getCustomer(actor, params.id));

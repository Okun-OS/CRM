import { platformRoute } from "@/lib/api/platform-route";
import { reactivateCustomer } from "@/server/services/platform";

export const POST = platformRoute<{ id: string }>(async ({ actor, params }) => reactivateCustomer(actor, params.id));

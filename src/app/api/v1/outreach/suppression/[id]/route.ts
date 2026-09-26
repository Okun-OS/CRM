import { route } from "@/lib/api/route";
import { removeSuppression } from "@/server/services/acquisition/suppression";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await removeSuppression(ctx, params.id);
});

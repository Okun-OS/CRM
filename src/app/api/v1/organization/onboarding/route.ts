import { route } from "@/lib/api/route";
import { completeOnboarding, onboardingStatus } from "@/server/services/organizations";

export const GET = route(async ({ ctx }) => onboardingStatus(ctx));

export const POST = route(async ({ ctx }) => {
  await completeOnboarding(ctx);
  return { ok: true };
});

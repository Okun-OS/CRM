import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import type { EngineConfig, EngineThresholds, RuleOverride } from "./types";

/**
 * Engine configuration per organization. The defaults are the shipped ones;
 * an organization row overrides them. Nothing in the rule catalogue reads a
 * hardcoded number.
 */
export const DEFAULT_THRESHOLDS: EngineThresholds = {
  automationEnabled: true,
  leadContactWithinHours: 24,
  followUpAfterDays: 3,
  offerChaseAfterDays: 5,
  stagnationAfterDays: 14,
  meetingPrepLeadHours: 24,
  meetingFollowUpDays: 2,
  quietHoursStart: 20,
  quietHoursEnd: 7,
  workdaysOnly: true,
};

export async function loadEngineConfig(organizationId: string): Promise<EngineConfig> {
  const [setting, rules] = await Promise.all([
    prisma.activeCrmSetting.findUnique({ where: { organizationId } }),
    prisma.activeCrmRuleSetting.findMany({ where: { organizationId } }),
  ]);

  const overrides: Record<string, RuleOverride> = {};
  for (const rule of rules) {
    overrides[rule.ruleKey] = {
      isEnabled: rule.isEnabled,
      delayDays: rule.delayDays,
      priority: rule.priority,
    };
  }

  return {
    thresholds: setting
      ? {
          automationEnabled: setting.automationEnabled,
          leadContactWithinHours: setting.leadContactWithinHours,
          followUpAfterDays: setting.followUpAfterDays,
          offerChaseAfterDays: setting.offerChaseAfterDays,
          stagnationAfterDays: setting.stagnationAfterDays,
          meetingPrepLeadHours: setting.meetingPrepLeadHours,
          meetingFollowUpDays: setting.meetingFollowUpDays,
          quietHoursStart: setting.quietHoursStart,
          quietHoursEnd: setting.quietHoursEnd,
          workdaysOnly: setting.workdaysOnly,
        }
      : { ...DEFAULT_THRESHOLDS },
    overrides,
  };
}

export async function getActiveCrmSettings(ctx: ActorContext) {
  const config = await loadEngineConfig(ctx.organizationId);
  return config.thresholds;
}

export async function listRuleSettings(ctx: ActorContext) {
  return prisma.activeCrmRuleSetting.findMany({ where: scope(ctx), orderBy: { ruleKey: "asc" } });
}

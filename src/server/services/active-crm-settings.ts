import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/api/errors";
import { RULE_CATALOGUE } from "@/server/engine/rules";
import { DEFAULT_THRESHOLDS, loadEngineConfig } from "@/server/engine/settings";

/**
 * Administration of the Next Action engine: the thresholds it reasons with and
 * the individual rules. Everything an administrator can change here is what
 * the engine reads at runtime — there is no second, hidden configuration.
 */
export const activeCrmSettingsSchema = z.object({
  automationEnabled: z.boolean(),
  leadContactWithinHours: z.coerce.number().int().min(1).max(720),
  followUpAfterDays: z.coerce.number().int().min(1).max(90),
  offerChaseAfterDays: z.coerce.number().int().min(1).max(90),
  stagnationAfterDays: z.coerce.number().int().min(2).max(365),
  meetingPrepLeadHours: z.coerce.number().int().min(1).max(168),
  meetingFollowUpDays: z.coerce.number().int().min(1).max(60),
  quietHoursStart: z.coerce.number().int().min(0).max(23),
  quietHoursEnd: z.coerce.number().int().min(0).max(23),
  workdaysOnly: z.boolean(),
});

export const ruleSettingSchema = z.object({
  ruleKey: z.string().trim().min(1).max(80),
  isEnabled: z.boolean(),
  delayDays: z.coerce.number().int().min(-30).max(90).nullable().optional(),
  priority: z.coerce.number().int().min(0).max(100).nullable().optional(),
});

export async function getActiveCrmConfiguration(ctx: ActorContext) {
  const config = await loadEngineConfig(ctx.organizationId);
  return {
    settings: config.thresholds,
    defaults: DEFAULT_THRESHOLDS,
    rules: RULE_CATALOGUE.map((rule) => ({
      ...rule,
      isEnabled: config.overrides[rule.key]?.isEnabled ?? true,
      delayDays: config.overrides[rule.key]?.delayDays ?? null,
      priority: config.overrides[rule.key]?.priority ?? null,
    })),
  };
}

export async function updateActiveCrmSettings(ctx: ActorContext, input: z.input<typeof activeCrmSettingsSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = activeCrmSettingsSchema.parse(input);
  if (data.quietHoursStart === data.quietHoursEnd) {
    throw ValidationError("Beginn und Ende der Ruhezeit dürfen nicht identisch sein.");
  }

  const before = await prisma.activeCrmSetting.findUnique({ where: { organizationId: ctx.organizationId } });
  await prisma.activeCrmSetting.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, ...data },
    update: data,
  });

  await writeAudit(ctx, {
    action: "active_crm.settings_updated",
    entityType: "ActiveCrmSetting",
    entityId: ctx.organizationId,
    before: before ? { ...before } : undefined,
    after: { ...data },
  });

  return getActiveCrmConfiguration(ctx);
}

export async function updateRuleSetting(ctx: ActorContext, input: z.input<typeof ruleSettingSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = ruleSettingSchema.parse(input);
  if (!RULE_CATALOGUE.some((rule) => rule.key === data.ruleKey)) {
    throw ValidationError("Diese Regel existiert nicht.");
  }

  await prisma.activeCrmRuleSetting.upsert({
    where: { organizationId_ruleKey: { organizationId: ctx.organizationId, ruleKey: data.ruleKey } },
    create: {
      organizationId: ctx.organizationId,
      ruleKey: data.ruleKey,
      isEnabled: data.isEnabled,
      delayDays: data.delayDays ?? null,
      priority: data.priority ?? null,
    },
    update: { isEnabled: data.isEnabled, delayDays: data.delayDays ?? null, priority: data.priority ?? null },
  });

  await writeAudit(ctx, {
    action: "active_crm.rule_updated",
    entityType: "ActiveCrmRuleSetting",
    entityId: data.ruleKey,
    after: { isEnabled: data.isEnabled, delayDays: data.delayDays ?? null, priority: data.priority ?? null },
  });

  return getActiveCrmConfiguration(ctx);
}

export async function listRuleOverrides(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  return prisma.activeCrmRuleSetting.findMany({ where: scope(ctx), orderBy: { ruleKey: "asc" } });
}

import { route } from "@/lib/api/route";
import { listOrganizationMembers } from "@/server/services/record-helpers";
import { listPipelines } from "@/server/services/pipelines";
import { listLeadStatuses, listLifecycleStages, listTags } from "@/server/services/settings";
import { listDefinitions } from "@/server/services/property-store";

/**
 * One request for everything the client needs to render pickers: members,
 * pipelines, the administrable option sets, tags and custom property
 * definitions. Saves a burst of parallel calls on every form open.
 */
export const GET = route(async ({ ctx }) => {
  const [members, pipelines, lifecycleStages, leadStatuses, tags, contactProps, companyProps, leadProps, dealProps] =
    await Promise.all([
      listOrganizationMembers(ctx),
      listPipelines(ctx),
      listLifecycleStages(ctx),
      listLeadStatuses(ctx),
      listTags(ctx),
      listDefinitions(ctx, "CONTACT"),
      listDefinitions(ctx, "COMPANY"),
      listDefinitions(ctx, "LEAD"),
      listDefinitions(ctx, "DEAL"),
    ]);

  return {
    members,
    pipelines,
    lifecycleStages: lifecycleStages.map((stage) => ({ key: stage.key, label: stage.label })),
    leadStatuses: leadStatuses.map((status) => ({ key: status.key, label: status.label, isTerminal: status.isTerminal })),
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    properties: { CONTACT: contactProps, COMPANY: companyProps, LEAD: leadProps, DEAL: dealProps },
  };
});

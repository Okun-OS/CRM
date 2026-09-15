import { z } from "zod";
import { filterGroupSchema } from "@/lib/filters";

/**
 * Workflow definition shape: TRIGGER + CONDITIONS + ACTIONS.
 *
 * Trigger config and actions are stored as JSON, validated with these schemas
 * on write, so a stored workflow can always be executed.
 */
export const triggerConfigSchema = z.object({
  /** PROPERTY_CHANGED: the field (or `property:<key>`) that must have changed. */
  propertyKey: z.string().max(80).optional(),
  /** DEAL_STAGE_CHANGED: only fire when the deal enters this stage. */
  stageId: z.string().max(30).optional(),
  /** LEAD_STATUS_CHANGED: only fire when the lead reaches this status. */
  statusKey: z.string().max(48).optional(),
  /** TASK_OVERDUE: grace period in hours before the workflow fires. */
  overdueHours: z.coerce.number().int().min(0).max(24 * 30).optional(),
});

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

export const ACTION_TYPES = [
  "set_property",
  "set_owner",
  "create_task",
  "create_note",
  "send_notification",
  "send_email",
  "trigger_webhook",
] as const;

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_property"),
    field: z.string().min(1).max(80),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
  z.object({ type: z.literal("set_owner"), ownerId: z.string().min(1).max(30) }),
  z.object({
    type: z.literal("create_task"),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    dueInDays: z.coerce.number().int().min(0).max(365).default(3),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    assignToOwner: z.boolean().default(true),
  }),
  z.object({ type: z.literal("create_note"), body: z.string().min(1).max(5000) }),
  z.object({
    type: z.literal("send_notification"),
    userId: z.string().min(1).max(30),
    title: z.string().min(1).max(200),
    body: z.string().max(1000).optional(),
  }),
  z.object({
    type: z.literal("send_email"),
    templateId: z.string().min(1).max(30),
    toField: z.enum(["contact.email", "company.email", "lead.email"]).default("contact.email"),
  }),
  z.object({ type: z.literal("trigger_webhook"), endpointId: z.string().min(1).max(30) }),
]);

export type WorkflowAction = z.infer<typeof actionSchema>;

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
  description: z.string().trim().max(1000).optional(),
  objectType: z.enum(["CONTACT", "COMPANY", "LEAD", "DEAL"]),
  triggerType: z.enum([
    "RECORD_CREATED",
    "PROPERTY_CHANGED",
    "DEAL_STAGE_CHANGED",
    "LEAD_STATUS_CHANGED",
    "TASK_OVERDUE",
  ]),
  triggerConfig: triggerConfigSchema.default({}),
  conditions: filterGroupSchema.default({ combinator: "AND", conditions: [] }),
  actions: z.array(actionSchema).min(1, "Mindestens eine Aktion ist erforderlich.").max(10),
  isActive: z.boolean().default(false),
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export const ACTION_LABELS: Record<(typeof ACTION_TYPES)[number], string> = {
  set_property: "Eigenschaft setzen",
  set_owner: "Owner ändern",
  create_task: "Aufgabe erstellen",
  create_note: "Notiz erstellen",
  send_notification: "Benachrichtigung senden",
  send_email: "E-Mail senden",
  trigger_webhook: "Webhook auslösen",
};

export const TRIGGER_LABELS: Record<WorkflowInput["triggerType"], string> = {
  RECORD_CREATED: "Datensatz erstellt",
  PROPERTY_CHANGED: "Eigenschaft geändert",
  DEAL_STAGE_CHANGED: "Deal-Stage geändert",
  LEAD_STATUS_CHANGED: "Lead-Status geändert",
  TASK_OVERDUE: "Aufgabe überfällig",
};

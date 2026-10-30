import { z } from "zod";

/**
 * Eingaben der Mailwin Connect API v1.
 *
 * Unbekannte Felder werden ignoriert, nicht abgelehnt: Mailwin darf künftig
 * mehr mitschicken, ohne dass ein älteres CRM die Anfrage zurückweist.
 */

const email = z
  .string({ error: "E-Mail-Adresse ist erforderlich." })
  .trim()
  .toLowerCase()
  .email("Bitte eine gültige E-Mail-Adresse angeben.")
  .max(254);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : undefined));

/** Nur http(s): Der Link wird im CRM als „In Mailwin öffnen“ angeklickt. */
export const linkUrl = z
  .string({ error: "URL ist erforderlich." })
  .trim()
  .max(2000)
  .url("Bitte eine gültige URL angeben.")
  .refine((value) => /^https?:\/\//i.test(value), "Nur http- und https-Adressen sind erlaubt.");

/** ISO 8601 mit Zeitzone (`Z` oder `+01:00`). Ohne Zone wäre der Zeitpunkt mehrdeutig. */
export const isoDateTime = z
  .string({ error: "Zeitpunkt ist erforderlich." })
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
    "Bitte einen Zeitpunkt nach ISO 8601 mit Zeitzone angeben, z. B. 2026-10-30T09:15:00+01:00.",
  )
  .transform((value) => new Date(value));

export const contactQuerySchema = z.object({ email });

export const contactUpsertSchema = z.object({
  email,
  name: optionalText(160),
  phone: optionalText(40),
  companyName: optionalText(160),
  companyDomain: optionalText(160),
});

export const sourceRefSchema = z.object({
  channel: z.enum(["email", "whatsapp"], { error: "channel muss „email“ oder „whatsapp“ sein." }),
  threadId: z.string({ error: "threadId ist erforderlich." }).trim().min(1).max(500),
  messageId: z.string({ error: "messageId ist erforderlich." }).trim().min(1).max(500),
  url: linkUrl,
});

export const leadCreateSchema = z.object({
  contact: z.object({ email, name: optionalText(160) }, { error: "contact ist erforderlich." }),
  companyName: optionalText(160),
  title: z.string({ error: "title ist erforderlich." }).trim().min(1, "title darf nicht leer sein.").max(160),
  description: z.string({ error: "description ist erforderlich." }).trim().max(10_000),
  pipelineId: optionalText(30),
  stageId: optionalText(30),
  valueCents: z
    .number({ error: "valueCents muss eine ganze Zahl in Cent sein." })
    .int("valueCents muss eine ganze Zahl in Cent sein.")
    .min(0)
    .max(100_000_000_000_000)
    .nullish(),
  source: z.literal("mailwin", { error: "source muss „mailwin“ sein." }),
  sourceRef: sourceRefSchema,
});

export const activityCreateSchema = z
  .object({
    contactId: optionalText(30),
    leadId: optionalText(30),
    type: z.enum(["email", "whatsapp", "note"], { error: "type muss „email“, „whatsapp“ oder „note“ sein." }),
    direction: z.enum(["inbound", "outbound"], { error: "direction muss „inbound“ oder „outbound“ sein." }),
    subject: optionalText(200),
    summary: z.string({ error: "summary ist erforderlich." }).trim().min(1, "summary darf nicht leer sein.").max(10_000),
    occurredAt: isoDateTime,
    externalId: z.string({ error: "externalId ist erforderlich." }).trim().min(1).max(200),
    url: linkUrl,
  })
  .refine((value) => Boolean(value.contactId || value.leadId), {
    message: "contactId oder leadId ist erforderlich.",
    path: ["contactId"],
  });

export type ContactUpsertInput = z.infer<typeof contactUpsertSchema>;
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;

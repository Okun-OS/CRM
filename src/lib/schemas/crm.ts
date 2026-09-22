import { z } from "zod";

/**
 * Shared input schemas. Client forms and server services validate against the
 * same definitions, so the UI cannot submit something the API would reject for
 * a different reason than it shows.
 */
/**
 * Optional field semantics, used by every CRM schema:
 *   undefined → leave the value untouched
 *   "" or null → clear the value
 * This is what lets an edit form remove a phone number or unlink a company
 * instead of only ever adding data.
 */
const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === "" || value === null ? null : value));

const optionalNumber = (min: number, max: number) =>
  z
    .union([z.coerce.number().min(min).max(max), z.literal(""), z.null()])
    .nullish()
    .transform((value) => (value === "" || value === null ? null : value));

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Bitte eine gültige E-Mail-Adresse angeben.")
  .max(254);

export const optionalEmail = z
  .union([emailField, z.literal(""), z.null()])
  .nullish()
  .transform((value) => (value ? value : null));

export const optionalUrl = z
  .union([z.string().trim().url("Bitte eine gültige URL angeben.").max(500), z.literal(""), z.null()])
  .nullish()
  .transform((value) => (value ? value : null));

/**
 * Ein Datumsfeld mit einer Meldung, die man einem Menschen zeigen kann.
 *
 * `z.coerce.date()` macht aus einer unbrauchbaren Eingabe erst ein „Invalid
 * Date" und meldet dann „expected date, received Date" — englischer
 * Bibliothekstext in einer deutschen Oberfläche. Deshalb wird hier selbst
 * umgewandelt und geprüft.
 */
export const dateValue = z
  .union([z.string(), z.number(), z.date()])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Bitte ein gültiges Datum angeben." });
      return z.NEVER;
    }
    return date;
  });

/**
 * Dasselbe für optionale Felder — bewusst nicht als Union mit `dateValue`
 * gebaut: Schlägt jeder Zweig einer Union fehl, meldet zod nur „Invalid input"
 * und die eigentliche Begründung verschwindet in der Verschachtelung.
 */
const optionalDate = z
  .union([z.string(), z.number(), z.date(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === "" || value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Bitte ein gültiges Datum angeben." });
      return z.NEVER;
    }
    return date;
  });

export const propertiesInput = z.record(z.string().max(48), z.unknown()).optional();

export const contactInputSchema = z.object({
  firstName: z.string().trim().min(1, "Vorname ist erforderlich.").max(80),
  lastName: z.string().trim().min(1, "Nachname ist erforderlich.").max(80),
  email: optionalEmail,
  phone: optionalString(40),
  mobile: optionalString(40),
  jobTitle: optionalString(120),
  companyId: optionalString(30),
  lifecycleStage: optionalString(48),
  leadStatus: optionalString(48),
  source: optionalString(80),
  street: optionalString(160),
  postalCode: optionalString(20),
  city: optionalString(80),
  country: optionalString(80),
  linkedinUrl: optionalUrl,
  description: optionalString(5000),
  ownerId: optionalString(30),
  tagIds: z.array(z.string().max(30)).max(25).optional(),
  properties: propertiesInput,
});

export const contactUpdateSchema = contactInputSchema.partial();

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, "Firmenname ist erforderlich.").max(160),
  domain: optionalString(160),
  industry: optionalString(120),
  employeeCount: optionalNumber(0, 10_000_000),
  annualRevenue: optionalNumber(0, 1_000_000_000_000),
  phone: optionalString(40),
  email: optionalEmail,
  website: optionalUrl,
  street: optionalString(160),
  postalCode: optionalString(20),
  city: optionalString(80),
  country: optionalString(80),
  lifecycleStage: optionalString(48),
  source: optionalString(80),
  description: optionalString(5000),
  ownerId: optionalString(30),
  tagIds: z.array(z.string().max(30)).max(25).optional(),
  properties: propertiesInput,
});

export const companyUpdateSchema = companyInputSchema.partial();

export const leadInputSchema = z.object({
  firstName: optionalString(80),
  lastName: optionalString(80),
  email: optionalEmail,
  phone: optionalString(40),
  companyName: optionalString(160),
  jobTitle: optionalString(120),
  source: optionalString(80),
  status: z.string().trim().min(1).max(48),
  score: optionalNumber(0, 100),
  qualification: optionalString(5000),
  nextStepAt: optionalDate,
  ownerId: optionalString(30),
  contactId: optionalString(30),
  companyId: optionalString(30),
  properties: propertiesInput,
});

export const leadUpdateSchema = leadInputSchema.partial();

export const dealInputSchema = z.object({
  name: z.string().trim().min(1, "Dealname ist erforderlich.").max(160),
  pipelineId: z.string().min(1, "Pipeline ist erforderlich.").max(30),
  stageId: z.string().min(1, "Stage ist erforderlich.").max(30),
  amount: z.coerce.number().min(0).max(1_000_000_000_000).default(0),
  currency: z.string().length(3).default("EUR"),
  probability: optionalNumber(0, 100),
  expectedCloseDate: optionalDate,
  companyId: optionalString(30),
  contactIds: z.array(z.string().max(30)).max(50).optional(),
  source: optionalString(80),
  description: optionalString(5000),
  ownerId: optionalString(30),
  tagIds: z.array(z.string().max(30)).max(25).optional(),
  properties: propertiesInput,
});

export const dealUpdateSchema = dealInputSchema.partial().extend({
  lostReason: optionalString(500),
});

export const dealStageChangeSchema = z.object({
  stageId: z.string().min(1).max(30),
  lostReason: optionalString(500),
});

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Titel ist erforderlich.").max(200),
  description: optionalString(5000),
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).default("OPEN"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueAt: optionalDate,
  remindAt: optionalDate,
  ownerId: optionalString(30),
  contactId: optionalString(30),
  companyId: optionalString(30),
  dealId: optionalString(30),
  leadId: optionalString(30),
});

export const taskUpdateSchema = taskInputSchema.partial();

export const activityInputSchema = z.object({
  type: z.enum(["CALL", "EMAIL", "MEETING", "NOTE", "TASK"]),
  subject: optionalString(200),
  body: optionalString(10_000),
  direction: z.enum(["INBOUND", "OUTBOUND"]).optional(),
  outcome: optionalString(120),
  durationMinutes: optionalNumber(0, 24 * 60),
  occurredAt: dateValue.optional(),
  contactId: optionalString(30),
  companyId: optionalString(30),
  dealId: optionalString(30),
  leadId: optionalString(30),
});

export const noteInputSchema = z.object({
  body: z.string().trim().min(1, "Die Notiz darf nicht leer sein.").max(20_000),
  contactId: optionalString(30),
  companyId: optionalString(30),
  dealId: optionalString(30),
  leadId: optionalString(30),
});

export const meetingInputSchema = z
  .object({
    title: z.string().trim().min(1, "Titel ist erforderlich.").max(200),
    description: optionalString(5000),
    startAt: dateValue,
    endAt: dateValue,
    location: optionalString(200),
    meetingUrl: optionalUrl,
    status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]).default("SCHEDULED"),
    ownerId: optionalString(30),
    contactId: optionalString(30),
    companyId: optionalString(30),
    dealId: optionalString(30),
    attendeeContactIds: z.array(z.string().max(30)).max(50).optional(),
    attendeeUserIds: z.array(z.string().max(30)).max(50).optional(),
  })
  .refine((value) => value.endAt > value.startAt, {
    message: "Das Ende muss nach dem Beginn liegen.",
    path: ["endAt"],
  });

export const meetingUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: optionalString(5000),
  startAt: dateValue.optional(),
  endAt: dateValue.optional(),
  location: optionalString(200),
  meetingUrl: optionalUrl,
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]).optional(),
  ownerId: optionalString(30),
  contactId: optionalString(30),
  companyId: optionalString(30),
  dealId: optionalString(30),
});

export type ContactInput = z.infer<typeof contactInputSchema>;
export type CompanyInput = z.infer<typeof companyInputSchema>;
export type LeadInput = z.infer<typeof leadInputSchema>;
export type DealInput = z.infer<typeof dealInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type ActivityInput = z.infer<typeof activityInputSchema>;
export type NoteInput = z.infer<typeof noteInputSchema>;
export type MeetingInput = z.infer<typeof meetingInputSchema>;

import type { CrmObjectType } from "@/generated/prisma/enums";
import type { FilterFieldType } from "@/lib/filters";

/**
 * Field registry — one definition per built-in CRM field.
 *
 * This registry is the single source for table columns, the filter builder,
 * sorting, CSV import mapping and exports. Adding a field here makes it
 * available everywhere instead of in five places.
 */
export type CrmField = {
  key: string;
  label: string;
  type: FilterFieldType;
  /** Prisma where/orderBy path when it differs from `key`. */
  path?: string;
  filterable?: boolean;
  sortable?: boolean;
  /** Available as a CSV import target. */
  importable?: boolean;
  /** Shown by default in the list view. */
  defaultVisible?: boolean;
  /** Values come from an administrable option set. */
  optionSource?: "lifecycleStage" | "leadStatus" | "dealStatus" | "owner" | "pipeline" | "stage" | "company";
  width?: number;
};

const OWNER: CrmField = {
  key: "ownerId",
  label: "Owner",
  type: "id",
  filterable: true,
  sortable: false,
  defaultVisible: true,
  optionSource: "owner",
};

const CREATED_AT: CrmField = {
  key: "createdAt",
  label: "Erstellt am",
  type: "datetime",
  filterable: true,
  sortable: true,
  defaultVisible: false,
};

const LAST_ACTIVITY: CrmField = {
  key: "lastActivityAt",
  label: "Letzte Aktivität",
  type: "datetime",
  filterable: true,
  sortable: true,
  defaultVisible: true,
};

const CONTACT_FIELDS: CrmField[] = [
  { key: "firstName", label: "Vorname", type: "string", filterable: true, sortable: true, importable: true },
  {
    key: "lastName",
    label: "Nachname",
    type: "string",
    filterable: true,
    sortable: true,
    importable: true,
    defaultVisible: true,
  },
  { key: "email", label: "E-Mail", type: "string", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "phone", label: "Telefon", type: "string", filterable: true, importable: true, defaultVisible: true },
  { key: "mobile", label: "Mobil", type: "string", filterable: true, importable: true },
  { key: "jobTitle", label: "Position", type: "string", filterable: true, importable: true },
  {
    key: "companyId",
    label: "Unternehmen",
    type: "id",
    filterable: true,
    defaultVisible: true,
    optionSource: "company",
  },
  {
    key: "lifecycleStage",
    label: "Lifecycle Stage",
    type: "enum",
    filterable: true,
    sortable: true,
    importable: true,
    defaultVisible: true,
    optionSource: "lifecycleStage",
  },
  {
    key: "leadStatus",
    label: "Lead-Status",
    type: "enum",
    filterable: true,
    sortable: true,
    importable: true,
    optionSource: "leadStatus",
  },
  { key: "source", label: "Quelle", type: "string", filterable: true, importable: true },
  { key: "city", label: "Stadt", type: "string", filterable: true, importable: true },
  { key: "country", label: "Land", type: "string", filterable: true, importable: true },
  { key: "postalCode", label: "PLZ", type: "string", filterable: true, importable: true },
  { key: "street", label: "Straße", type: "string", filterable: true, importable: true },
  { key: "linkedinUrl", label: "LinkedIn", type: "string", filterable: true, importable: true },
  OWNER,
  LAST_ACTIVITY,
  { key: "nextActivityAt", label: "Nächster Termin", type: "datetime", filterable: true, sortable: true, defaultVisible: true },
  CREATED_AT,
];

const COMPANY_FIELDS: CrmField[] = [
  { key: "name", label: "Unternehmen", type: "string", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "domain", label: "Domain", type: "string", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "industry", label: "Branche", type: "string", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "employeeCount", label: "Mitarbeiter", type: "number", filterable: true, sortable: true, importable: true },
  { key: "annualRevenue", label: "Jahresumsatz", type: "currency", filterable: true, sortable: true, importable: true },
  { key: "phone", label: "Telefon", type: "string", filterable: true, importable: true, defaultVisible: true },
  { key: "email", label: "E-Mail", type: "string", filterable: true, importable: true },
  { key: "website", label: "Website", type: "string", filterable: true, importable: true },
  { key: "city", label: "Stadt", type: "string", filterable: true, importable: true, defaultVisible: true },
  { key: "country", label: "Land", type: "string", filterable: true, importable: true },
  { key: "postalCode", label: "PLZ", type: "string", filterable: true, importable: true },
  { key: "street", label: "Straße", type: "string", filterable: true, importable: true },
  {
    key: "lifecycleStage",
    label: "Lifecycle Stage",
    type: "enum",
    filterable: true,
    sortable: true,
    importable: true,
    optionSource: "lifecycleStage",
  },
  { key: "source", label: "Quelle", type: "string", filterable: true, importable: true },
  OWNER,
  LAST_ACTIVITY,
  CREATED_AT,
];

const LEAD_FIELDS: CrmField[] = [
  { key: "firstName", label: "Vorname", type: "string", filterable: true, sortable: true, importable: true },
  { key: "lastName", label: "Nachname", type: "string", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "email", label: "E-Mail", type: "string", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "phone", label: "Telefon", type: "string", filterable: true, importable: true },
  { key: "companyName", label: "Unternehmen", type: "string", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "jobTitle", label: "Position", type: "string", filterable: true, importable: true },
  {
    key: "status",
    label: "Status",
    type: "enum",
    filterable: true,
    sortable: true,
    importable: true,
    defaultVisible: true,
    optionSource: "leadStatus",
  },
  { key: "source", label: "Quelle", type: "string", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "score", label: "Bewertung", type: "number", filterable: true, sortable: true, importable: true, defaultVisible: true },
  { key: "nextStepAt", label: "Nächster Schritt", type: "datetime", filterable: true, sortable: true, defaultVisible: true },
  OWNER,
  LAST_ACTIVITY,
  CREATED_AT,
];

const DEAL_FIELDS: CrmField[] = [
  { key: "name", label: "Deal", type: "string", filterable: true, sortable: true, defaultVisible: true },
  { key: "amount", label: "Wert", type: "currency", filterable: true, sortable: true, defaultVisible: true },
  { key: "companyId", label: "Unternehmen", type: "id", filterable: true, defaultVisible: true, optionSource: "company" },
  { key: "pipelineId", label: "Pipeline", type: "id", filterable: true, optionSource: "pipeline" },
  { key: "stageId", label: "Stage", type: "id", filterable: true, defaultVisible: true, optionSource: "stage" },
  { key: "status", label: "Status", type: "enum", filterable: true, sortable: true, optionSource: "dealStatus" },
  { key: "probability", label: "Wahrscheinlichkeit", type: "number", filterable: true, sortable: true },
  {
    key: "expectedCloseDate",
    label: "Erwarteter Abschluss",
    type: "date",
    filterable: true,
    sortable: true,
    defaultVisible: true,
  },
  { key: "closedAt", label: "Abgeschlossen am", type: "datetime", filterable: true, sortable: true },
  { key: "source", label: "Quelle", type: "string", filterable: true },
  OWNER,
  LAST_ACTIVITY,
  CREATED_AT,
];

export const CRM_FIELDS: Record<CrmObjectType, CrmField[]> = {
  CONTACT: CONTACT_FIELDS,
  COMPANY: COMPANY_FIELDS,
  LEAD: LEAD_FIELDS,
  DEAL: DEAL_FIELDS,
};

export const OBJECT_LABELS: Record<CrmObjectType, { singular: string; plural: string; path: string }> = {
  CONTACT: { singular: "Kontakt", plural: "Kontakte", path: "/contacts" },
  COMPANY: { singular: "Unternehmen", plural: "Unternehmen", path: "/companies" },
  LEAD: { singular: "Lead", plural: "Leads", path: "/leads" },
  DEAL: { singular: "Deal", plural: "Deals", path: "/deals" },
};

export function fieldsFor(objectType: CrmObjectType): CrmField[] {
  return CRM_FIELDS[objectType];
}

export function findField(objectType: CrmObjectType, key: string): CrmField | undefined {
  return CRM_FIELDS[objectType].find((field) => field.key === key);
}

export function defaultColumns(objectType: CrmObjectType): string[] {
  return CRM_FIELDS[objectType].filter((field) => field.defaultVisible).map((field) => field.key);
}

/** Free-text search targets per object — used by list search and global search. */
export const SEARCH_FIELDS: Record<CrmObjectType, string[]> = {
  CONTACT: ["firstName", "lastName", "email", "phone", "mobile", "jobTitle"],
  COMPANY: ["name", "domain", "industry", "city", "email", "phone"],
  LEAD: ["firstName", "lastName", "email", "companyName", "phone"],
  DEAL: ["name", "description"],
};

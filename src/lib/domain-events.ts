/**
 * Domain event catalogue.
 *
 * Kept free of database imports so the webhook settings screen and other client
 * components can list the available events. The dispatcher lives in
 * `src/lib/events.ts`.
 */
export const DOMAIN_EVENTS = [
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "company.created",
  "company.updated",
  "company.deleted",
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.converted",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "deal.deleted",
  "task.created",
  "task.completed",
  "meeting.created",
] as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[number];


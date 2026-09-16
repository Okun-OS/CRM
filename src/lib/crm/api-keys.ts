/**
 * API-key vocabulary, kept free of database imports so the settings screen can
 * render the scope list in a client component.
 */
export const API_KEY_SCOPES = ["events:write", "scheduler:run"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "events:write": "Ereignisse melden (z. B. aus OKUN Deals)",
  "scheduler:run": "Geplante Automationen ausführen",
};

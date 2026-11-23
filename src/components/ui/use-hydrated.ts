"use client";

import * as React from "react";

/**
 * Erst nach dem Laden im Browser wahr. Für Zeitpunkte: Der Server rechnet in
 * UTC, der Browser in Ortszeit — vorher formatiert, passten erste Darstellung
 * und Browser nicht zusammen (React-Fehler 418).
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  return hydrated;
}

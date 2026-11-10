/**
 * Datum + Uhrzeit zwischen Eingabefeld und Server.
 *
 * `<input type="datetime-local">` kennt keine Zeitzone: „2026-11-10T09:00“
 * meint 9 Uhr Ortszeit des Browsers. Ging dieser Text unverändert an den
 * Server (der in UTC läuft), wurde daraus 9 Uhr UTC — in Deutschland also
 * 10 Uhr. Deshalb wird hier umgerechnet: Gespeichert und übertragen wird
 * immer ein ISO-Zeitpunkt mit Zone, angezeigt die Ortszeit.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** ISO-Zeitpunkt (oder Date) → Wert für `datetime-local` in Ortszeit. */
export function toLocalInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Wert aus `datetime-local` (Ortszeit) → ISO-Zeitpunkt mit Zone, leer → null. */
export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

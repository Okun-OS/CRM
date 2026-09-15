/**
 * RFC 4180-style CSV parsing and serialisation.
 *
 * Implemented in-house rather than pulled in as a dependency because the import
 * pipeline needs precise control over delimiter detection, quoted newlines and
 * row limits — and because this is the one place where malformed customer data
 * arrives.
 */
export type ParsedCsv = { headers: string[]; rows: string[][]; delimiter: string };

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];

/** Picks the delimiter that yields the most consistent column count. */
export function detectDelimiter(sample: string): string {
  const firstLines = sample.split(/\r?\n/).slice(0, 5).filter(Boolean);
  let best = ",";
  let bestScore = -1;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = firstLines.map((line) => splitLine(line, delimiter).length);
    if (counts.length === 0) continue;
    const columns = counts[0];
    if (columns < 2) continue;
    const consistent = counts.every((count) => count === columns);
    const score = (consistent ? 100 : 0) + columns;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function splitLine(line: string, delimiter: string): string[] {
  return parseCsv(line, { delimiter, limit: 1, hasHeader: false }).rows[0] ?? [];
}

export function parseCsv(
  input: string,
  options: { delimiter?: string; limit?: number; hasHeader?: boolean } = {},
): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const hasHeader = options.hasHeader ?? true;
  const limit = options.limit ?? 50_000;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field.trim());
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === "") {
      inQuotes = true;
      field = "";
      continue;
    }
    if (char === delimiter) {
      pushField();
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      pushRow();
      if (rows.length > limit + 1) break;
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) pushRow();

  const headers = hasHeader ? (rows.shift() ?? []) : [];
  return { headers, rows: rows.slice(0, limit), delimiter };
}

/** Serialises rows for export, quoting every value that needs it. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][], delimiter = ","): string {
  const escape = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /["\n\r]|[,;\t|]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [headers.map(escape).join(delimiter)];
  for (const row of rows) lines.push(row.map(escape).join(delimiter));
  return `${lines.join("\r\n")}\r\n`;
}

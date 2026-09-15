/**
 * Minimal structured logger.
 *
 * Errors are logged server-side with context; request payloads, passwords,
 * tokens and integration secrets are never logged.
 */
type Fields = Record<string, unknown>;

const REDACTED_KEYS = /^(password|passwordHash|token|secret|secretCipher|csrfToken|authorization)$/i;

function clean(fields: Fields = {}): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = REDACTED_KEYS.test(key) ? "[redacted]" : value;
  }
  return out;
}

function emit(level: "info" | "warn" | "error", event: string, fields: Fields) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...clean(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logInfo(event: string, fields?: Fields) {
  emit("info", event, fields ?? {});
}

export function logWarn(event: string, fields?: Fields) {
  emit("warn", event, fields ?? {});
}

export function logError(event: string, error: unknown, fields?: Fields) {
  const detail =
    error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  emit("error", event, { ...fields, ...detail });
}

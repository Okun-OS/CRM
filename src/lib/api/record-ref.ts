import { ValidationError } from "./errors";
import type { SubjectRef } from "@/server/engine/subject";

/** Parses the `/records/{kind}/{id}` path segments used by the engine routes. */
export function parseRecordRef(params: { kind: string; id: string }): SubjectRef {
  const kind = params.kind.toUpperCase();
  if (kind !== "DEAL" && kind !== "LEAD") {
    throw ValidationError("Unbekannter Datensatztyp. Erlaubt sind „deal“ und „lead“.");
  }
  if (!params.id) throw ValidationError("Es wurde kein Datensatz angegeben.");
  return { kind, id: params.id };
}

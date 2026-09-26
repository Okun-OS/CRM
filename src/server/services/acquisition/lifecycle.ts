import type { ProspectStage } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/api/errors";

/**
 * Der Lebenszyklus eines Prospects.
 *
 * Die Übergänge sind geprüft, weil einige von ihnen etwas bedeuten, das sich
 * nicht zurücknehmen lässt: `CONVERTED` erreicht man nur über die
 * Konvertierung, `DO_NOT_CONTACT` von überall und praktisch endgültig.
 */
export const PROSPECT_STAGE_LABELS: Record<ProspectStage, string> = {
  NEW: "Neu",
  RESEARCHING: "In Recherche",
  QUALIFIED: "Qualifiziert",
  READY: "Bereit zur Ansprache",
  IN_SEQUENCE: "In Sequenz",
  REPLIED: "Hat geantwortet",
  INTERESTED: "Interessiert",
  NOT_INTERESTED: "Kein Interesse",
  MEETING: "Termin",
  CONVERTED: "Übernommen",
  DISQUALIFIED: "Aussortiert",
  DO_NOT_CONTACT: "Keine Kontaktaufnahme",
};

/** Stufen, in denen eine Ansprache überhaupt in Frage kommt. */
export const CONTACTABLE_STAGES: ProspectStage[] = ["READY", "IN_SEQUENCE"];

/** Endstufen — von hier führt nur noch die Kontaktsperre weiter. */
const TERMINAL: ProspectStage[] = ["CONVERTED", "DISQUALIFIED", "DO_NOT_CONTACT"];

const ALLOWED: Record<ProspectStage, ProspectStage[]> = {
  NEW: ["RESEARCHING", "QUALIFIED", "READY", "DISQUALIFIED"],
  RESEARCHING: ["QUALIFIED", "READY", "DISQUALIFIED", "NEW"],
  QUALIFIED: ["READY", "RESEARCHING", "DISQUALIFIED"],
  READY: ["IN_SEQUENCE", "QUALIFIED", "DISQUALIFIED"],
  IN_SEQUENCE: ["REPLIED", "READY", "NOT_INTERESTED", "DISQUALIFIED"],
  REPLIED: ["INTERESTED", "NOT_INTERESTED", "MEETING", "DISQUALIFIED"],
  INTERESTED: ["MEETING", "NOT_INTERESTED", "DISQUALIFIED"],
  NOT_INTERESTED: ["RESEARCHING", "DISQUALIFIED"],
  MEETING: ["INTERESTED", "NOT_INTERESTED", "DISQUALIFIED"],
  CONVERTED: [],
  DISQUALIFIED: ["RESEARCHING", "NEW"],
  DO_NOT_CONTACT: [],
};

export function isTerminal(stage: ProspectStage): boolean {
  return TERMINAL.includes(stage);
}

/**
 * Prüft einen Stufenwechsel von Hand.
 *
 * `CONVERTED` fehlt in jeder Liste mit Absicht: Diese Stufe setzt allein die
 * Konvertierung, weil sie bedeutet, dass ein Kontakt entstanden ist. Wer sie
 * von Hand setzen könnte, erzeugte eine Attribution ohne Datensatz dahinter.
 */
export function assertStageTransition(from: ProspectStage, to: ProspectStage): void {
  if (from === to) return;

  // Die Kontaktsperre gilt von überall — sie ist ein Wunsch des Gegenübers,
  // keine Vertriebsstufe.
  if (to === "DO_NOT_CONTACT") return;

  if (to === "CONVERTED") {
    throw ValidationError(
      "Diese Stufe entsteht durch die Übernahme ins CRM und lässt sich nicht von Hand setzen.",
    );
  }

  if (from === "DO_NOT_CONTACT") {
    throw ValidationError(
      "Für diesen Datensatz wurde eine Kontaktsperre gesetzt. Sie muss zuerst aufgehoben werden.",
    );
  }

  if (from === "CONVERTED") {
    throw ValidationError("Ein übernommener Prospect lässt sich nicht zurückstufen.");
  }

  if (!ALLOWED[from].includes(to)) {
    throw ValidationError(
      `Der Wechsel von „${PROSPECT_STAGE_LABELS[from]}" nach „${PROSPECT_STAGE_LABELS[to]}" ist nicht vorgesehen.`,
    );
  }
}

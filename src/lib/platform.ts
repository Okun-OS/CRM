import { Forbidden, Unauthenticated } from "./api/errors";

/**
 * Die Betreiber-Ebene (OKUN Software).
 *
 * Sie ist bewusst ein eigener Aktor-Typ und **kein** Sonderfall von
 * `ActorContext`: Ein Betreiber verwaltet Mandanten, er arbeitet nicht in
 * einem. Dadurch kann kein Service, der einen `ActorContext` erwartet,
 * versehentlich mit Betreiberrechten aufgerufen werden — die
 * Mandantentrennung bleibt unangetastet.
 *
 * Was diese Ebene darf, steht abschließend in `src/server/services/platform.ts`:
 * Organisationen anlegen, auflisten, stilllegen und reaktivieren sowie deren
 * Mitglieder verwalten. Sie darf **keine** CRM-Inhalte einer Organisation
 * lesen — Kennzahlen ja, Kontakte, Deals und Notizen nein.
 */
export type PlatformActor = {
  userId: string;
  email: string;
  name: string;
  ip?: string;
  userAgent?: string;
};

export function assertPlatformActor(actor: PlatformActor | null): PlatformActor {
  if (!actor) throw Unauthenticated("Für diesen Bereich ist eine Anmeldung erforderlich.");
  return actor;
}

export function forbidPlatformAccess(): never {
  throw Forbidden("Dieser Bereich ist der Betreiberverwaltung vorbehalten.");
}

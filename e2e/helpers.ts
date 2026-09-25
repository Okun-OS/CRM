import type { Page } from "@playwright/test";

/**
 * Schließt die Produkttour, falls sie läuft.
 *
 * Ein frisch angelegtes Konto bekommt die Einführung automatisch — für einen
 * Menschen richtig, für einen Test im Weg. Geschlossen wird sie hier genauso
 * wie von Hand, mit Esc, statt sie über eine Hintertür abzuschalten: So prüft
 * jeder Testlauf nebenbei mit, dass sie sich wegklicken lässt.
 */
export async function dismissTour(page: Page) {
  const card = page.locator(".okun-tour-card");
  // Kurz warten: Die Tour fragt ihren Zustand beim Server ab und erscheint
  // deshalb erst nach dem ersten Rendern.
  await card.waitFor({ state: "visible", timeout: 4000 }).catch(() => undefined);
  if ((await card.count()) === 0) return;
  await page.keyboard.press("Escape");
  await card.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
}

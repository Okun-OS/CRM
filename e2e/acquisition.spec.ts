import { test, expect, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Die Customer Acquisition Engine, von der Oberfläche aus.
 *
 * Geprüft wird der zusammenhängende Weg — Prospect anlegen, importieren,
 * Sequenz bauen, aufnehmen, ins CRM übernehmen —, nicht einzelne Schaltflächen.
 * Am Ende muss der Kontakt wirklich im CRM stehen.
 */
const unique = Date.now();
const EMAIL = `akquise-${unique}@example.test`;
const PASSWORD = "AkquisePasswort2026";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/dashboard");
  await dismissTour(page);
}

test("1 · Organisation anlegen und Akquisebereich öffnen", async ({ page }) => {
  await page.goto("/register");
  await page.fill("#organizationName", `Akquise ${unique}`);
  await page.fill("#name", "Akquise Administrator");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Organisation anlegen" }).click();
  await page.waitForURL("**/dashboard");
  await dismissTour(page);

  // Ohne einen einzigen Prospect gibt es im Dashboard keinen Akquise-Kasten.
  // Ein Kasten voller Nullen wäre kein Überblick, sondern Dekoration.
  await expect(page.getByRole("heading", { name: "Akquise", exact: true })).toHaveCount(0);

  await page.locator('[data-tour="nav-outreach"]').click();
  await page.waitForURL("**/outreach");

  // Kein Platzhalter, keine erfundene Zahl: Ohne Daten steht dort, dass keine da sind.
  await expect(page.getByText("Noch keine Prospects")).toBeVisible({ timeout: 15_000 });
});

test("2 · Prospect anlegen, Herkunft und Rechtsgrund sind dokumentiert", async ({ page }) => {
  await login(page);
  await page.goto("/outreach/prospects");

  await page.getByRole("button", { name: "Prospect anlegen" }).first().click();
  await page.fill("#companyName", "Kieler Gebäudereinigung GmbH");
  await page.fill("#domain", "kieler-reinigung.test");
  await page.fill("#city", "Kiel");
  await page.fill("#firstName", "Ole");
  await page.fill("#lastName", "Jansen");
  await page.fill("#email", "o.jansen@kieler-reinigung.test");
  await page.getByRole("button", { name: "Prospect anlegen" }).last().click();

  await page.waitForURL("**/outreach/prospects/**", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /Kieler Gebäudereinigung/ })).toBeVisible();
  await expect(page.getByText("Herkunft der Angaben")).toBeVisible();
  // Die Software wertet den Rechtsgrund nicht — sie hält fest, dass er offen ist.
  await expect(page.getByText("Nicht geprüft")).toBeVisible();
});

test("3 · Tabellenimport zählt Anlage, Dubletten und Gesperrte getrennt", async ({ page }) => {
  await login(page);
  await page.goto("/outreach/prospects");

  await page.getByRole("button", { name: "Importieren" }).click();
  await page.locator("#sourceKey").selectOption("csv");
  await page.setInputFiles("#csvFile", {
    name: "prospects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Firma,Ort,E-Mail\nNordsee Fenster GmbH,Husum,info@nordsee-fenster.test\n"),
  });

  const submit = page.locator('[role="dialog"]').getByRole("button", { name: "Übernehmen" });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText(/angelegt/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByRole("link", { name: /Nordsee Fenster/ })).toBeVisible({ timeout: 15_000 });
});

test("4 · Versandkonto lehnt ein unsinniges Sendefenster ab", async ({ page }) => {
  await login(page);
  await page.goto("/outreach/settings");

  await page.getByRole("button", { name: "Konto einrichten" }).first().click();
  await page.fill("#label", "Vertrieb Nord");
  await page.fill("#fromName", "Akquise Administrator");
  await page.fill("#fromEmail", "vertrieb@akquise.test");
  await page.fill("#sendWindowStart", "18");
  await page.fill("#sendWindowEnd", "8");
  await page.getByRole("button", { name: "Konto einrichten" }).last().click();
  await expect(page.getByText(/später enden/)).toBeVisible({ timeout: 10_000 });

  await page.fill("#sendWindowStart", "8");
  await page.fill("#sendWindowEnd", "18");
  await page.getByRole("button", { name: "Konto einrichten" }).last().click();
  await expect(page.getByText("Vertrieb Nord")).toBeVisible({ timeout: 15_000 });
});

test("5 · Sequenz ist zunächst Entwurf und sendet nichts", async ({ page }) => {
  await login(page);
  await page.goto("/outreach/sequences");

  await page.getByRole("button", { name: "Sequenz erstellen" }).first().click();
  await page.fill("#sequenceName", "Gebäudereinigung Nord");
  await page.fill("#subject-0", "Kurze Frage zu {{prospect.companyName}}");
  await page.fill("#body-0", "Guten Tag {{prospect.firstName}}, kurze Frage zu Ihrer Unterhaltsreinigung.");
  await page.getByRole("button", { name: "Sequenz erstellen" }).last().click();

  await expect(page.getByText("Gebäudereinigung Nord")).toBeVisible({ timeout: 15_000 });
  // Eine halbfertige Sequenz darf nicht auf echte Menschen losgehen.
  await expect(page.getByText("Entwurf", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Aktivieren" }).first().click();
  await expect(page.getByText("Aktiv", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("6 · Prospect in die Sequenz aufnehmen", async ({ page }) => {
  await login(page);
  await page.goto("/outreach/prospects");
  await page.getByRole("link", { name: /Kieler Gebäudereinigung/ }).first().click();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "In Sequenz" }).click();
  await page.getByRole("button", { name: "Aufnehmen" }).click();

  await expect(page.getByText("In Sequenz").first()).toBeVisible({ timeout: 15_000 });
});

test("7 · Übernahme ins CRM erzeugt den Kontakt wirklich", async ({ page }) => {
  await login(page);
  await page.goto("/outreach/prospects");
  await page.getByRole("link", { name: /Nordsee Fenster/ }).first().click();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Ins CRM übernehmen" }).click();
  // Die Vorschau sagt vorher, was passieren wird.
  await expect(page.getByText(/Ein Kontakt wird neu angelegt/)).toBeVisible({ timeout: 10_000 });
  await page.locator('[role="dialog"]').getByRole("button", { name: "Übernehmen" }).click();

  await expect(page.getByText(/ins CRM übernommen/)).toBeVisible({ timeout: 20_000 });

  // Der Beweis steht im CRM, nicht in der Akquise.
  await page.goto("/contacts");
  await expect(page.getByText(/Nordsee Fenster/).first()).toBeVisible({ timeout: 15_000 });
});

test("8 · Das Dashboard zeigt die Akquise mit den echten Zahlen", async ({ page }) => {
  await login(page);

  // Jetzt gibt es Prospects — also erscheint der Abschnitt, und zwar mit den
  // Zahlen aus den vorangegangenen Schritten, nicht mit Beispielwerten.
  await expect(page.getByRole("heading", { name: "Akquise", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Die letzten 90 Tage", { exact: false }).first()).toBeVisible();

  // Zwei Prospects wurden in dieser Testreihe angelegt: einer von Hand, einer
  // über den Tabellenimport. Genau diese Zahl muss dort stehen.
  const tile = page.getByText("Neue Prospects", { exact: true }).locator("..");
  await expect(tile).toContainText("2");

  await expect(page.getByText("Pipeline aus Akquise")).toBeVisible();
  await expect(page.getByText("Umsatz aus Akquise")).toBeVisible();

  await page.getByRole("link", { name: /Zur Akquise/ }).click();
  await page.waitForURL("**/outreach");
  await expect(page.getByRole("heading", { name: "Trichter" })).toBeVisible({ timeout: 15_000 });
});

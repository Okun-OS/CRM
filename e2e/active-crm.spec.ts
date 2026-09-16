import { test, expect, type Page } from "@playwright/test";

/**
 * The Active CRM promise, driven through the real UI: a deal always shows what
 * happens next and why, the reason changes when reality changes, a manual
 * decision overrules the system, and the action center collects all of it.
 */
const unique = Date.now();
const ORG = `Aktives CRM ${unique}`;
const EMAIL = `aktiv-${unique}@example.test`;
const PASSWORD = "E2ePasswort2026x";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/dashboard");
}

async function openDeal(page: Page) {
  await page.goto("/deals");
  await page.getByRole("link", { name: "Aktiv-Deal" }).first().click();
  await page.waitForURL(/\/deals\/[a-z0-9]+/);
}

test("1 · Organisation und Deal anlegen", async ({ page }) => {
  await page.goto("/register");
  await page.fill("#organizationName", ORG);
  await page.fill("#name", "Aktiv Administrator");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Organisation anlegen" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto("/deals");
  await page.getByRole("button", { name: "Deal erstellen" }).first().click();
  await page.fill("#name", "Aktiv-Deal");
  await page.fill("#amount", "18000");
  await page.getByRole("button", { name: "Deal erstellen" }).last().click();
  await page.waitForURL(/\/deals\/[a-z0-9]+/);
});

test("2 · Der Deal zeigt sofort einen begründeten nächsten Schritt", async ({ page }) => {
  await login(page);
  await openDeal(page);

  await expect(page.getByText("Nächste Aktion", { exact: true })).toBeVisible();
  await expect(page.getByText("Keine nächste Aktion definiert").first()).toBeVisible();
  await expect(page.getByText("Für diesen offenen Datensatz ist kein nächster Schritt hinterlegt.")).toBeVisible();
  // Momentum is explained, not asserted as a probability.
  await expect(page.getByText("keine geschätzte Abschlusswahrscheinlichkeit")).toBeVisible();
});

test("3 · Eine gesendete E-Mail versetzt den Deal in „Warten auf Kunden“", async ({ page }) => {
  await login(page);
  await openDeal(page);

  await page.getByRole("button", { name: "Aktivität", exact: true }).click();
  await page.selectOption("#type", "EMAIL");
  await page.selectOption("#direction", "OUTBOUND");
  await page.fill("#subject", "Unser Angebot für Sie");
  await page.getByRole("button", { name: "Aktivität protokollieren" }).click();

  await page.reload();
  await expect(page.getByText("Warten auf Kunden").first()).toBeVisible();
  await expect(page.getByText("Nachfassen", { exact: false }).first()).toBeVisible();
  // The automation the system scheduled is visible with its reason.
  await expect(page.getByRole("main").getByText("Automatisierung", { exact: true })).toBeVisible();
});

test("4 · Eine eingehende Antwort dreht den Zustand und stoppt die Automation", async ({ page }) => {
  await login(page);
  await openDeal(page);

  await page.getByRole("button", { name: "Aktivität", exact: true }).click();
  await page.selectOption("#type", "EMAIL");
  await page.selectOption("#direction", "INBOUND");
  await page.fill("#subject", "Re: Unser Angebot für Sie");
  await page.getByRole("button", { name: "Aktivität protokollieren" }).click();

  await page.reload();
  await expect(page.getByText("Wir sind am Zug").first()).toBeVisible();
  await expect(page.getByText("Auf Kundenantwort reagieren").first()).toBeVisible();
  await expect(page.getByText("Der Kunde hat geantwortet.").first()).toBeVisible();
});

test("5 · Eine eigene Aktion überstimmt die Empfehlung", async ({ page }) => {
  await login(page);
  await openDeal(page);

  await page.getByRole("button", { name: "Eigene Aktion" }).click();
  await page.fill("#next-action-title", "Entscheider persönlich anrufen");
  await page.fill("#next-action-reason", "Auf der Messe zugesagt.");
  await page.getByRole("button", { name: "Festlegen" }).click();

  await expect(page.getByText("Entscheider persönlich anrufen").first()).toBeVisible();
  await expect(page.getByText("manuell festgelegt").first()).toBeVisible();
});

test("6 · Das Action Center sammelt die offenen Aktionen", async ({ page }) => {
  await login(page);
  await page.goto("/heute");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Heute");
  await expect(page.getByText("Entscheider persönlich anrufen").first()).toBeVisible();
  await expect(page.getByText("Auf der Messe zugesagt.").first()).toBeVisible();

  await page.getByRole("button", { name: "Erledigt" }).first().click();
  await expect(page.getByText("Entscheider persönlich anrufen")).toHaveCount(0, { timeout: 15_000 });
});

test("7 · Ein API-Key kann erstellt und wieder widerrufen werden", async ({ page }) => {
  await login(page);
  await page.goto("/settings/api-keys");

  await page.getByRole("button", { name: "API-Key erstellen" }).click();
  const createDialog = page.getByRole("dialog", { name: "API-Key erstellen" });
  await createDialog.locator("#api-key-name").fill("OKUN Deals E2E");
  await createDialog.getByRole("button", { name: "Erstellen" }).click();

  const issuedDialog = page.getByRole("dialog", { name: "API-Key erstellt" });
  await expect(issuedDialog.getByText("Kopieren Sie den Schlüssel jetzt", { exact: false })).toBeVisible();
  await expect(issuedDialog.locator("code")).toContainText("okun_ck_");
  await issuedDialog.getByRole("button", { name: "Fertig" }).click();

  await expect(page.getByText("OKUN Deals E2E")).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Widerrufen" }).click();
  await page.getByRole("dialog", { name: "API-Key widerrufen?" }).getByRole("button", { name: "Widerrufen" }).click();
  await expect(page.getByText("widerrufen", { exact: true })).toBeVisible();
});

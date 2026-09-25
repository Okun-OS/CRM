import { test, expect, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * The core journey a new customer walks through on day one: register the
 * organization, create the first records, move a deal, capture context and find
 * things again. If this passes, the product works end to end.
 */
const unique = Date.now();
const ORG = `E2E Organisation ${unique}`;
const EMAIL = `e2e-${unique}@example.test`;
const PASSWORD = "E2ePasswort2026x";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/dashboard");
  await dismissTour(page);
}

test("1 · Organisation registrieren und Dashboard sehen", async ({ page }) => {
  await page.goto("/register");

  await page.fill("#organizationName", ORG);
  await page.fill("#name", "E2E Administrator");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Organisation anlegen" }).click();

  await page.waitForURL("**/dashboard");
  await dismissTour(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E");

  // Branding is present in the shell, not only on the login screen.
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toContainText("Powered by");
  // The setup checklist reflects the empty organization.
  await expect(page.getByText("OKUN CRM einrichten")).toBeVisible();
});

test("2 · Unternehmen und Kontakt anlegen und verknüpfen", async ({ page }) => {
  await login(page);

  await page.goto("/companies");
  await page.getByRole("button", { name: "Unternehmen erstellen" }).first().click();
  await page.fill("#name", "E2E Handels GmbH");
  await page.fill("#domain", "e2e-handel.de");
  await page.fill("#industry", "Großhandel");
  await page.getByRole("button", { name: "Unternehmen erstellen" }).last().click();
  await page.waitForURL(/\/companies\/[a-z0-9]+/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Handels GmbH");

  await page.goto("/contacts");
  await page.getByRole("button", { name: "Kontakt erstellen" }).first().click();
  await page.fill("#firstName", "Petra");
  await page.fill("#lastName", "Prüfer");
  await page.fill("#email", "petra.pruefer@e2e-handel.de");
  await page.fill("#jobTitle", "Einkaufsleiterin");
  await page.getByPlaceholder("Unternehmen suchen…").fill("E2E Handels");
  await expect(page.locator("#companyId option", { hasText: "E2E Handels GmbH" })).toHaveCount(1, { timeout: 15_000 });
  await page.selectOption("#companyId", { label: "E2E Handels GmbH" });
  await page.getByRole("button", { name: "Kontakt erstellen" }).last().click();

  await page.waitForURL(/\/contacts\/[a-z0-9]+/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Petra Prüfer");
  await expect(page.getByRole("link", { name: "E2E Handels GmbH" }).first()).toBeVisible();
  // The creation event is on the timeline.
  await expect(page.getByText("Kontakt erstellt").first()).toBeVisible();
});

test("3 · Notiz und Aufgabe am Kontakt erfassen", async ({ page }) => {
  await login(page);
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Petra Prüfer" }).click();
  await page.waitForURL(/\/contacts\/[a-z0-9]+/);

  await page.getByRole("tab", { name: "Notizen" }).click();
  await page.fill("#note-body", "Erstgespräch geführt, Angebot gewünscht.");
  await page.getByRole("button", { name: "Notiz speichern" }).click();
  await expect(page.getByText("Erstgespräch geführt, Angebot gewünscht.").first()).toBeVisible();

  await page.getByRole("button", { name: "Aufgabe" }).first().click();
  await page.fill("#title", "Angebot senden");
  await page.getByRole("button", { name: "Aufgabe erstellen" }).last().click();

  await page.goto("/tasks");
  await expect(page.getByText("Angebot senden")).toBeVisible();
});

test("3b · Anruf protokollieren und Termin planen", async ({ page }) => {
  await login(page);
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Petra Prüfer" }).click();
  await page.waitForURL(/\/contacts\/[a-z0-9]+/);

  await page.getByRole("button", { name: "Aktivität" }).first().click();
  await page.fill("#subject", "Telefonat zur Bedarfsklärung");
  await page.fill("#durationMinutes", "20");
  await page.getByRole("button", { name: "Aktivität protokollieren" }).last().click();
  await expect(page.getByText("Telefonat zur Bedarfsklärung").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Termin" }).first().click();
  await page.fill("#title", "Angebotspräsentation");
  await page.getByRole("button", { name: "Termin erstellen" }).last().click();

  await page.goto("/calendar");
  await expect(page.getByText("Angebotspräsentation").first()).toBeVisible({ timeout: 15_000 });
});

test("4 · Deal anlegen und Stage wechseln", async ({ page }) => {
  await login(page);

  await page.goto("/deals");
  await page.getByRole("button", { name: "Deal erstellen" }).first().click();
  await page.fill("#name", "E2E Rahmenvertrag");
  await page.fill("#amount", "15000");
  await page.getByRole("button", { name: "Deal erstellen" }).last().click();

  await page.waitForURL(/\/deals\/[a-z0-9]+/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Rahmenvertrag");

  // Move the deal one stage forward; the change is persisted server-side.
  await page.getByRole("button", { name: /^Qualifiziert/ }).click();
  await expect(page.getByText("Stage geändert: Lead → Qualifiziert").first()).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: /^Qualifiziert/ })).toHaveAttribute("aria-current", "step");
});

test("5 · Pipeline-Board zeigt den Deal in der neuen Stage", async ({ page }) => {
  await login(page);
  await page.goto("/pipeline");

  const qualified = page.getByRole("region", { name: "Qualifiziert" });
  await expect(qualified).toContainText("E2E Rahmenvertrag");
});

test("6 · Eigene Eigenschaft anlegen und am Kontakt setzen", async ({ page }) => {
  await login(page);

  await page.goto("/settings/properties");
  await page.getByRole("button", { name: "Eigenschaft erstellen" }).first().click();
  await page.fill("#property-label", "Kundennummer");
  await page.getByRole("button", { name: "Eigenschaft erstellen" }).last().click();
  await expect(page.locator("code", { hasText: "kundennummer" }).first()).toBeVisible();

  await page.goto("/contacts");
  await page.getByRole("link", { name: "Petra Prüfer" }).click();
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  await page.fill("#property-kundennummer", "K-1001");
  await page.getByRole("button", { name: "Änderungen speichern" }).click();

  await expect(page.getByText("K-1001").first()).toBeVisible({ timeout: 15_000 });
});

test("7 · Filter anwenden und Ansicht speichern", async ({ page }) => {
  await login(page);
  await page.goto("/contacts");

  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("button", { name: "Bedingung hinzufügen" }).click();
  await page.getByLabel("Feld").selectOption("lastName");
  await page.getByLabel("Operator").selectOption("contains");
  await page.getByPlaceholder("Wert").fill("Prüfer");
  await expect(page.getByRole("link", { name: "Petra Prüfer" })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ansichten" }).click();
  await page.getByRole("button", { name: "Aktuelle Ansicht speichern" }).click();
  await page.getByLabel("Name der Ansicht").fill("Prüfer-Kontakte");
  await page.getByRole("button", { name: "Speichern" }).click();

  await page.reload();
  await page.getByRole("button", { name: "Ansichten" }).click();
  await expect(page.getByRole("button", { name: "Prüfer-Kontakte" })).toBeVisible();
});

test("8 · Globale Suche findet Datensätze", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: /Kontakte, Unternehmen, Deals suchen/ }).click();
  const palette = page.getByRole("dialog", { name: "Globale Suche" });
  await palette.getByPlaceholder("Suchen…").fill("Prüfer");
  await expect(palette.getByRole("button", { name: /Petra Prüfer/ })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/contacts\/[a-z0-9]+/);
});

test("9 · Berechtigungen und Audit Log sind sichtbar", async ({ page }) => {
  await login(page);

  await page.goto("/settings/roles");
  await expect(page.getByText("contacts.write")).toBeVisible();

  await page.goto("/settings/audit");
  await expect(page.getByText("contact.created").first()).toBeVisible();
});

test("10 · Abmelden und erneut anmelden", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "Benutzermenü" }).click();
  await page.getByRole("button", { name: "Abmelden" }).click();
  await page.waitForURL("**/login");

  // Protected pages redirect to the login screen.
  await page.goto("/contacts");
  await page.waitForURL("**/login");

  await login(page);
  await expect(page).toHaveURL(/\/dashboard/);
});

test("11 · CSV-Import mit Zuordnung und Ergebnisbericht", async ({ page }) => {
  await login(page);
  await page.goto("/settings/import");

  const csv = ["Vorname;Nachname;E-Mail;Stadt", "Ida;Import;ida@import.test;Bremen", "Jonas;Import;jonas@import.test;Kiel"].join(
    "\n",
  );
  await page.setInputFiles('input[type="file"]', {
    name: "kontakte.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });

  // The wizard proposes a mapping from the German headers.
  await expect(page.getByText("2 Zeilen erkannt")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#map-Nachname")).toHaveValue("lastName");

  await page.getByRole("button", { name: /Zeilen importieren/ }).click();
  await expect(page.getByText("Importiert")).toBeVisible({ timeout: 20_000 });

  await page.goto("/contacts");
  await page.getByPlaceholder("Kontakte durchsuchen…").fill("Import");
  await expect(page.getByRole("link", { name: "Ida Import" })).toBeVisible({ timeout: 15_000 });
});

test("12 · Fehlerzustände werden verständlich angezeigt", async ({ page }) => {
  // Wrong credentials: a clear message, no stack trace, no hint whether the
  // account exists.
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", "definitivFalsch123");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("E-Mail-Adresse oder Passwort ist falsch.")).toBeVisible();

  // Validation errors are shown on the field.
  await login(page);
  await page.goto("/contacts");
  await page.getByRole("button", { name: "Kontakt erstellen" }).first().click();
  await page.fill("#firstName", "Ohne");
  await page.fill("#email", "keine-gueltige-adresse");
  await page.getByRole("button", { name: "Kontakt erstellen" }).last().click();
  await expect(page.getByText("Bitte eine gültige E-Mail-Adresse angeben.")).toBeVisible({ timeout: 15_000 });
});

test("13 · Mobile und Tablet zeigen die zentralen Ansichten", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.goto("/contacts");
  await expect(page.getByRole("link", { name: "Petra Prüfer" })).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText("Angebot senden")).toBeVisible();

  // The navigation collapses behind a menu button on small screens.
  await expect(page.getByRole("button", { name: "Navigation öffnen" })).toBeVisible();

  // Tablet: the sidebar is back and the detail layout still works.
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Petra Prüfer" }).click();
  await page.waitForURL(/\/contacts\/[a-z0-9]+/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Petra Prüfer");

  await page.goto("/pipeline");
  await expect(page.getByRole("region", { name: "Qualifiziert" })).toBeVisible();
});

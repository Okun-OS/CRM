import { test, expect, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";
import { execFileSync } from "node:child_process";

/**
 * Das Betreiber-Backoffice, durch die echte Oberfläche gefahren: Zugang
 * erhalten, Kunde anlegen, Einladung bekommen, stilllegen und reaktivieren —
 * und die Grenze prüfen, dass ein gewöhnlicher Zugang diesen Bereich nicht
 * sieht.
 */
const unique = Date.now();
const BETREIBER = `betreiber-${unique}@okun.test`;
const KUNDE = `kunde-${unique}@beispiel.test`;
const PASSWORD = "E2ePasswort2026x";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/okun_crm_e2e";

test.describe.configure({ mode: "serial" });

function platformScript(...args: string[]): string {
  return execFileSync("pnpm", ["platform:admin", ...args], {
    env: {
      ...process.env,
      DATABASE_URL,
      SESSION_SECRET: "e2e-session-secret-00000000000000",
      ENCRYPTION_KEY: "e2e-encryption-key-0000000000000",
      DOTENV_CONFIG_PATH: "/nonexistent.env",
    },
    encoding: "utf8",
  });
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  // Auf die Antwort warten statt auf eine Navigation: Die Sitzung steht mit
  // dem gesetzten Cookie, unabhängig davon, wohin der Client danach wechselt.
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => candidate.url().includes("/api/v1/auth/login") && candidate.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Anmelden" }).click(),
  ]);
  expect(response.status()).toBe(200);
}

test("1 · Ein gewöhnlicher Zugang sieht den Betreiberbereich nicht", async ({ page }) => {
  await page.goto("/register");
  await page.fill("#organizationName", `Fremde GmbH ${unique}`);
  await page.fill("#name", "Fremde Person");
  await page.fill("#email", `fremd-${unique}@beispiel.test`);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Organisation anlegen" }).click();
  await page.waitForURL("**/dashboard");
  await dismissTour(page);

  // Kein Hinweis auf die Existenz des Bereichs: umgeleitet, nichts zu sehen.
  // (Die Anmeldeseite schickt eine bestehende Sitzung weiter aufs Dashboard,
  // deshalb zählt hier nur, dass /admin nicht erreicht wird.)
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/);
  await expect(page.getByText("Betreiberverwaltung")).toHaveCount(0);

  const response = await page.request.get("/api/v1/platform/customers");
  expect(response.status()).toBe(401);
});

test("2 · Betreiberzugang anlegen und Bereich öffnen", async ({ page }) => {
  const output = platformScript("create", BETREIBER, "E2E Betreiber", PASSWORD);
  expect(output).toContain("Betreiberzugang angelegt");

  await login(page, BETREIBER);
  await page.goto("/admin");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kunden");
  await expect(page.getByText("Betreiberverwaltung")).toBeVisible();
  await expect(page.getByText("keine Inhalte der Kundenmandanten", { exact: false })).toBeVisible();
});

test("3 · Kunde anlegen erzeugt Mandant und Einladung", async ({ page }) => {
  await login(page, BETREIBER);
  await page.goto("/admin");

  await page.getByRole("button", { name: "Kunde anlegen" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Kunde anlegen" });
  await dialog.locator("#customer-name").fill(`Nordlicht Technik ${unique}`);
  await dialog.locator("#customer-admin").fill("Markus Hoffmann");
  await dialog.locator("#customer-email").fill(KUNDE);
  await dialog.getByRole("button", { name: "Anlegen und einladen" }).click();

  const result = page.getByRole("dialog", { name: "Kunde angelegt" });
  await expect(result).toBeVisible();
  // Ohne Postausgang wird nichts vorgetäuscht, der Link steht bereit.
  await expect(result.locator("code")).toContainText("/invite/");
  await result.getByRole("button", { name: "Fertig" }).click();

  // In der Liste, nicht im Erfolgs-Hinweis.
  await expect(page.getByRole("link", { name: new RegExp(`Nordlicht Technik ${unique}`) })).toBeVisible();
});

test("4 · Die Detailseite zeigt Kennzahlen, keine Inhalte", async ({ page }) => {
  await login(page, BETREIBER);
  await page.goto("/admin");
  await page.getByRole("link", { name: new RegExp(`Nordlicht Technik ${unique}`) }).click();
  await page.waitForURL(/\/admin\/[a-z0-9]+/);

  await expect(page.getByText("Kontakte", { exact: true })).toBeVisible();
  await expect(page.getByText("Der Betreiberbereich zeigt keine Kontakte", { exact: false })).toBeVisible();
  await expect(page.getByText(KUNDE)).toBeVisible();
});

test("5 · Stilllegen und reaktivieren, mit Protokoll", async ({ page }) => {
  await login(page, BETREIBER);
  await page.goto("/admin");
  await page.getByRole("link", { name: new RegExp(`Nordlicht Technik ${unique}`) }).click();
  await page.waitForURL(/\/admin\/[a-z0-9]+/);

  await page.getByRole("button", { name: "Stilllegen" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Organisation stilllegen?" });
  await dialog.locator("#suspend-reason").fill("Rechnung seit 60 Tagen offen.");
  await dialog.getByRole("button", { name: "Stilllegen" }).click();

  await expect(page.getByText("Stillgelegt am", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Reaktivieren" }).click();
  await expect(page.getByText("Stillgelegt am", { exact: false })).toHaveCount(0, { timeout: 15_000 });

  await page.goto("/admin/audit");
  // Das Protokoll ist unveränderlich und wächst über Läufe hinweg.
  await expect(page.getByText("Kunde stillgelegt").first()).toBeVisible();
  await expect(page.getByText("Kunde reaktiviert").first()).toBeVisible();
});

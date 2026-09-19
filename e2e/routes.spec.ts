import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke test over every screen of the product.
 *
 * A server component that throws only shows up when the page is actually
 * rendered — this walks all routes, including record detail pages, and fails on
 * any non-200 response, any 5xx sub-request and any rendered error boundary.
 */
const unique = Date.now();
const ORG = `Routen-Check ${unique}`;
const EMAIL = `routen-${unique}@example.test`;
const PASSWORD = "E2ePasswort2026x";

const ROUTES = [
  "/heute",
  "/dashboard",
  "/contacts",
  "/companies",
  "/leads",
  "/deals",
  "/pipeline",
  "/activities",
  "/tasks",
  "/calendar",
  "/emails",
  "/templates",
  "/workflows",
  "/reports",
  "/settings",
  "/settings/profile",
  "/settings/organization",
  "/settings/users",
  "/settings/roles",
  "/settings/properties",
  "/settings/pipelines",
  "/settings/crm-options",
  "/settings/integrations",
  "/settings/webhooks",
  "/settings/active-crm",
  "/settings/api-keys",
  "/settings/import",
  "/settings/duplicates",
  "/settings/audit",
  "/settings/privacy",
  "/settings/system",
];

async function createRecords(page: Page) {
  await page.goto("/companies");
  await page.getByRole("button", { name: "Unternehmen erstellen" }).first().click();
  await page.fill("#name", "Routen GmbH");
  await page.getByRole("button", { name: "Unternehmen erstellen" }).last().click();
  await page.waitForURL(/\/companies\/[a-z0-9]+/);

  await page.goto("/contacts");
  await page.getByRole("button", { name: "Kontakt erstellen" }).first().click();
  await page.fill("#firstName", "Rolf");
  await page.fill("#lastName", "Route");
  await page.getByRole("button", { name: "Kontakt erstellen" }).last().click();
  await page.waitForURL(/\/contacts\/[a-z0-9]+/);

  await page.goto("/leads");
  await page.getByRole("button", { name: "Lead erstellen" }).first().click();
  await page.fill("#lastName", "Leadmann");
  await page.fill("#email", "lead@routen.test");
  await page.getByRole("button", { name: "Lead erstellen" }).last().click();
  await page.waitForURL(/\/leads\/[a-z0-9]+/);

  await page.goto("/deals");
  await page.getByRole("button", { name: "Deal erstellen" }).first().click();
  await page.fill("#name", "Routen-Deal");
  await page.fill("#amount", "1000");
  await page.getByRole("button", { name: "Deal erstellen" }).last().click();
  await page.waitForURL(/\/deals\/[a-z0-9]+/);
}

test("jede Seite rendert ohne Fehler", async ({ page }) => {
  const serverErrors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/register");
  await page.fill("#organizationName", ORG);
  await page.fill("#name", "Routen Admin");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Organisation anlegen" }).click();
  await page.waitForURL("**/dashboard");

  await createRecords(page);

  // Collect one detail route per object so server components are exercised too.
  const detailRoutes: string[] = [];
  for (const listPath of ["/contacts", "/companies", "/leads", "/deals"]) {
    await page.goto(listPath);
    const href = await page.locator(`a[href*="${listPath}/"]`).first().getAttribute("href");
    if (href) detailRoutes.push(href);
  }

  const failures: string[] = [];
  for (const route of [...ROUTES, ...detailRoutes]) {
    const response = await page.goto(route, { waitUntil: "load" });
    await page.waitForTimeout(400);

    const status = response?.status() ?? 0;
    const body = await page.locator("body").innerText();
    const crashed = /Application error|server-side exception|Internal Server Error/i.test(body);

    if (status !== 200 || crashed) failures.push(`${route} → ${status}${crashed ? " (Fehlerseite)" : ""}`);
  }

  expect(failures, `Seiten mit Fehlern:\n${failures.join("\n")}`).toHaveLength(0);
  expect(serverErrors, `Serverfehler:\n${serverErrors.join("\n")}`).toHaveLength(0);
});

test("unbekannte Adressen zeigen die eigene 404-Seite", async ({ page }) => {
  const response = await page.goto("/gibt-es-nicht-4711");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Diese Seite gibt es nicht");
  // Nicht die Standardseite von Next, sondern die des Produkts.
  await expect(page.getByRole("link", { name: "Zum Action Center" })).toBeVisible();
  // Das Endorsement rendert als Text plus SVG-Wortmarke, nicht als ein Textknoten.
  await expect(page.getByRole("main")).toContainText("Powered by");
  await expect(page.getByRole("img", { name: "OKUN Software" })).toBeVisible();
});

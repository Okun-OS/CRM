import { test, expect, type Page } from "@playwright/test";

/**
 * Die Produkttour.
 *
 * Geprüft wird das, was sie von einer Reihe Pop-ups unterscheidet: Sie stellt
 * echte Bedienelemente frei, diese bleiben anklickbar, ein wartender Schritt
 * geht erst weiter, wenn wirklich geklickt wurde — und sie hält niemanden auf
 * der Seite fest.
 */
const unique = Date.now();
const EMAIL = `tour-${unique}@example.test`;
// Test 6 braucht ein Konto, das die Tour noch nicht abgebrochen hat.
const EMAIL_AKQUISE = `tour-akquise-${unique}@example.test`;
const PASSWORD = "TourPasswort2026x";

test.describe.configure({ mode: "serial" });

const card = (page: Page) => page.locator(".okun-tour-card");

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/dashboard");
}

test("1 · startet von selbst für ein neues Konto", async ({ page }) => {
  await page.goto("/register");
  await page.fill("#organizationName", `Tour Organisation ${unique}`);
  await page.fill("#name", "Tour Administrator");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Organisation anlegen" }).click();
  await page.waitForURL("**/dashboard");

  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText("Einmal quer durch OKUN CRM");
  // Wer gerade keine Zeit hat, soll sie vertagen können.
  await expect(page.getByRole("button", { name: "Später" })).toBeVisible();
});

test("2 · führt durch echte Bedienelemente und wartet auf den Klick", async ({ page }) => {
  await login(page);
  await expect(card(page)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Los geht’s" }).click();
  await page.getByRole("button", { name: "Verstanden" }).click();
  await expect(card(page)).toContainText("Die Navigation folgt Ihrer Arbeit");

  // Vier Flächen um das Ziel herum — über dem Ziel selbst liegt keine.
  await expect(page.locator(".okun-tour-mask")).toHaveCount(4);

  const reachable = await page.evaluate(() => {
    const element = document.querySelector('[data-tour="nav-dashboard"]');
    if (!element) return "Ziel fehlt";
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit && element.contains(hit) ? "erreichbar" : "verdeckt";
  });
  expect(reachable).toBe("erreichbar");

  // Weiter bis zu dem Schritt, der eine echte Handlung verlangt. Die Tour
  // wechselt dabei selbst auf die Unternehmensseite.
  for (let i = 0; i < 12; i += 1) {
    if (await card(page).getByText("Jetzt sind Sie dran").count()) break;
    const weiter = page.getByRole("button", { name: "Weiter" });
    if (!(await weiter.count())) break;
    await weiter.first().click();
    await page.waitForTimeout(300);
  }

  await expect(page).toHaveURL(/\/companies$/);
  await expect(card(page)).toContainText("Jetzt sind Sie dran");
  await expect(card(page)).toContainText("Warte auf Ihren Klick");
  // Ein wartender Schritt bietet kein „Weiter“ an — sonst wäre das Warten Zierde.
  await expect(page.getByRole("button", { name: "Weiter" })).toHaveCount(0);

  // Der Klick erreicht die Anwendung wirklich: Das Formular geht auf.
  await page.getByRole("button", { name: "Unternehmen erstellen" }).first().click();
  await expect(page.locator('[data-tour="drawer"]')).toBeVisible();
  await expect(card(page)).not.toContainText("Jetzt sind Sie dran");
});

test("3 · hält niemanden auf der Seite fest", async ({ page }) => {
  await login(page);
  await expect(card(page)).toBeVisible({ timeout: 15_000 });

  await page.goto("/reports");
  await expect(card(page)).toContainText("Einführung pausiert");
  // Kein Abdunkeln, kein Zurückzerren: Die Seite bleibt bedienbar.
  await expect(page.locator(".okun-tour-mask")).toHaveCount(0);
  await expect(page).toHaveURL(/\/reports$/);

  await page.getByRole("button", { name: "Weitermachen" }).click();
  await expect(card(page)).not.toContainText("Einführung pausiert");
});

test("4 · lässt sich abbrechen und drängt sich danach nicht erneut auf", async ({ page }) => {
  await login(page);
  await expect(card(page)).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await expect(card(page)).toHaveCount(0);
});

test("5 · lässt sich über das Benutzermenü neu starten", async ({ page }) => {
  await login(page);
  await page.locator('[data-tour="topbar-user"]').click();
  await page.getByText("Einführung starten").click();

  await expect(card(page)).toBeVisible({ timeout: 10_000 });
  await expect(card(page)).toContainText("Einmal quer durch OKUN CRM");
});

test("6 · führt auch durch die Akquise und stellt dort echte Karten frei", async ({ page }) => {
  // Eigenes Konto: Für das erste wurde die Tour in Test 4 abgebrochen und
  // startet deshalb zu Recht nicht mehr von selbst.
  await page.goto("/register");
  await page.fill("#organizationName", `Tour Akquise ${unique}`);
  await page.fill("#name", "Akquise Rundgang");
  await page.fill("#email", EMAIL_AKQUISE);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Organisation anlegen" }).click();
  await page.waitForURL("**/dashboard");
  await expect(card(page)).toBeVisible({ timeout: 15_000 });

  // Fortschritt setzen wie die Tour selbst: derselbe PUT, dieselbe CSRF-Prüfung.
  // Keine Hintertür — nur der Zustand eines Menschen, der schon weiter war.
  const status = await page.evaluate(async () => {
    const csrf = document.cookie.match(/(?:^|;\s*)okun_csrf=([^;]+)/);
    const response = await fetch("/api/v1/tour", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-okun-csrf": csrf ? decodeURIComponent(csrf[1]) : "",
      },
      body: JSON.stringify({ status: "running", progress: { chapter: "akquise", step: 0 } }),
    });
    return response.status;
  });
  expect(status).toBe(200);

  // Nach dem Neuladen zerrt die Tour niemanden weg: Sie wartet auf dem
  // Dashboard und fragt, ob es weitergehen soll.
  await page.reload();
  await expect(card(page)).toContainText("Einführung pausiert", { timeout: 15_000 });
  await page.getByRole("button", { name: "Weitermachen" }).click();

  await page.waitForURL("**/outreach");
  await expect(card(page)).toContainText("Bis hierhin ging es um Menschen, die Sie schon kennen");

  // Weiter zum Trichter — hier zeigt die Tour auf eine echte Karte der Seite.
  await page.getByRole("button", { name: "Weiter" }).first().click();
  await expect(card(page)).toContainText("Der Trichter zeigt, was wirklich übrig bleibt");

  const reachable = await page.evaluate(() => {
    const element = document.querySelector('[data-tour="acquisition-funnel"]');
    if (!element) return "Ziel fehlt";
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 8);
    return hit && element.contains(hit) ? "erreichbar" : "verdeckt";
  });
  expect(reachable).toBe("erreichbar");

  // Der Schritt über die offenen Punkte hat auf einem leeren Konto kein Ziel.
  // Er muss still übersprungen werden, statt die Tour festzusetzen.
  await page.getByRole("button", { name: "Weiter" }).first().click();
  await expect(card(page)).not.toContainText("Und was liegen geblieben ist", { timeout: 15_000 });
  await expect(card(page)).toBeVisible();
});

import { chromium } from "playwright";
const [, , url, out, w = "1440", h = "900", loginFirst = "0"] = process.argv;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const context = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1.5, locale: "de-DE" });
const page = await context.newPage();
if (loginFirst === "1") {
  await page.goto("http://localhost:3000/login");
  await page.fill("#email", "admin@okun-demo.de");
  await page.fill("#password", "OkunDemo2026!");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("ok");

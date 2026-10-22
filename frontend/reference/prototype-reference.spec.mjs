import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const designURL = process.env.DESIGN_BASE_URL || "http://127.0.0.1:5174";
const sizes = [
  { id: "desktop", width: 1365, height: 900 },
  { id: "mobile", width: 390, height: 844 },
];
const screens = [
  ["projects", "catalog"],
  ["vacancies", "vacancies"],
  ["applications", "applications"],
  ["profile", "profile"],
  ["notifications", "notifications"],
  ["teams", "teams"],
];
const cabinetTabs = [
  "responses", "vacancies", "invites", "team", "recruiters", "settings",
];

async function captureReference(page, prefix, screen, tab) {
  const params = new URLSearchParams({
    screen, as: "ivan",
    ...(screen === "cabinet" ? { project: "atlas", tab: tab || "responses" } : {}),
  });
  await page.goto(designURL + "/complete.html?" + params);
  await expect(page.locator("body")).toContainText("Бизнес-клуб");
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForLoadState("networkidle");
  mkdirSync("reference-evidence", { recursive: true });
  await page.screenshot({
    path: "reference-evidence/" + prefix + ".png",
    fullPage: true,
    animations: "disabled",
  });
}

for (const size of sizes) {
  test("approved complete reference at " + size.id, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const [name, screen] of screens) {
      await captureReference(page, size.id + "-" + name, screen);
    }
    for (const tab of cabinetTabs) {
      await captureReference(page, size.id + "-cabinet-" + tab, "cabinet", tab);
    }
    await captureReference(page, size.id + "-cabinet", "cabinet", "responses");
  });
}

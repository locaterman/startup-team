import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const views = [
  ["Стартапы", "projects"],
  ["Вакансии", "vacancies"],
  ["Кабинет", "cabinet"],
  ["Мои отклики", "applications"],
];
const accountViews = [
  ["Мой профиль", "profile"],
  ["Мои команды", "teams"],
  ["Уведомления", "notifications"],
];
const sizes = [
  { name: "desktop", width: 1365, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function login(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  await page.getByLabel("Email").fill("ivan@example.test");
  await page.getByLabel("Пароль").fill("demo-ivan-123");
  await page.getByRole("button", { name: "Войти в демо" }).click();
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toBeVisible();
}

async function checkScreen(page, label) {
  // A screenshot of the loading skeleton is not evidence of the final page.
  // Each screen must finish all visible data requests before capture.
  await expect(page.getByText("Загрузка…", { exact: true })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const evaluated = await page.evaluate(() => {
    const css = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    const selectors = [".panel", ".modal", ".vacancy-block", ".history-item", ".cw-candidate-detail"];
    const surfaceColors = selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((el) => ({
        selector,
        background: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el).color,
      })),
    );
    return {
      bodyBg: css.backgroundColor,
      rootBg: root.backgroundColor,
      fontFamily: css.fontFamily,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      surfaceColors,
    };
  });
  expect(evaluated.bodyBg, label + " background").toBe("rgb(11, 19, 34)");
  expect(evaluated.fontFamily, label + " typography").toContain("Manrope");
  expect(evaluated.horizontalOverflow, label + " viewport overflow").toBeLessThanOrEqual(1);
  for (const element of evaluated.surfaceColors) {
    expect(element.background, label + " old white card").not.toBe("rgb(255, 255, 255)");
    expect(element.color, label + " old dark-on-light text").not.toBe("rgb(19, 33, 49)");
  }
  // Playwright may prune successful test-results. Persist evidence separately.
  mkdirSync("visual-evidence", { recursive: true });
  await page.screenshot({
    path: "visual-evidence/" + label + ".png",
    fullPage: true,
    animations: "disabled",
  });
}

for (const size of sizes) {
  test("complete visual foundation and no horizontal overflow: " + size.name, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await login(page);
    for (const [label, name] of views) {
      await page.getByRole("button", { name: label, exact: true }).first().click();
      await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
      await checkScreen(page, size.name + "-" + name);
      if (name === "cabinet") {
        const workspaceTabs = page.getByRole("tablist", { name: "Управление проектом" });
        await expect(workspaceTabs, "Cabinet must render a real project workspace").toBeVisible();
        const geometry = await workspaceTabs.evaluate((element) => {
          const items = [...element.querySelectorAll('[role="tab"]')];
          return {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            overflowX: getComputedStyle(element).overflowX,
            rects: items.map((item) => item.getBoundingClientRect().toJSON()),
          };
        });
        for (let i = 1; i < geometry.rects.length; i++) {
          expect(
            geometry.rects[i - 1].right,
            "Adjacent mobile workspace tabs must never overlap",
          ).toBeLessThanOrEqual(geometry.rects[i].left + 1);
        }
        if (size.name === "mobile") {
          expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
          expect(geometry.overflowX).toBe("auto");
        }
        for (const [tabName, slug] of [
          ["Отклики", "responses"], ["Вакансии", "vacancies"],
          ["Приглашения", "invites"], ["Команда", "team"],
          ["Рекрутеры", "recruiters"], ["Настройки", "settings"],
        ]) {
          const tab = workspaceTabs.getByRole("tab", { name: new RegExp("^" + tabName) });
          await tab.click();
          await expect(tab).toHaveAttribute("aria-selected", "true");
          await checkScreen(page, size.name + "-cabinet-" + slug);
        }
      }
    }
    for (const [label, name] of accountViews) {
      if (label === "Уведомления") {
        await page.getByRole("button", { name: /^Уведомления/ }).first().click();
      } else {
        await page.getByRole("button", { name: /^Профиль:/ }).click();
        await page.getByRole("button", { name: label, exact: true }).click();
      }
      await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
      await checkScreen(page, size.name + "-" + name);
    }
    await page.getByRole("button", { name: "Кабинет", exact: true }).first().click();
    await page.getByRole("button", { name: "Новый проект" }).click();
    const dialog = page.getByRole("dialog", { name: "Новый стартап" });
    await expect(dialog).toBeVisible();
    const drawer = await dialog.boundingBox();
    expect(drawer).not.toBeNull();
    expect(drawer.x + drawer.width, "Drawer must reach the viewport right edge")
      .toBeGreaterThanOrEqual(size.width - 2);
    expect(drawer.x, "Drawer should not occupy the entire desktop viewport")
      .toBeGreaterThanOrEqual(size.name === "desktop" ? size.width - 655 : -1);
    expect(drawer.y, "Drawer should start at the top").toBeLessThanOrEqual(1);
    expect(drawer.height, "Drawer should span the available screen")
      .toBeGreaterThanOrEqual(size.height - 2);
    const modalColors = await dialog.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color,
    }));
    expect(modalColors.background).toBe("rgb(11, 19, 34)");
    expect(modalColors.color).toBe("rgb(238, 242, 248)");
    await checkScreen(page, size.name + "-dialog");
    await dialog.getByRole("button", { name: "Закрыть" }).click();
    await expect(dialog).toBeHidden();
  });
}

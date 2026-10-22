import { test, expect } from "@playwright/test";

// Real API demo authentication is used for data and permissions. The native
// Telegram chrome is a fake *after* login: no forged signed initData enters
// the backend. We only test the WebApp BackButton interface contract.
test("Telegram BackButton follows screens and closes dialog without leaving Mini App", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Email").fill("ivan@example.test");
  await page.getByLabel("Пароль").fill("demo-ivan-123");
  await page.getByRole("button", { name: "Войти в демо" }).click();
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toBeVisible();

  await page.evaluate(() => {
    const button = {
      isVisible: false,
      handler: null,
      show() { this.isVisible = true; },
      hide() { this.isVisible = false; },
      onClick(callback) { this.handler = callback; },
      offClick(callback) { if (this.handler === callback) this.handler = null; },
    };
    window.__testBack = button;
    window.Telegram = {
      WebApp: {
        initData: "mock-chrome-only",
        ready() {},
        expand() {},
        BackButton: button,
      },
    };
  });

  // Root of the catalog has no native back destination.
  await page.getByRole("button", { name: "Вакансии", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__testBack.isVisible)).toBe(true);
  await page.evaluate(() => window.__testBack.handler());
  await expect(page.getByRole("heading", { name: "Стартапы", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__testBack.isVisible)).toBe(false);

  // A command drawer takes precedence over section navigation.
  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__testBack.isVisible)).toBe(true);
  await page.evaluate(() => window.__testBack.handler());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Стартапы", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__testBack.isVisible)).toBe(false);

  // Native Back returns along prior top-level tabs, not always to projects.
  await page.getByRole("button", { name: "Кабинет", exact: true }).click();
  await page.getByRole("button", { name: "Мои отклики", exact: true }).click();
  await page.evaluate(() => window.__testBack.handler());
  await expect(page.getByRole("heading", { name: "Кабинет", exact: true })).toBeVisible();
  await page.evaluate(() => window.__testBack.handler());
  await expect(page.getByRole("heading", { name: "Стартапы", exact: true })).toBeVisible();
});

test("Telegram mobile safe-area and input sizing without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  const styles = await page.evaluate(() => {
    document.documentElement.classList.add("telegram-mini-app");
    document.documentElement.style.setProperty("--tg-content-safe-area-inset-left", "33px");
    document.documentElement.style.setProperty("--tg-content-safe-area-inset-right", "21px");
    document.documentElement.style.setProperty("--tg-content-safe-area-inset-bottom", "44px");
    const screen = document.querySelector(".tg-auth");
    const textBox = screen.querySelector('input[type="email"]');
    const css = getComputedStyle(screen);
    return {
      left: parseFloat(css.paddingLeft),
      right: parseFloat(css.paddingRight),
      bottom: parseFloat(css.paddingBottom),
      fontSize: parseFloat(getComputedStyle(textBox).fontSize),
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(styles.left).toBeGreaterThanOrEqual(33);
  expect(styles.right).toBeGreaterThanOrEqual(21);
  expect(styles.bottom).toBeGreaterThanOrEqual(44);
  expect(styles.fontSize).toBeGreaterThanOrEqual(16);
  expect(styles.overflow).toBeLessThanOrEqual(1);
});

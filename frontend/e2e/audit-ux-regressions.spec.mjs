import { test, expect } from "@playwright/test";

async function login(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  await page.getByLabel("Email").fill("ivan@example.test");
  await page.getByLabel("Пароль").fill("demo-ivan-123");
  await page.getByRole("button", { name: "Войти в демо" }).click();
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toBeVisible();
}

test("a populated dialog requires explicit discard on Escape and native Telegram Back", async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const back = {
      isVisible: false,
      handler: null,
      show() { this.isVisible = true; },
      hide() { this.isVisible = false; },
      onClick(handler) { this.handler = handler; },
      offClick(handler) { if (this.handler === handler) this.handler = null; },
    };
    window.__auditBack = back;
    window.Telegram = {
      WebApp: { initData: "mock-native-button-only", ready() {}, expand() {}, BackButton: back },
    };
  });

  await page.getByRole("button", { name: "Создать проект" }).click();
  const dialog = page.getByRole("dialog", { name: "Новый стартап" });
  const name = dialog.getByLabel("Название");
  await expect(name).toBeFocused();
  await name.fill("Unsaved project title");
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await expect(dialog.getByText("Есть несохранённые изменения. Удалить введённый текст?")).toBeVisible();
  await dialog.getByRole("button", { name: "Продолжить редактирование" }).click();
  await expect(name).toHaveValue("Unsaved project title");

  await expect.poll(() => page.evaluate(() => window.__auditBack.isVisible)).toBe(true);
  await page.evaluate(() => window.__auditBack.handler());
  await expect(dialog.getByText("Есть несохранённые изменения. Удалить введённый текст?")).toBeVisible();
  await expect(name).toHaveValue("Unsaved project title");
  await dialog.getByRole("button", { name: "Удалить черновик" }).click();
  await expect(dialog).toHaveCount(0);
});

test("unsaved project settings survive pause and server revision refresh", async ({ page }) => {
  await login(page);
  const title = "Draft persistence " + Date.now();
  await page.getByRole("button", { name: "Создать проект" }).click();
  const creation = page.getByRole("dialog", { name: "Новый стартап" });
  await creation.getByLabel("Название").fill(title);
  await creation.getByRole("button", { name: "Подтвердить" }).click();
  await expect(creation).toBeHidden();

  await page.getByRole("button", { name: "Кабинет", exact: true }).click();
  const picker = page.getByLabel("Управляемый проект");
  await expect(picker.getByRole("option", { name: title + " · Активен" })).toBeAttached();
  await picker.selectOption({ label: title + " · Активен" });
  await page.getByRole("tab", { name: "Настройки" }).click();
  const settings = page.getByLabel("Настройки стартапа");
  const description = settings.getByLabel("Описание");
  await description.fill("My long unfinished settings draft that must survive refresh.");
  await settings.getByRole("button", { name: "Приостановить набор" }).click();
  await expect(settings.getByRole("button", { name: "Возобновить набор" })).toBeVisible();
  await expect(description).toHaveValue("My long unfinished settings draft that must survive refresh.");
  await expect(settings.getByRole("button", { name: "Сохранить" })).toBeEnabled();
});

test("failed cabinet GET can be retried without page reload", async ({ page }) => {
  await login(page);
  let failed = false;
  await page.route((url) => url.pathname === "/api/v1/startups" && url.searchParams.get("scope") === "managed", async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503, contentType: "application/json",
        body: JSON.stringify({ error: { code: "TEMPORARILY_UNAVAILABLE", message: "Temporary error" } }),
      });
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Кабинет", exact: true }).click();
  await expect(page.getByText(/Не удалось загрузить/)).toBeVisible();
  await page.getByRole("button", { name: "Повторить", exact: true }).first().click();
  await expect(page.getByText(/Не удалось загрузить/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Кабинет" })).toBeVisible();
  expect(failed).toBe(true);
});

test("authenticated API 401 restores login screen instead of displaying stale cabinet", async ({ page }) => {
  await login(page);
  await page.route((url) => url.pathname === "/api/v1/startups" && url.searchParams.get("scope") === "managed", async (route) => {
    await route.fulfill({
      status: 401, contentType: "application/json",
      body: JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "Session expired" } }),
    });
  });
  await page.getByRole("button", { name: "Кабинет", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  await expect(page.getByText("Сессия завершилась. Войдите снова или откройте Mini App через бота.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Кабинет" })).toHaveCount(0);
});

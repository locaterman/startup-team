import { test, expect } from "@playwright/test";

async function login(page, email, password) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти в демо" }).click();
  await expect(page.getByRole("navigation", { name: "Основные разделы" })).toBeVisible();
  await expect(page.getByText("Готово", { exact: true })).toHaveCount(0);
}

test("anonymous entry and stale cookie show login, not a false success state", async ({ page, context }) => {
  await context.addCookies([{
    name: "session", value: "invalid-expired-session",
    url: "http://127.0.0.1:18086",
    httpOnly: true, sameSite: "Lax",
  }]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  await expect(page.getByText("Session expired", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Готово", { exact: true })).toHaveCount(0);
});

test("demo authentication, account page and logout retain correct state", async ({ page }) => {
  await login(page, "ivan@example.test", "demo-ivan-123");
  await page.getByRole("button", { name: "Кабинет", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Кабинет" })).toBeVisible();
  await page.getByRole("button", { name: "Профиль: Ivan Demo" }).click();
  await page.getByRole("button", { name: "Мой профиль" }).click();
  await expect(page.getByRole("heading", { name: "Мой профиль" })).toBeVisible();
  await page.getByRole("button", { name: "Профиль: Ivan Demo" }).click();
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  await expect(page.getByText("Готово", { exact: true })).toHaveCount(0);
});

test("two real demo users: create vacancy, apply once, reload, prevent duplicate", async ({ page, browser }) => {
  const project = "E2E Project " + Date.now();
  const role = "E2E Python " + Date.now();

  await login(page, "ivan@example.test", "demo-ivan-123");
  await page.getByRole("button", { name: "Создать проект" }).click();
  let dialog = page.getByRole("dialog", { name: "Новый стартап" });
  await dialog.getByLabel("Название").fill(project);
  await dialog.getByLabel("Описание").fill("Автоматическая проверка живого API.");
  await dialog.getByRole("button", { name: "Подтвердить" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: project, exact: true }).click();
  await expect(page.getByRole("heading", { name: project })).toBeVisible();

  await page.getByRole("button", { name: "Добавить вакансию" }).click();
  dialog = page.getByRole("dialog", { name: "Новая вакансия" });
  await dialog.getByLabel("Название").fill(role);
  await dialog.getByLabel("Описание").fill("Роль для теста откликов.");
  await dialog.getByLabel("Требования").fill("Python");
  await dialog.getByLabel("Количество мест").fill("2");
  await dialog.getByRole("button", { name: "Подтвердить" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(role, { exact: true })).toBeVisible();

  // Playwright contexts isolate cookie jars although both visit one hostname.
  const candidateContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:18086",
  });
  try {
    const candidate = await candidateContext.newPage();
    await login(candidate, "maria@example.test", "demo-maria-123");
    await candidate.getByRole("button", { name: "Вакансии", exact: true }).click();
    const row = candidate.locator(".vacancy-block").filter({ hasText: role });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Откликнуться" }).click();
    const applyDialog = candidate.getByRole("dialog", { name: "Ваш отклик" });
    await applyDialog.getByLabel("Чем вы можете помочь").fill("Я работаю с Python.");
    await applyDialog.getByRole("button", { name: "Подтвердить" }).click();
    await expect(applyDialog).toBeHidden();

    await expect(row.getByRole("button", { name: "Отклик уже отправлен" })).toBeDisabled();
    await candidate.reload();
    await candidate.getByRole("button", { name: "Вакансии", exact: true }).click();
    const persistedRow = candidate.locator(".vacancy-block").filter({ hasText: role });
    await expect(persistedRow.getByRole("button", { name: "Отклик уже отправлен" })).toBeDisabled();
    await persistedRow.getByRole("button", { name: "Мои отклики" }).click();
    await expect(candidate.getByRole("heading", { name: "Мои отклики" })).toBeVisible();
    const savedApplication = candidate.locator(".cw-application-record").filter({ hasText: role });
    await expect(savedApplication).toBeVisible();
    await savedApplication.getByRole("button", { name: "История и тестовое" }).click();
    await expect(savedApplication.locator(".cw-record-detail")).toBeVisible();
    await expect(savedApplication.locator(".cw-timeline")).toBeVisible();
  } finally {
    await candidateContext.close();
  }
});

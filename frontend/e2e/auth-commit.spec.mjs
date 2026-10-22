import { test, expect } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:18086";

test("login response is committed before immediate CSRF and profile reads", async ({ browser }) => {
  // Different browser contexts are deliberate: concurrent sessions of the
  // same account should not collide; each POST /auth/login is independent.
  for (let index = 0; index < 12; index++) {
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
      await page.getByLabel("Email").fill("ivan@example.test");
      await page.getByLabel("Пароль").fill("demo-ivan-123");
      const loginResponsePromise = page.waitForResponse((r) =>
        r.url().endsWith("/api/v1/auth/login") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Войти в демо" }).click();
      const loginResponse = await loginResponsePromise;
      expect(loginResponse.status(), "Login HTTP status, iteration " + index).toBe(200);

      // Auth/context and CSRF should succeed immediately with the new cookie.
      // No retry is allowed. If dependency teardown commits after HTTP 200,
      // these requests can race the still-uncommitted session row.
      const [csrf, current, contextRes] = await Promise.all([
        context.request.get("/api/v1/auth/csrf"),
        context.request.get("/api/v1/auth/me"),
        context.request.get("/api/v1/auth/context"),
      ]);
      expect(csrf.status(), "CSRF, iteration " + index).toBe(200);
      expect(current.status(), "Profile, iteration " + index).toBe(200);
      expect(contextRes.status(), "Auth context, iteration " + index).toBe(200);
      await expect(page.getByRole("navigation", { name: "Основные разделы" })).toBeVisible();
      await expect(page.getByText("Готово", { exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

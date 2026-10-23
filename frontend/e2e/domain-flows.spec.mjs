import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:18086";
const credentials = {
  owner: ["ivan@example.test", "demo-ivan-123"],
  candidate: ["maria@example.test", "demo-maria-123"],
  recruiter: ["alex@example.test", "demo-alex-123"],
};
const deadline = () => new Date(Date.now() + 7 * 86400_000).toISOString();
async function capturePopulated(page, label) {
  mkdirSync("visual-evidence", { recursive: true });
  await page.screenshot({
    path: "visual-evidence/filled-" + label + ".png",
    fullPage: true,
    animations: "disabled",
  });
}
const unique = (description) => description + " " + randomUUID().slice(0, 8);

async function actor(browser, kind) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const [email, password] = credentials[kind];
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  const authResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/login") &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Войти в демо" }).click();
  const loginResponse = await authResponse;
  expect(loginResponse.status(), "Login HTTP status for " + kind).toBe(200);
  try {
    await expect(page.getByRole("navigation", { name: "Основные разделы" })).toBeVisible();
  } catch (error) {
    const visibleText = await page.locator("main").innerText().catch(() => "main unavailable");
    throw new Error("Login navigation failed for " + kind +
      " after HTTP " + loginResponse.status() +
      ". Visible screen: " + visibleText.slice(0, 1300), { cause: error });
  }
  return { page, context };
}

async function requestAs(page, method, path, body, expected = 200, revision) {
  const headers = {};
  if (method !== "GET") {
    const csrf = await page.context().request.get("/api/v1/auth/csrf");
    expect(csrf.status(), "CSRF bootstrap").toBe(200);
    headers["X-CSRF-Token"] = (await csrf.json()).csrf_token;
    headers["Idempotency-Key"] = randomUUID();
  }
  if (revision !== undefined) headers["If-Match"] = '"' + revision + '"';
  const response = await page.context().request.fetch("/api/v1" + path, {
    method,
    headers,
    ...(body === undefined ? {} : { data: body }),
  });
  const result = await response.json().catch(() => null);
  expect(response.status(), method + " " + path + ": " + JSON.stringify(result)).toBe(expected);
  return result;
}

async function createProjectAndVacancy(page, seats = 2) {
  const project = await requestAs(page, "POST", "/startups", {
    title: unique("E2E controlled project"), description: "Ephemeral browser test",
    allow_general_applications: true,
  }, 201);
  const vacancy = await requestAs(page, "POST", "/startups/" + project.id + "/vacancies", {
    title: unique("E2E version one"), description: "Original contract",
    requirements: "Python", positions_count: seats, application_deadline: deadline(),
  }, 201);
  return { project, vacancy };
}

async function apply(page, vacancyId) {
  return requestAs(page, "POST", "/applications", {
    target_type: "vacancy", target_id: vacancyId, message: "My original application",
  }, 201);
}

test("vacancy reset preserves historical version, then resubmission occurs via original application", async ({ browser }) => {
  const owner = await actor(browser, "owner");
  const candidate = await actor(browser, "candidate");
  try {
    const { vacancy } = await createProjectAndVacancy(owner.page);
    const first = await apply(candidate.page, vacancy.id);
    expect(first.status).toBe("pending");
    const changedTitle = unique("E2E version two");
    const next = await requestAs(owner.page, "POST", "/vacancies/" + vacancy.id + "/versions", {
      title: changedTitle, description: "Revised requirements",
      requirements: "Python and SQL", change_mode: "reset_applications",
      reason: "Automated reset test",
    }, 201, vacancy.revision);
    expect(next.version).toBe(2);

    const reset = await requestAs(candidate.page, "GET", "/applications/" + first.id);
    expect(reset.status).toBe("reset");

    await candidate.page.reload();
    await candidate.page.getByRole("button", { name: "Вакансии", exact: true }).click();
    const row = candidate.page.locator(".vacancy-block").filter({ hasText: changedTitle });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Новая попытка — через мои отклики" })).toBeDisabled();
    await row.getByRole("button", { name: "Мои отклики", exact: true }).click();
    await expect(candidate.page.getByRole("heading", { name: "Мои отклики" })).toBeVisible();
    await capturePopulated(candidate.page, "application-reset");

    await candidate.page.getByRole("button", { name: "Подать заново" }).click();
    const dialog = candidate.page.getByRole("dialog", { name: "Новая попытка отклика" });
    await dialog.getByLabel("Сообщение на новых условиях").fill("Updated for SQL and Python");
    await dialog.getByRole("button", { name: "Подтвердить" }).click();
    await expect(dialog).toBeHidden();

    const refreshed = await requestAs(candidate.page, "GET", "/applications/" + first.id);
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.status).toBe("pending");
    const attempts = (await requestAs(candidate.page, "GET", "/applications/" + first.id + "/attempts")).items;
    expect(attempts).toHaveLength(2);
    expect(attempts.find((a) => a.vacancy_version === 1)).toMatchObject({
      title: vacancy.title, status: "reset", is_current: false,
    });
    expect(attempts.find((a) => a.vacancy_version === 2)).toMatchObject({
      title: changedTitle, status: "pending", is_current: true,
    });
    const versions = (await requestAs(owner.page, "GET", "/vacancies/" + vacancy.id + "/versions")).items;
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
    const events = (await requestAs(candidate.page, "GET", "/applications/" + first.id + "/history")).items;
    expect(events.some((event) => event.event_type === "application.resubmitted")).toBe(true);
  } finally {
    await candidate.context.close();
    await owner.context.close();
  }
});

test("one reserved seat blocks competing offer; acceptance becomes occupied seat", async ({ browser }) => {
  const owner = await actor(browser, "owner");
  const a = await actor(browser, "candidate");
  const b = await actor(browser, "recruiter");
  try {
    const { project, vacancy } = await createProjectAndVacancy(owner.page, 1);
    const candidate = await apply(a.page, vacancy.id);
    const other = await apply(b.page, vacancy.id);
    const offer = await requestAs(owner.page, "POST", "/applications/" + candidate.id + "/offers", {
      expires_at: deadline(), message: "Reserved for first candidate",
    }, 201, candidate.revision);
    expect(offer.status).toBe("pending");
    const reserved = await requestAs(owner.page, "GET", "/vacancies/" + vacancy.id + "/capacity");
    expect(reserved).toMatchObject({ positions_count: 1, reserved: 1, occupied: 0, available: 0 });

    const denied = await requestAs(owner.page, "POST", "/applications/" + other.id + "/offers", {
      expires_at: deadline(), message: "Should not overbook",
    }, 409, other.revision);
    expect(denied.error.code).toBe("NO_CAPACITY");
    const unauthorized = await requestAs(owner.page, "POST", "/offers/" + offer.id + "/accept", undefined, 403, offer.revision);
    expect(unauthorized.error.code).toBe("PERMISSION_DENIED");

    await a.page.getByRole("button", { name: "Мои отклики" }).click();
    await expect(a.page.getByRole("heading", { name: "Мои отклики" })).toBeVisible();
    const acceptButton = a.page.getByRole("button", { name: "Принять приглашение" });
    await expect(acceptButton).toBeVisible();
    await capturePopulated(a.page, "pending-offer");
    await acceptButton.click();

    const occupied = await requestAs(owner.page, "GET", "/vacancies/" + vacancy.id + "/capacity");
    expect(occupied).toMatchObject({ positions_count: 1, reserved: 0, occupied: 1, available: 0 });
    const members = (await requestAs(owner.page, "GET", "/startups/" + project.id + "/members")).items;
    expect(members.filter((m) => !m.left_at)).toHaveLength(1);
    const secondCandidate = await requestAs(b.page, "GET", "/applications/" + other.id);
    expect(secondCandidate.status).toBe("pending");
  } finally {
    await b.context.close();
    await a.context.close();
    await owner.context.close();
  }
});

test("recruiter invitation gives management rights but no membership, revoke removes rights", async ({ browser }) => {
  const owner = await actor(browser, "owner");
  const recruiter = await actor(browser, "recruiter");
  const outsider = await actor(browser, "candidate");
  try {
    const { project } = await createProjectAndVacancy(owner.page, 2);
    const recruiterUser = await requestAs(recruiter.page, "GET", "/auth/me");
    const denied = await requestAs(outsider.page, "GET", "/startups/" + project.id + "/recruiters", undefined, 403);
    expect(denied.error.code).toBe("PERMISSION_DENIED");

    const invitation = await requestAs(owner.page, "POST", "/startups/" + project.id + "/recruiter-invitations", {
      user_id: recruiterUser.id, expires_at: deadline(),
    }, 201);
    const accepted = await requestAs(recruiter.page, "POST", "/recruiter-invitations/" + invitation.id + "/accept");
    expect(accepted.status).toBe("accepted");
    const grants = (await requestAs(owner.page, "GET", "/startups/" + project.id + "/recruiters")).items;
    expect(grants.some((g) => g.user_id === recruiterUser.id)).toBe(true);
    const members = (await requestAs(owner.page, "GET", "/startups/" + project.id + "/members")).items;
    expect(members.filter((m) => !m.left_at)).toHaveLength(0);

    await recruiter.page.reload();
    await recruiter.page.getByRole("button", { name: "Кабинет", exact: true }).click();
    await expect(recruiter.page.getByRole("heading", { name: "Кабинет" })).toBeVisible();
    const picker = recruiter.page.getByRole("combobox", { name: "Управляемый проект" });
    await expect(picker).toContainText(project.title);

    const vacancy = await requestAs(recruiter.page, "POST", "/startups/" + project.id + "/vacancies", {
      title: unique("Recruiter-authorized role"), description: "Delegated",
      requirements: "Test", positions_count: 2, application_deadline: deadline(),
    }, 201);
    expect(vacancy.startup_id).toBe(project.id);
    await requestAs(owner.page, "DELETE", "/startups/" + project.id + "/recruiters/" + recruiterUser.id, undefined, 204);
    const after = await requestAs(recruiter.page, "GET", "/startups/" + project.id + "/recruiters", undefined, 403);
    expect(after.error.code).toBe("PERMISSION_DENIED");
    const forbidden = await requestAs(recruiter.page, "POST", "/startups/" + project.id + "/vacancies", {
      title: unique("Forbidden role"), description: "",
      requirements: "", positions_count: 1, application_deadline: deadline(),
    }, 403);
    expect(forbidden.error.code).toBe("PERMISSION_DENIED");
    const memberAfter = (await requestAs(owner.page, "GET", "/startups/" + project.id + "/members")).items;
    expect(memberAfter.filter((m) => !m.left_at)).toHaveLength(0);
  } finally {
    await outsider.context.close();
    await recruiter.context.close();
    await owner.context.close();
  }
});

test("mobile recruiter workspace switches between candidate list and full detail", async ({ browser }) => {
  const owner = await actor(browser, "owner");
  const candidate = await actor(browser, "candidate");
  try {
    const { project, vacancy } = await createProjectAndVacancy(owner.page, 2);
    await apply(candidate.page, vacancy.id);
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.reload();
    await owner.page.getByRole("button", { name: "Кабинет", exact: true }).click();
    await expect(owner.page.getByRole("heading", { name: "Кабинет" })).toBeVisible();
    const projectPicker = owner.page.getByRole("combobox", { name: "Управляемый проект" });
    await projectPicker.selectOption(project.id);
    await expect(owner.page.getByRole("tablist", { name: "Управление проектом" })).toBeVisible();
    const candidateList = owner.page.locator(".cw-candidate-list");
    const detail = owner.page.locator(".cw-candidate-detail");
    await expect(candidateList).toBeVisible();
    await expect(detail).toBeHidden();
    await candidateList.locator(".cw-candidate-button").first().click();
    await expect(candidateList).toBeHidden();
    await expect(detail).toBeVisible();
    await expect(detail.getByText("My original application", { exact: true })).toBeVisible();
    await expect(detail.getByRole("heading", { name: "О кандидате" })).toBeVisible();
    await expect(detail.getByRole("heading", { name: "Попытки и условия" })).toBeVisible();
    await expect(detail.locator(".cw-candidate-facts")).toBeVisible();
    await capturePopulated(owner.page, "mobile-candidate-detail");
    await detail.getByRole("button", { name: "К списку откликов" }).click();
    await expect(candidateList).toBeVisible();
    await expect(detail).toBeHidden();
  } finally {
    await candidate.context.close();
    await owner.context.close();
  }
});

test("approved inline settings save with revision, persist on reload and pause/resume", async ({ browser }) => {
  const owner = await actor(browser, "owner");
  try {
    const { project } = await createProjectAndVacancy(owner.page);
    const newTitle = unique("Inline settings saved");
    await owner.page.getByRole("button", { name: "Кабинет", exact: true }).click();
    const picker = owner.page.getByRole("combobox", { name: "Управляемый проект" });
    await picker.selectOption(project.id);
    await owner.page.getByRole("tab", { name: "Настройки" }).click();
    const editor = owner.page.locator(".cw-project-settings-editor");
    await expect(editor.getByRole("heading", { name: "О проекте" })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await editor.getByRole("textbox", { name: "Название *" }).fill(newTitle);
    await editor.getByRole("textbox", { name: "Описание" }).fill("Real API inline settings");
    const general = editor.getByRole("checkbox", { name: /Разрешить общие отклики/ });
    const previous = await general.isChecked();
    await general.setChecked(!previous);
    await capturePopulated(owner.page, "inline-project-settings");
    await editor.getByRole("button", { name: "Сохранить" }).click();
    await expect(editor.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    const updated = await requestAs(owner.page, "GET", "/startups/" + project.id);
    expect(updated).toMatchObject({
      title: newTitle,
      description: "Real API inline settings",
      allow_general_applications: !previous,
    });
    expect(updated.revision).toBeGreaterThan(project.revision);
    await owner.page.reload();
    await owner.page.getByRole("button", { name: "Кабинет", exact: true }).click();
    await owner.page.getByRole("combobox", { name: "Управляемый проект" }).selectOption(project.id);
    await owner.page.getByRole("tab", { name: "Настройки" }).click();
    await expect(owner.page.locator(".cw-project-settings-editor")
      .getByRole("textbox", { name: "Название *" })).toHaveValue(newTitle);
    await expect(owner.page.locator(".cw-project-settings-editor")
      .getByRole("checkbox", { name: /Разрешить общие отклики/ }))
      .toBeChecked({ checked: !previous });
    await owner.page.getByRole("button", { name: "Приостановить набор" }).click();
    await expect(owner.page.getByText("Пауза", { exact: true }).first()).toBeVisible();
    const paused = await requestAs(owner.page, "GET", "/startups/" + project.id);
    expect(paused.status).toBe("paused");
    await owner.page.getByRole("button", { name: "Возобновить набор" }).click();
    // Click dispatches an async command; wait for the UI to receive the
    // server-confirmed new revision before asserting the persisted state.
    await expect(owner.page.getByRole("button", { name: "Приостановить набор" })).toBeVisible();
    const active = await requestAs(owner.page, "GET", "/startups/" + project.id);
    expect(active.status).toBe("active");
  } finally {
    await owner.context.close();
  }
});

test("failed inline settings save retains draft and never reports success", async ({ browser }) => {
  const owner = await actor(browser, "owner");
  try {
    const { project } = await createProjectAndVacancy(owner.page);
    await owner.page.getByRole("button", { name: "Кабинет", exact: true }).click();
    await owner.page.getByRole("combobox", { name: "Управляемый проект" }).selectOption(project.id);
    await owner.page.getByRole("tab", { name: "Настройки" }).click();

    const editor = owner.page.locator(".cw-project-settings-editor");
    const title = editor.getByRole("textbox", { name: "Название *" });
    const updatedTitle = unique("Retryable draft");
    await title.fill(updatedTitle);

    let failures = 0;
    await owner.page.route("**/api/v1/startups/" + project.id, async (route) => {
      if (route.request().method() === "PATCH" && failures++ === 0) {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });
    await editor.getByRole("button", { name: "Сохранить" }).click();
    await expect(owner.page.getByRole("alert")).toBeVisible();
    await expect(title).toHaveValue(updatedTitle);
    await expect(owner.page.getByText("Готово", { exact: true })).toHaveCount(0);

    // No write happened on the simulated network failure.
    const old = await requestAs(owner.page, "GET", "/startups/" + project.id);
    expect(old.title).toBe(project.title);

    await editor.getByRole("button", { name: "Сохранить" }).click();
    await expect(owner.page.getByRole("alert")).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    const saved = await requestAs(owner.page, "GET", "/startups/" + project.id);
    expect(saved.title).toBe(updatedTitle);
  } finally {
    await owner.context.close();
  }
});

test("stale revision conflict retains inline settings draft", async ({ browser }) => {
  const owner = await actor(browser, "owner");
  try {
    const { project } = await createProjectAndVacancy(owner.page);
    await owner.page.getByRole("button", { name: "Кабинет", exact: true }).click();
    await owner.page.getByRole("combobox", { name: "Управляемый проект" }).selectOption(project.id);
    await owner.page.getByRole("tab", { name: "Настройки" }).click();

    const editor = owner.page.locator(".cw-project-settings-editor");
    const title = editor.getByRole("textbox", { name: "Название *" });
    const myDraft = unique("Unsaved concurrent draft");
    await title.fill(myDraft);

    // A second editor commits while this tab still holds project revision 1.
    const updatedByAnotherEditor = unique("Changed elsewhere");
    await requestAs(
      owner.page, "PATCH", "/startups/" + project.id,
      { title: updatedByAnotherEditor }, 200, project.revision,
    );
    await editor.getByRole("button", { name: "Сохранить" }).click();

    const error = owner.page.getByRole("alert");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/верси|измен|конфликт|устар/i);
    await expect(title).toHaveValue(myDraft);
    await expect(owner.page.getByText("Готово", { exact: true })).toHaveCount(0);

    const persisted = await requestAs(owner.page, "GET", "/startups/" + project.id);
    expect(persisted.title).toBe(updatedByAnotherEditor);
    expect(persisted.title).not.toBe(myDraft);
  } finally {
    await owner.context.close();
  }
});

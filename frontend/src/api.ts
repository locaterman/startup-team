export type Person = {
  id: string;
  name: string;
  bio: string;
  skills: string[];
  portfolio_url: string | null;
};
export type Startup = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  status: string;
  allow_general_applications: boolean;
  revision: number;
};
export type Vacancy = {
  id: string;
  startup_id: string;
  owner_id: string;
  startup_status: string;
  title: string;
  description: string;
  requirements: string;
  positions_count: number;
  application_deadline: string;
  status: string;
  current_version: number;
  revision: number;
};
export type Application = {
  id: string;
  startup_id: string;
  vacancy_id: string | null;
  applicant_id: string;
  applicant_name: string;
  startup_title: string;
  vacancy_title: string | null;
  status: string;
  message: string;
  rejection_reason: string;
  revision: number;
};
export type Offer = {
  id: string;
  startup_id: string;
  candidate_id: string;
  vacancy_id: string | null;
  status: string;
  expires_at: string;
  revision: number;
  message: string;
  startup_title: string;
  vacancy_title: string | null;
  vacancy_description: string | null;
  vacancy_requirements: string | null;
};
export type TestVersion = {
  id: string;
  vacancy_id: string;
  version: number;
  description: string;
  submission_deadline: string;
  change_type: string;
};
export type Submission = {
  id: string;
  attempt_id: string;
  test_version_id: string;
  solution_url: string;
  status: string;
  submitted_at: string;
};
export type Attempt = {
  id: string;
  status: string;
  message: string;
  rejection_reason: string;
  is_current: boolean;
  vacancy_version: number | null;
  title: string | null;
  description: string | null;
  requirements: string | null;
  created_at: string;
};
export type Event = {
  id: string;
  event_type: string;
  created_at: string;
  actor_name?: string | null;
  metadata?: { reason?: string };
};
export type Member = {
  id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
};
export type Invitation = {
  id: string;
  startup_id: string;
  user_id: string;
  status: string;
  expires_at: string;
};
export type Grant = { id: string; user_id: string; granted_at: string };
export type Notification = {
  id: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};
export type Capacity = {
  positions_count: number;
  occupied: number;
  reserved: number;
  available: number;
};
export type Page<T> = { items: T[]; next_cursor: string | null };
let csrf = "";
const pending = new Map<string, string>();
const messages: Record<string, string> = {
  REVISION_CONFLICT:
    "Данные уже изменились. Закройте форму, обновите страницу и проверьте новые условия.",
  NO_CAPACITY: "Все места заняты или зарезервированы.",
  ALREADY_TEAM_MEMBER: "Вы уже состоите в команде этого проекта.",
  STARTUP_INACTIVE: "Набор в проект сейчас приостановлен.",
  GENERAL_APPLICATIONS_DISABLED: "Общие отклики в этот проект отключены.",
  APPLICATION_ALREADY_EXISTS:
    "Вы уже откликались. Откройте свой отклик в кабинете.",
  IDEMPOTENCY_CONFLICT:
    "Содержимое повторного запроса отличается от исходного.",
  PERMISSION_DENIED: "Недостаточно прав для этого действия.",
  APPLICATIONS_CLOSED: "Приём откликов завершён.",
  OFFER_EXPIRED: "Срок приглашения истёк.",
  SELF_REVIEW_FORBIDDEN:
    "Нельзя принимать управленческие решения по своей кандидатуре.",
};
export const setCsrf = (value: string) => {
  csrf = value;
  if (!value) pending.clear();
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  revision?: number,
): Promise<T> {
  const signature = JSON.stringify([method, path, body, revision]);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const command = method !== "GET" && !path.startsWith("/auth/");
  if (method !== "GET" && path !== "/auth/login")
    headers["X-CSRF-Token"] = csrf;
  if (command) {
    let key = pending.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      pending.set(signature, key);
    }
    headers["Idempotency-Key"] = key;
  }
  if (revision !== undefined) headers["If-Match"] = `"${revision}"`;
  const response = await fetch("/api/v1" + path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status < 500) pending.delete(signature);
    throw Error(
      messages[data?.error?.code] ||
        data?.error?.details?.errors
          ?.map((e: { msg: string }) => e.msg)
          .join("; ") ||
        data?.error?.message ||
        `Ошибка ${response.status}`,
    );
  }
  const result = response.status === 204 ? undefined : await response.json();
  pending.delete(signature);
  return result as T;
}
export async function all<T>(path: string): Promise<T[]> {
  let cursor: string | null = null;
  const result: T[] = [];
  const visited = new Set<string>();
  do {
    const page: Page<T> = await api<Page<T>>(
      path +
        (path.includes("?") ? "&" : "?") +
        "limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    result.push(...page.items);
    cursor = page.next_cursor;
    if (cursor && visited.has(cursor)) throw Error("Повтор страницы данных");
    if (cursor) visited.add(cursor);
  } while (cursor);
  return result;
}
export const dateTime = (value: string) =>
  new Date(value).toLocaleString("ru-RU");
export const localDate = (value?: string) => {
  const date = value ? new Date(value) : new Date(Date.now() + 7 * 86400000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export const instant = (value: string) => new Date(value).toISOString();

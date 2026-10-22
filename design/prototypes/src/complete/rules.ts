// Presentation-prototype transitions. The production backend remains authoritative.
import {
  uid,
  now,
  instant,
  isFuture,
  event,
  sync,
  type Store,
  type Entry,
  type Vacancy,
} from "./model";

export const currentAttempt = (a: Entry) => a.attempts[a.attempts.length - 1];
export const unfinished = (a: Entry) =>
  ["pending", "reviewing", "offer_pending"].includes(a.status);
export const currentSolution = (a: Entry) =>
  a.submissions
    .filter((t) => t.attempt === currentAttempt(a).number)
    .slice(-1)[0];
export const attemptConditions = (a: Entry, attempt: Entry['attempts'][number], v?: Vacancy) =>
  a.vacancy === v?.id ? v?.versions.find((x) => x.number === attempt.version) : undefined;
export const entryRole = (a: Entry, v?: Vacancy) =>
  a.vacancy
    ? attemptConditions(a, currentAttempt(a), v)?.title || "Историческая роль не сохранена"
    : "Общий отклик";

export function availableTestVersions(s: Store, a: Entry, v: Vacancy) {
  if (!unfinished(a) || a.vacancy !== v.id || v.status === 'archived' ||
      s.projects.find((p) => p.id === a.project)?.status === 'archived') return [];
  return v.tasks.filter((task) =>
    isFuture(task.deadline) &&
    !v.tasks.some((newer) => newer.critical && newer.version > task.version) &&
    !a.submissions.some((submission) => submission.attempt === currentAttempt(a).number && submission.testVersion === task.version),
  );
}
export const activeMember = (s: Store, pid: string, person: string) =>
  s.members.some((m) => m.project === pid && m.person === person && m.active);
export const canReapply = (s: Store, a: Entry) =>
  a.status === "reset" ||
  (["joined", "already_joined"].includes(a.status) &&
    !activeMember(s, a.project, a.person));
function requireRule(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
export function capacity(s: Store, v: Vacancy) {
  const occupied = s.members.filter(
    (m) => m.active && m.vacancy === v.id,
  ).length;
  const reserved = s.offers.filter(
    (o) =>
      o.status === "pending" &&
      isFuture(o.deadline) &&
      s.entries.find((a) => a.id === o.entry)?.vacancy === v.id,
  ).length;
  const unknown = s.members.some(
    (m) => m.project === v.project && m.active && m.originUnknown,
  );
  return {
    occupied,
    reserved,
    available: v.seats - occupied - reserved,
    unknown,
  };
}
export function assertIntake(s: Store, pid: string, vid: string | null) {
  const p = s.projects.find((p) => p.id === pid);
  requireRule(p?.status === "active", "Набор в проект сейчас остановлен.");
  if (vid) {
    const v = s.vacancies.find((v) => v.id === vid);
    requireRule(
      v?.status === "published" && isFuture(v.deadline),
      "Приём откликов завершён.",
    );
  } else requireRule(p.general, "Общие отклики отключены.");
}
export function assertApply(
  s: Store,
  pid: string,
  vid: string | null,
  person: string,
) {
  assertIntake(s, pid, vid);
  requireRule(
    s.profiles.some((p) => p.id === person),
    "Сначала войдите.",
  );
  requireRule(
    s.projects.find((p) => p.id === pid)?.owner !== person,
    "Владелец не откликается на свой проект.",
  );
  requireRule(!activeMember(s, pid, person), "Вы уже состоите в этой команде.");
  const prior = s.entries.find(
    (a) => a.project === pid && a.vacancy === vid && a.person === person,
  );
  requireRule(
    !prior || canReapply(s, prior),
    "Отклик уже существует. Откройте его историю.",
  );
}
export function createOffer(
  s: Store,
  id: string,
  message: string,
  deadline: string,
) {
  const a = s.entries.find((a) => a.id === id)!;
  requireRule(
    s.projects.find((p) => p.id === a.project)?.status === "active",
    "Новые приглашения доступны только в активном проекте.",
  );
  requireRule(
    ["pending", "reviewing"].includes(a.status),
    "Эта попытка больше не рассматривается.",
  );
  requireRule(
    !activeMember(s, a.project, a.person),
    "Кандидат уже состоит в команде.",
  );
  requireRule(isFuture(deadline), "Укажите будущий срок приглашения.");
  requireRule(
    !s.offers.some(
      (o) =>
        o.status === "pending" &&
        isFuture(o.deadline) &&
        s.entries.some(
          (x) =>
            x.id === o.entry &&
            x.project === a.project &&
            x.person === a.person,
        ),
    ),
    "Кандидату уже отправлено действующее приглашение в этот проект.",
  );
  const v = s.vacancies.find((v) => v.id === a.vacancy),
    at = currentAttempt(a);
  if (v) {
    const cap = capacity(s, v);
    requireRule(v.status !== "archived", "Вакансия в архиве.");
    requireRule(
      !cap.unknown,
      "У старого участника не сохранена привязка к вакансии. Достоверный расчёт мест невозможен.",
    );
    requireRule(cap.available > 0, "Все места заняты или зарезервированы.");
  }
  const conditions = v?.versions.find((v) => v.number === at.version);
  requireRule(!v || conditions, "Исторические условия попытки не найдены.");
  s.offers.push({
    id: uid(),
    entry: id,
    attempt: at.number,
    status: "pending",
    message,
    deadline: instant(deadline),
    title: conditions?.title || "Общее участие в проекте",
    description:
      conditions?.description ||
      s.projects.find((p) => p.id === a.project)!.description,
    requirements: conditions?.requirements || "Условия обсуждаются с командой",
    version: at.version,
  });
  a.status = "offer_pending";
  sync(a);
  event(
    s,
    id,
    "Приглашение отправлено",
    "Условия сохранены из попытки " +
      at.number +
      ". Членство — после согласия кандидата.",
  );
}
function reopen(s: Store, a: Entry) {
  a.status =
    s.projects.find((p) => p.id === a.project)?.status !== "archived" &&
    s.vacancies.find((v) => v.id === a.vacancy)?.status !== "archived"
      ? "reviewing"
      : "closed";
  sync(a);
}
export function decide(
  s: Store,
  id: string,
  action: "accept" | "decline" | "revoke",
) {
  const o = s.offers.find((o) => o.id === id)!,
    a = s.entries.find((a) => a.id === o.entry)!;
  requireRule(
    o.status === "pending" && isFuture(o.deadline),
    "Приглашение уже завершено или просрочено.",
  );
  requireRule(
    action === "revoke" ||
      (o.attempt !== null && o.attempt === currentAttempt(a).number),
    "В старом прототипе не сохранена однозначная связь с попыткой. Отзовите приглашение и отправьте новое.",
  );
  if (action === "accept") {
    requireRule(
      s.projects.find((p) => p.id === a.project)?.status !== "archived",
      "Проект в архиве.",
    );
    requireRule(
      !activeMember(s, a.project, a.person),
      "Вы уже состоите в команде.",
    );
    o.status = "accepted";
    a.status = "joined";
    sync(a);
    s.members.push({
      id: uid(),
      project: a.project,
      person: a.person,
      vacancy: a.vacancy,
      role: o.title,
      active: true,
    });
    for (const other of s.entries.filter(
      (x) =>
        x.id !== a.id &&
        x.project === a.project &&
        x.person === a.person &&
        ["pending", "reviewing", "offer_pending", "withdrawn"].includes(
          x.status,
        ),
    )) {
      other.status = "already_joined";
      sync(other);
      for (const otherOffer of s.offers.filter(
        (o) => o.entry === other.id && o.status === "pending",
      ))
        otherOffer.status = "revoked";
    }
  } else {
    o.status = action === "decline" ? "declined" : "revoked";
    if (action === "decline") {
      a.status = "declined";
      sync(a);
    } else if (
      a.status === "offer_pending" &&
      (o.attempt === null || o.attempt === currentAttempt(a).number)
    )
      reopen(s, a);
  }
  event(
    s,
    a.id,
    action === "accept"
      ? "Приглашение принято"
      : action === "decline"
        ? "Кандидат отказался"
        : "Приглашение отозвано",
  );
}
export function resetApplications(s: Store, vid: string, reason: string) {
  for (const a of s.entries.filter(
    (a) =>
      a.vacancy === vid &&
      ["pending", "reviewing", "withdrawn"].includes(a.status),
  )) {
    a.status = "reset";
    sync(a);
    event(s, a.id, "Условия обновлены · можно подать заново", reason);
  }
  // offer_pending remains on the original attempt and conditions, by design.
}
export function criticalTest(s: Store, v: Vacancy) {
  for (const a of s.entries.filter(
    (a) => a.vacancy === v.id && unfinished(a),
  )) {
    for (const solution of a.submissions.filter(
      (t) =>
        t.attempt === currentAttempt(a).number &&
        t.testVersion < v.tasks.length,
    ))
      solution.status = "superseded";
    event(
      s,
      a.id,
      "Тестовое обновлено",
      "Для незавершённой попытки доступна новая версия.",
    );
  }
}
export function submitSolution(
  s: Store,
  id: string,
  testVersion: number,
  url: string,
) {
  const a = s.entries.find((a) => a.id === id)!,
    v = s.vacancies.find((v) => v.id === a.vacancy)!;
  requireRule(unfinished(a), "Рассмотрение этой попытки завершено.");
  requireRule(
    s.projects.find((p) => p.id === a.project)?.status !== "archived" &&
      v.status !== "archived",
    "Набор архивирован.",
  );
  const task = v.tasks.find((t) => t.version === testVersion);
  requireRule(
    task && isFuture(task.deadline),
    "Срок этой версии задания истёк.",
  );
  requireRule(
    !v.tasks.some((t) => t.critical && t.version > testVersion),
    "После критического изменения нужна новая версия задания.",
  );
  requireRule(
    !a.submissions.some((submission) =>
      submission.attempt === currentAttempt(a).number && submission.testVersion === testVersion),
    "Для этой версии тестового уже отправлено решение. Оно сохранено в истории.",
  );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw Error("Введите корректную HTTPS-ссылку.");
  }
  requireRule(parsed.protocol === "https:", "Для решения нужна HTTPS-ссылка.");
  a.submissions.push({
    id: uid(),
    attempt: currentAttempt(a).number,
    testVersion,
    solution: parsed.href,
    status: "submitted",
    date: now(),
  });
  event(
    s,
    id,
    "Решение отправлено",
    "Попытка " +
      currentAttempt(a).number +
      " · версия тестового " +
      testVersion +
      " · " +
      parsed.href,
  );
}
export function emptyProject(s: Store, pid: string) {
  return (
    !s.entries.some((a) => a.project === pid) &&
    !s.members.some((m) => m.project === pid) &&
    !s.recruiters.some((g) => g.project === pid)
  );
}
export function deleteProject(s: Store, pid: string) {
  requireRule(
    emptyProject(s, pid),
    "В проекте есть история взаимодействий. Используйте архив.",
  );
  s.vacancies = s.vacancies.filter((v) => v.project !== pid);
  s.projects = s.projects.filter((p) => p.id !== pid);
}
export function expire(s: Store): boolean {
  let changed = false;
  for (const o of s.offers.filter(
    (o) => o.status === "pending" && !isFuture(o.deadline),
  )) {
    o.status = "expired";
    const a = s.entries.find((a) => a.id === o.entry);
    if (
      a &&
      a.status === "offer_pending" &&
      currentAttempt(a).number === o.attempt
    )
      reopen(s, a);
    changed = true;
  }
  for (const g of s.recruiters.filter(
    (g) => g.status === "invited" && g.deadline && !isFuture(g.deadline),
  )) {
    g.status = "expired";
    changed = true;
  }
  return changed;
}

export function setCapacity(s: Store, v: Vacancy, seats: number) {
  requireRule(
    Number.isInteger(seats) && seats > 0,
    "Количество мест должно быть положительным целым числом.",
  );
  const c = capacity(s, v);
  requireRule(
    !c.unknown || seats >= v.seats,
    "В старых данных не сохранена привязка участников: уменьшение мест требует проверки.",
  );
  requireRule(
    seats >= c.occupied + c.reserved,
    "Нельзя указать меньше мест, чем занято и зарезервировано.",
  );
  v.seats = seats;
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Tabs, Empty, Icon } from "../final/primitives";
import {
  load,
  seed,
  key,
  uid,
  day,
  instant,
  localInput,
  isFuture,
  now,
  format,
  event,
  sync,
  labels,
  type Store,
  type Entry,
  type Vacancy,
  type Offer,
} from "./model";
import "../final/style.css";
import "./style.css";
import { AttemptHistory } from "./AttemptHistory";
import {
  currentSolution,
  entryRole,
  availableTestVersions,
  canReapply,
  capacity,
  assertApply,
  assertIntake,
  createOffer,
  decide,
  resetApplications,
  criticalTest,
  submitSolution,
  emptyProject,
  deleteProject,
  expire,
  setCapacity,
} from "./rules";

type Field = {
  name: string;
  label: string;
  value?: string;
  type?: string;
  required?: boolean;
  hint?: string;
  options?: { value: string; label: string }[];
};
type Values = Record<string, string>;
type Modal = {
  title: string;
  content?: ReactNode;
  kind?: "project" | "entry" | "offer" | "vacancy";
  id?: string;
};
const screens = [
  "catalog",
  "vacancies",
  "applications",
  "cabinet",
  "profile",
  "notifications",
  "teams",
] as const;
type Screen = (typeof screens)[number];
function Form({
  fields,
  submit = "Сохранить",
  onSave,
  onCancel,
}: {
  fields: Field[];
  submit?: string;
  onSave: (v: Values) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.value || ""])),
  );
  const [error, setError] = useState("");
  return (
    <form
      className="complete-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          setError("");
          const submitted = new FormData(e.currentTarget);
          const submittedValues = Object.fromEntries(
            fields.map((f) => [
              f.name,
              f.type === "checkbox"
                ? String(submitted.has(f.name))
                : String(submitted.get(f.name) ?? values[f.name]),
            ]),
          );
          setValues(submittedValues);
          onSave(submittedValues);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось сохранить");
        }
      }}
    >
      {fields.map((f) => (
        <label key={f.name} className={f.type === "checkbox" ? "checkbox" : ""}>
          {f.type === "checkbox" ? (
            <>
              <input
                type="checkbox"
                name={f.name}
                required={f.required}
                checked={values[f.name] === "true"}
                onChange={(e) =>
                  setValues({ ...values, [f.name]: String(e.target.checked) })
                }
              />
              {f.label}
            </>
          ) : (
            <>
              <span>
                {f.label}
                {f.required && (
                  <span className="required" aria-hidden="true">
                    {" "}
                    *
                  </span>
                )}
              </span>
              {f.type === "person" ? (
                <PersonPicker
                  name={f.name}
                  options={f.options || []}
                  value={values[f.name]}
                  onChange={(value) =>
                    setValues({ ...values, [f.name]: value })
                  }
                />
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.name}
                  required={f.required}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                />
              ) : f.options ? (
                <select
                  name={f.name}
                  required={f.required}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.name}
                  required={f.required}
                  type={f.type || "text"}
                  min={f.type === "number" ? 1 : undefined}
                  value={values[f.name]}
                  onChange={(e) =>
                    setValues({ ...values, [f.name]: e.target.value })
                  }
                />
              )}
            </>
          )}
          {f.hint && <small className="field-hint">{f.hint}</small>}
        </label>
      ))}
      {error && (
        <p className="complete-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" type="submit">
          {submit}
        </button>
        <button className="quiet" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
function PersonPicker({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <span className="person-picker">
      <input
        type="search"
        aria-label="Найти участника по имени"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange("");
        }}
        placeholder="Имя участника"
      />
      <select
        name={name}
        aria-label="Участник сообщества"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Выберите участника</option>
        {shown.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {!shown.length && <small>Участник не найден.</small>}
    </span>
  );
}
function Badge({ value }: { value: string }) {
  return (
    <span className={"state state-" + value}>{labels[value] || value}</span>
  );
}
function App() {
  const params = new URLSearchParams(location.search);
  const [store, setStore] = useState<Store>(() => {
      const s = load();
      expire(s);
      return s;
    }),
    [actor, setActor] = useState(params.get("as") || "ivan");
  const [screen, setScreen] = useState<Screen>(
    screens.includes(params.get("screen") as Screen)
      ? (params.get("screen") as Screen)
      : "catalog",
  );
  const [projectId, setProjectId] = useState(params.get("project") || "atlas"),
    [tab, setTab] = useState(params.get("tab") || "responses");
  const [query, setQuery] = useState(""),
    [roleFilter, setRoleFilter] = useState(""),
    [onlyOpen, setOnlyOpen] = useState(false),
    [filters, setFilters] = useState(false);
  const [candidateId, setCandidateId] = useState("entry-anna"),
    [mobileDetail, setMobileDetail] = useState(false),
    [statusFilter, setStatusFilter] = useState("");
  const [modal, setModal] = useState<Modal | null>(null),
    [notice, setNotice] = useState(""),
    [account, setAccount] = useState(false),
    [unreadOnly, setUnreadOnly] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLElement | null>(null),
    wasOpen = useRef(false),
    detail = useRef<HTMLElement>(null);
  const me = store.profiles.find((p) => p.id === actor),
    profile = (id: string) => store.profiles.find((p) => p.id === id),
    project = (id: string) => store.projects.find((p) => p.id === id);
  const vacancy = (id: string | null) =>
      store.vacancies.find((v) => v.id === id),
    entry = (id: string) => store.entries.find((a) => a.id === id);
  const current = project(projectId) || store.projects[0];
  const canManage = (id: string) =>
    !!me &&
    (project(id)?.owner === actor ||
      store.recruiters.some(
        (g) => g.project === id && g.person === actor && g.status === "active",
      ));
  const managed = store.projects.filter((p) => canManage(p.id)),
    owner = current?.owner === actor;
  const member = (id: string) =>
    store.members.some(
      (m) => m.project === id && m.person === actor && m.active,
    );
  const role = (a: Entry) => entryRole(a, vacancy(a.vacancy));
  const selected = store.entries.find(
    (a) => a.id === candidateId && a.project === current?.id,
  );
  const incoming = store.entries.filter((a) => a.project === current?.id),
    filteredIncoming = incoming.filter(
      (a) => !statusFilter || a.status === statusFilter,
    );
  const title: Record<Screen, string> = {
    catalog: "Стартапы",
    vacancies: "Вакансии",
    applications: "Мои отклики",
    cabinet: "Кабинет",
    profile: "Мой профиль",
    notifications: "Уведомления",
    teams: "Мои команды",
  };
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(store));
    } catch {
      /* Storage is optional for the preview. */
    }
  }, [store]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("screen", screen);
    url.searchParams.set("as", actor);
    if (screen === "cabinet") {
      url.searchParams.set("project", projectId);
      url.searchParams.set("tab", tab);
    } else {
      url.searchParams.delete("project");
      url.searchParams.delete("tab");
    }
    history.replaceState(null, "", url);
    document.title = title[screen] + " — Startup Team";
    setAccount(false);
  }, [screen, actor, projectId, tab]);
  useEffect(() => {
    if (modal && !wasOpen.current) {
      trigger.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
      wasOpen.current = true;
    } else if (modal && wasOpen.current) {
      dialog.current
        ?.querySelector<HTMLElement>("input,textarea,select,button")
        ?.focus();
    } else if (!modal && wasOpen.current) {
      dialog.current?.close();
      wasOpen.current = false;
      trigger.current?.focus();
    }
  }, [modal]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setStore((previous) => {
          const next = structuredClone(previous);
          return expire(next) ? next : previous;
        }),
      30000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (mobileDetail && matchMedia("(max-width:650px)").matches)
      detail.current?.focus();
  }, [mobileDetail, candidateId]);
  const change = (
    fn: (s: Store) => void,
    message = "Изменение сохранено в прототипе",
    throwError = false,
  ) => {
    try {
      const next = structuredClone(store);
      expire(next);
      fn(next);
      setStore(next);
      setNotice(message);
      return true;
    } catch (e) {
      if (throwError) throw e;
      setNotice(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
      return false;
    }
  };
  const close = () => setModal(null);
  const form = (
    heading: string,
    fields: Field[],
    fn: (s: Store, v: Values) => void,
    submit = "Сохранить",
  ) =>
    setModal({
      title: heading,
      content: (
        <Form
          fields={fields}
          submit={submit}
          onCancel={close}
          onSave={(v) => {
            change((s) => fn(s, v), undefined, true);
            close();
          }}
        />
      ),
    });
  const go = (to: Screen) => {
    setScreen(to);
    setQuery("");
    setNotice("");
    setMobileDetail(false);
  };
  const chooseProject = (id: string) => {
    setProjectId(id);
    setCandidateId(store.entries.find((a) => a.project === id)?.id || "");
    setMobileDetail(false);
    setStatusFilter("");
  };
  const openEntry = (id: string) =>
    setModal({ title: "Отклик и история", kind: "entry", id });
  const openOffer = (id: string) =>
    setModal({ title: "Приглашение в команду", kind: "offer", id });
  const openVacancy = (id: string) =>
    setModal({ title: "Условия вакансии", kind: "vacancy", id });
  const login = () =>
    setModal({
      title: "Войти в Startup Team",
      content: (
        <div className="login-options">
          <p className="lead">
            Присоединяйтесь к проектам и собирайте свою команду.
          </p>
          <div className="callout">
            Дизайн входа. Проверка Telegram и серверная авторизация здесь не
            подключены.
          </div>
          <h3>Посмотреть от лица участника</h3>
          {store.profiles.map((p) => (
            <button
              className="identity-option"
              key={p.id}
              onClick={() => {
                setActor(p.id);
                close();
                setNotice("Выбран демонстрационный пользователь: " + p.name);
              }}
            >
              <span className="avatar">
                {p.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)}
              </span>
              <span>
                <strong>{p.name}</strong>
                <small>{p.skills || "Новый участник"}</small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
          <button
            className="secondary full"
            onClick={() =>
              form(
                "Первый вход · знакомство",
                [
                  {
                    name: "name",
                    label: "Как к вам обращаться",
                    required: true,
                  },
                  { name: "bio", label: "Расскажите о себе", type: "textarea" },
                  {
                    name: "skills",
                    label: "Навыки",
                    hint: "Например: Python, продуктовая аналитика",
                  },
                ],
                (s, v) => {
                  const id = uid();
                  s.profiles.push({
                    id,
                    name: v.name,
                    bio: v.bio,
                    skills: v.skills,
                    portfolio: "",
                  });
                  setActor(id);
                  setScreen("profile");
                },
                "Создать демопрофиль",
              )
            }
          >
            Посмотреть первый вход через Telegram
          </button>
        </div>
      ),
    });
  const requireMe = (fn: () => void) => {
    if (!me) login();
    else fn();
  };
  const startProject = () =>
    requireMe(() =>
      form(
        "Новый стартап",
        [
          { name: "title", label: "Название проекта", required: true },
          {
            name: "description",
            label: "О проекте и людях, которых вы ищете",
            required: true,
            type: "textarea",
          },
          {
            name: "general",
            label: "Разрешить общие отклики",
            type: "checkbox",
            value: "true",
          },
        ],
        (s, v) => {
          const id = uid();
          s.projects.unshift({
            id,
            title: v.title,
            description: v.description,
            status: "active",
            general: v.general === "true",
            owner: actor,
          });
          setProjectId(id);
          setScreen("cabinet");
          setTab("vacancies");
        },
        "Опубликовать проект",
      ),
    );
  const startVacancy = (pid: string) =>
    form(
      "Новая вакансия",
      [
        { name: "title", label: "Кого ищете", required: true },
        {
          name: "description",
          label: "Задачи и условия",
          type: "textarea",
          required: true,
        },
        {
          name: "requirements",
          label: "Что важно уметь",
          type: "textarea",
          required: true,
        },
        {
          name: "seats",
          label: "Количество мест",
          type: "number",
          value: "1",
          required: true,
        },
        {
          name: "deadline",
          label: "Приём откликов до",
          type: "datetime-local",
          value: day(14),
          required: true,
        },
      ],
      (s, v) => {
        if (!Number.isInteger(Number(v.seats)) || Number(v.seats) < 1)
          throw Error(
            "Количество мест должно быть положительным целым числом.",
          );
        s.vacancies.push({
          id: uid(),
          project: pid,
          title: v.title,
          description: v.description,
          requirements: v.requirements,
          seats: Number(v.seats),
          deadline: instant(v.deadline),
          status: "published",
          versions: [
            {
              number: 1,
              title: v.title,
              description: v.description,
              requirements: v.requirements,
              reason: "Публикация",
              date: now(),
            },
          ],
          tasks: [],
        });
      },
      "Опубликовать вакансию",
    );
  const apply = (pid: string, vid: string | null) =>
    requireMe(() =>
      form(
        vid ? "Отклик на вакансию" : "Общий интерес к проекту",
        [
          {
            name: "letter",
            label: "Сопроводительное письмо",
            type: "textarea",
            required: true,
            hint: "Расскажите, чем вам интересен проект и какой опыт вы можете предложить.",
          },
        ],
        (s, v) => {
          assertApply(s, pid, vid, actor);
          const prior = s.entries.find(
            (a) => a.project === pid && a.vacancy === vid && a.person === actor,
          );
          if (prior) {
            prior.letter = v.letter;
            prior.status = "pending";
            prior.reason = "";
            prior.attempts.push({
              number: prior.attempts.length + 1,
              version: vacancy(vid)?.versions.length || 1,
              letter: v.letter,
              status: "pending",
              reason: "",
              date: now(),
            });
            event(
              s,
              prior.id,
              "Подана новая попытка",
              "Предыдущие письма сохранены в истории.",
            );
          } else {
            const id = uid();
            s.entries.push({
              id,
              project: pid,
              vacancy: vid,
              person: actor,
              status: "pending",
              letter: v.letter,
              reason: "",
              attempts: [
                {
                  number: 1,
                  version: vacancy(vid)?.versions.length || 1,
                  letter: v.letter,
                  status: "pending",
                  reason: "",
                  date: now(),
                },
              ],
              submissions: [],
            });
            event(
              s,
              id,
              "Отклик отправлен",
              "Статус доступен в разделе «Мои отклики».",
            );
          }
        },
        "Отправить отклик",
      ),
    );
  const applicationButton = (pid: string, vid: string | null) => {
    const own = project(pid)?.owner === actor,
      existing = store.entries.find(
        (a) => a.project === pid && a.vacancy === vid && a.person === actor,
      ),
      v = vacancy(vid),
      p = project(pid);
    if (own)
      return (
        <p className="field-hint">
          Вы владелец этого проекта. Отклики доступны в кабинете.
        </p>
      );
    if (member(pid)) return <Badge value="joined" />;
    if (existing && !canReapply(store, existing))
      return (
        <button className="secondary" onClick={() => openEntry(existing.id)}>
          Открыть мой отклик
        </button>
      );
    if (existing && ["rejected", "declined"].includes(existing.status))
      return (
        <button className="quiet" onClick={() => openEntry(existing.id)}>
          Посмотреть решение
        </button>
      );
    if (
      p?.status !== "active" ||
      (v && (v.status !== "published" || !isFuture(v.deadline)))
    )
      return <p className="field-hint">Приём новых откликов завершён.</p>;
    return (
      <button className="primary" onClick={() => apply(pid, vid)}>
        {existing
          ? "Подать новую попытку"
          : vid
            ? "Откликнуться"
            : "Откликнуться на проект"}
      </button>
    );
  };
  const review = (a: Entry) =>
    change((s) => {
      const found = s.entries.find((x) => x.id === a.id)!;
      found.status = "reviewing";
      sync(found);
      event(s, a.id, "Начато рассмотрение");
    });
  const reject = (a: Entry) =>
    form(
      "Отказать с объяснением",
      [
        {
          name: "reason",
          label: "Причина решения",
          type: "textarea",
          required: true,
          hint: "Кандидат увидит причину в своём отклике.",
        },
      ],
      (s, v) => {
        const found = s.entries.find((x) => x.id === a.id)!;
        found.status = "rejected";
        found.reason = v.reason;
        sync(found);
        event(s, a.id, "Отказ", v.reason);
      },
      "Подтвердить отказ",
    );
  const invite = (a: Entry) =>
    form(
      "Пригласить в команду",
      [
        {
          name: "message",
          label: "Сообщение кандидату",
          type: "textarea",
          required: true,
        },
        {
          name: "deadline",
          label: "Приглашение действительно до",
          type: "datetime-local",
          value: day(7),
          required: true,
        },
      ],
      (s, values) => createOffer(s, a.id, values.message, values.deadline),
      "Отправить приглашение",
    );
  const withdraw = (a: Entry) =>
    form(
      a.status === "withdrawn" ? "Восстановить отклик?" : "Отозвать отклик?",
      [
        {
          name: "note",
          label: "Письмо и история сохранятся",
          type: "checkbox",
          value: "true",
          hint: "Это изменение статуса, а не удаление отклика.",
        },
      ],
      (s) => {
        const found = s.entries.find((x) => x.id === a.id)!;
        if (found.status === "withdrawn")
          assertIntake(s, found.project, found.vacancy);
        else if (!["pending", "reviewing"].includes(found.status))
          throw Error("Текущую попытку нельзя отозвать.");
        found.status = found.status === "withdrawn" ? "pending" : "withdrawn";
        sync(found);
        event(
          s,
          a.id,
          found.status === "withdrawn"
            ? "Отклик отозван"
            : "Отклик восстановлен",
        );
      },
      a.status === "withdrawn" ? "Восстановить" : "Отозвать",
    );
  const decideOffer = (o: Offer, action: "accept" | "decline" | "revoke") =>
    form(
      action === "accept"
        ? "Вступить в команду?"
        : action === "decline"
          ? "Отказаться от приглашения?"
          : "Отозвать приглашение?",
      [
        {
          name: "reason",
          label:
            action === "accept"
              ? "Комментарий для себя (необязательно)"
              : "Комментарий (необязательно)",
          type: "textarea",
          hint:
            action === "accept"
              ? "Будут приняты показанные условия."
              : "Приглашение останется в истории.",
        },
      ],
      (s) => decide(s, o.id, action),
      action === "accept"
        ? "Принять и вступить"
        : action === "decline"
          ? "Отказаться"
          : "Отозвать",
    );
  const versionForm = (v: Vacancy) =>
    form(
      "Новые условия вакансии",
      [
        { name: "title", label: "Название", value: v.title, required: true },
        {
          name: "description",
          label: "Задачи и условия",
          type: "textarea",
          value: v.description,
          required: true,
        },
        {
          name: "requirements",
          label: "Требования",
          type: "textarea",
          value: v.requirements,
          required: true,
        },
        {
          name: "reason",
          label: "Что изменилось и почему",
          type: "textarea",
          required: true,
        },
        {
          name: "reset",
          label: "Сбросить незавершённые отклики и разрешить новую попытку",
          type: "checkbox",
          hint: "Прежние письма и версии сохранятся. Ожидающие приглашения продолжат действовать на исходных условиях.",
        },
      ],
      (s, values) => {
        const found = s.vacancies.find((x) => x.id === v.id)!;
        found.title = values.title;
        found.description = values.description;
        found.requirements = values.requirements;
        found.versions.push({
          number: found.versions.length + 1,
          title: values.title,
          description: values.description,
          requirements: values.requirements,
          reason: values.reason,
          date: now(),
        });
        if (values.reset === "true") resetApplications(s, v.id, values.reason);
      },
      "Опубликовать версию",
    );
  const taskForm = (v: Vacancy) =>
    form(
      v.tasks.length ? "Новая версия тестового" : "Добавить тестовое",
      [
        {
          name: "description",
          label: "Задание",
          type: "textarea",
          required: true,
          value: v.tasks[v.tasks.length - 1]?.description || "",
        },
        {
          name: "deadline",
          label: "Срок сдачи",
          type: "datetime-local",
          value: day(7),
          required: true,
        },
        {
          name: "critical",
          label: "Критическое изменение: нужно новое решение",
          type: "checkbox",
          hint: "Старые решения останутся в истории.",
        },
      ],
      (s, values) => {
        const found = s.vacancies.find((x) => x.id === v.id)!;
        found.tasks.push({
          version: found.tasks.length + 1,
          description: values.description,
          deadline: instant(values.deadline),
          critical: values.critical === "true",
        });
        if (values.critical === "true") criticalTest(s, found);
      },
      "Опубликовать тестовое",
    );
  const solutionForm = (a: Entry, v: Vacancy) => {
    const available = availableTestVersions(store, a, v);
    if (!available.length) {
      setNotice("Нет доступной версии для сдачи. Отправленные решения сохранены в истории.");
      return;
    }
    form(
      "Отправить решение",
      [
        {
          name: "version",
          label: "Версия тестового",
          value: String(available[available.length - 1].version),
          options: available.map((t) => ({
            value: String(t.version),
            label: "Версия " + t.version + (t.critical ? " · критическая" : ""),
          })),
        },
        {
          name: "url",
          label: "Ссылка на решение",
          type: "url",
          required: true,
          hint: "Одна сдача каждой версии за попытку. Используйте HTTPS-ссылку на код, документ или демонстрацию.",
        },
      ],
      (s, values) =>
        submitSolution(s, a.id, Number(values.version), values.url),
      "Отправить решение",
    );
  };

  const entryDetails = (a: Entry) => {
    const p = profile(a.person),
      v = vacancy(a.vacancy),
      mine = a.person === actor,
      manager = canManage(a.project) && !mine,
      o = store.offers.find((x) => x.entry === a.id && x.status === "pending");
    return (
      <>
        <div className="record-heading">
          <p className="eyebrow">
            {project(a.project)?.title} · {role(a)}
          </p>
          <h2>{p?.name}</h2>
          <Badge value={a.status} />
        </div>
        {manager && ["pending", "reviewing"].includes(a.status) && (
          <div className="decision-actions">
            <button className="primary" onClick={() => invite(a)}>
              Пригласить
            </button>
            {a.status === "pending" && (
              <button className="secondary" onClick={() => review(a)}>
                Рассмотреть
              </button>
            )}
            <button className="quiet danger" onClick={() => reject(a)}>
              Отказать
            </button>
          </div>
        )}
        <section className="record-section">
          <h3>О кандидате</h3>
          <p>{p?.bio || "Описание пока не заполнено."}</p>
          <dl className="facts">
            <dt>Навыки</dt>
            <dd>{p?.skills || "Не указаны"}</dd>
            <dt>Портфолио</dt>
            <dd>
              {p?.portfolio ? (
                <a href={p.portfolio} target="_blank" rel="noreferrer">
                  Открыть портфолио ↗
                </a>
              ) : (
                "Не добавлено"
              )}
            </dd>
          </dl>
        </section>
        <section className="record-section">
          <h3>Сопроводительное письмо</h3>
          <p className="prewrap">{a.letter}</p>
          {a.reason && (
            <div className="callout">
              <strong>Причина решения</strong>
              <p>{a.reason}</p>
            </div>
          )}
        </section>
        {mine && ["pending", "reviewing", "withdrawn"].includes(a.status) && (
          <button className="secondary" onClick={() => withdraw(a)}>
            {a.status === "withdrawn"
              ? "Восстановить отклик"
              : "Отозвать отклик"}
          </button>
        )}
        {mine && canReapply(store, a) && (
          <button
            className="primary"
            onClick={() => apply(a.project, a.vacancy)}
          >
            Подать новую попытку
          </button>
        )}
        {o && (
          <div className="callout">
            <p>Получено приглашение · действительно до {format(o.deadline)}</p>
            <button className="secondary" onClick={() => openOffer(o.id)}>
              Посмотреть условия
            </button>
          </div>
        )}
        <section className="record-section">
          <h3>Тестовое задание</h3>
          {v?.tasks.length ? (
            <>
              <p className="eyebrow">
                Версия {v.tasks[v.tasks.length - 1].version} · до{" "}
                {format(v.tasks[v.tasks.length - 1].deadline)}
              </p>
              <p>{v.tasks[v.tasks.length - 1].description}</p>
              {currentSolution(a) && (
                <div className="solution">
                  <Badge value={currentSolution(a)!.status} />
                  <a
                    href={currentSolution(a)!.solution}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Решение версии {currentSolution(a)!.testVersion} ↗
                  </a>
                </div>
              )}
              {mine && availableTestVersions(store, a, v).length > 0 && (
                  <button
                    className="secondary"
                    onClick={() => solutionForm(a, v)}
                  >
                    Отправить решение
                  </button>
                )}
              {mine && ["pending", "reviewing", "offer_pending"].includes(a.status) && (
                <p className="subtle">
                  Для каждой версии тестового можно отправить одно решение за попытку.
                  {!availableTestVersions(store, a, v).length && ' Доступных версий для сдачи сейчас нет.'}
                </p>
              )}
              {manager && currentSolution(a)?.status === "submitted" && (
                <button
                  className="secondary"
                  onClick={() =>
                    change((s) => {
                      const found = s.entries.find((x) => x.id === a.id)!;
                      const solution = currentSolution(found);
                      if (!solution || solution.status !== "submitted")
                        throw Error("Решение уже изменилось.");
                      solution.status = "reviewed";
                      event(
                        s,
                        a.id,
                        "Тестовое проверено",
                        "Попытка " +
                          solution.attempt +
                          " · версия " +
                          solution.testVersion,
                      );
                    })
                  }
                >
                  Отметить проверенным
                </button>
              )}
            </>
          ) : (
            <p className="subtle">Тестовое для этой заявки не назначено.</p>
          )}
        </section>
        <section className="record-section">
          <h3>Все решения тестовых</h3>
          {[...a.submissions].reverse().map((solution) => (
            <article className="history-record" key={solution.id}>
              <p>
                {solution.attempt === null
                  ? "Из прежнего прототипа · попытка не определена"
                  : "Попытка " + solution.attempt}{" "}
                · тестовое v{solution.testVersion}
              </p>
              <div className="solution">
                <Badge value={solution.status} />
                <a href={solution.solution} target="_blank" rel="noreferrer">
                  Открыть решение ↗
                </a>
              </div>
              <p className="subtle">{format(solution.date)}</p>
            </article>
          ))}
          {!a.submissions.length && <p className="subtle">Решений пока нет.</p>}
        </section>
        <AttemptHistory entry={a} vacancy={v} />
        <section className="record-section">
          <h3>История событий</h3>
          <ol className="timeline">
            {store.events
              .filter((e) => e.entry === a.id)
              .map((e) => (
                <li key={e.id}>
                  <span>{format(e.date)}</span>
                  <strong>{e.title}</strong>
                  {e.detail && <p>{e.detail}</p>}
                </li>
              ))}
          </ol>
          {!store.events.some((e) => e.entry === a.id) && (
            <p className="subtle">Новых событий пока нет.</p>
          )}
        </section>
      </>
    );
  };
  const offerDetails = (o: Offer) => {
    const a = entry(o.entry)!;
    return (
      <>
        <div className="record-heading">
          <p className="eyebrow">{project(a.project)?.title}</p>
          <h2>{o.title}</h2>
          <Badge value={o.status} />
        </div>
        <div className="callout">
          <p>
            Приглашение для {profile(a.person)?.name}. Вступление в команду —
            только после согласия кандидата.
          </p>
        </div>
        <section className="record-section">
          <h3>Сообщение команды</h3>
          <p>{o.message}</p>
        </section>
        <section className="record-section">
          <h3>Условия приглашения · версия {o.version}</h3>
          <p>{o.description}</p>
          <p className="subtle">{o.requirements}</p>
          <dl className="facts">
            <dt>Ответить до</dt>
            <dd>{format(o.deadline)}</dd>
            <dt>Статус</dt>
            <dd>{labels[o.status] || o.status}</dd>
          </dl>
          <p className="field-hint">
            Показан снимок условий на момент приглашения.
          </p>
        </section>
        {o.status === "pending" && isFuture(o.deadline) && (
          <div className="form-actions">
            {a.person === actor ? (
              <>
                <button
                  className="primary"
                  onClick={() => decideOffer(o, "accept")}
                >
                  Принять и вступить
                </button>
                <button
                  className="quiet danger"
                  onClick={() => decideOffer(o, "decline")}
                >
                  Отказаться
                </button>
              </>
            ) : (
              canManage(a.project) && (
                <button
                  className="secondary"
                  onClick={() => decideOffer(o, "revoke")}
                >
                  Отозвать приглашение
                </button>
              )
            )}
          </div>
        )}
        <button className="quiet" onClick={() => openEntry(a.id)}>
          Открыть отклик и историю →
        </button>
      </>
    );
  };
  const vacancyDetails = (v: Vacancy) => {
    const { occupied, reserved, unknown } = capacity(store, v);
    return (
      <>
        <div className="record-heading">
          <p className="eyebrow">
            {project(v.project)?.title} · версия {v.versions.length}
          </p>
          <h2>{v.title}</h2>
          <Badge value={v.status} />
        </div>
        <section className="record-section">
          <h3>Задачи и условия</h3>
          <p className="prewrap">{v.description}</p>
        </section>
        <section className="record-section">
          <h3>Что важно уметь</h3>
          <p>{v.requirements}</p>
          <dl className="facts">
            <dt>Приём до</dt>
            <dd>{format(v.deadline)}</dd>
            <dt>Места</dt>
            <dd>
              {v.seats} всего · {occupied} занято · {reserved} зарезервировано
              {unknown && " · есть старая запись без связи с вакансией"}
            </dd>
          </dl>
        </section>
        {applicationButton(v.project, v.id)}
        <section className="record-section">
          <h3>Тестовое</h3>
          {v.tasks.length ? (
            <>
              <p>{v.tasks[v.tasks.length - 1].description}</p>
              <p className="subtle">
                Версия {v.tasks.length} · до{" "}
                {format(v.tasks[v.tasks.length - 1].deadline)}
              </p>
            </>
          ) : (
            <p className="subtle">Не назначено.</p>
          )}
        </section>
        {canManage(v.project) && (
          <>
            <div className="form-actions">
              <button className="secondary" onClick={() => versionForm(v)}>
                Изменить условия
              </button>
              <button className="secondary" onClick={() => taskForm(v)}>
                Настроить тестовое
              </button>
            </div>
            <section className="record-section">
              <h3>История версий</h3>
              {[...v.versions].reverse().map((x) => (
                <details className="history-record" key={x.number}>
                  <summary>
                    Версия {x.number} · {format(x.date)}
                  </summary>
                  <h4>{x.title}</h4>
                  <p>{x.description}</p>
                  <p className="subtle">{x.requirements}</p>
                  <p className="subtle">Изменение: {x.reason}</p>
                </details>
              ))}
              {v.tasks.map((t) => (
                <details className="history-record" key={"test-" + t.version}>
                  <summary>
                    Тестовое v{t.version}
                    {t.critical ? " · критическое изменение" : ""}
                  </summary>
                  <p>{t.description}</p>
                  <p className="subtle">Сдать до {format(t.deadline)}</p>
                </details>
              ))}
            </section>
          </>
        )}
      </>
    );
  };
  const projectDetails = (id: string) => {
    const p = project(id)!;
    return (
      <>
        <div className="record-heading">
          <p className="eyebrow">О проекте</p>
          <h2>{p.title}</h2>
          <Badge value={p.status} />
        </div>
        <p className="lead prewrap">{p.description}</p>
        <section className="record-section">
          <h3>Основатель</h3>
          <p>{profile(p.owner)?.name}</p>
          <p className="subtle">{profile(p.owner)?.bio}</p>
        </section>
        <section className="record-section">
          <h3>Открытые вакансии</h3>
          {store.vacancies
            .filter((v) => v.project === id && v.status !== "archived")
            .map((v) => (
              <article className="job" key={v.id}>
                <h4>{v.title}</h4>
                <p>{v.description}</p>
                <p className="subtle">
                  {v.seats} мест · до {format(v.deadline)}
                </p>
                <button className="secondary" onClick={() => openVacancy(v.id)}>
                  Условия и отклик
                </button>
              </article>
            ))}
          {!store.vacancies.some(
            (v) => v.project === id && v.status !== "archived",
          ) && <p className="subtle">Опубликованных вакансий пока нет.</p>}
        </section>
        {p.general && (
          <section className="record-section">
            <h3>Не нашли свою роль?</h3>
            <p className="subtle">
              Расскажите команде, чем можете быть полезны.
            </p>
            {applicationButton(id, null)}
          </section>
        )}
        {canManage(id) && (
          <button
            className="quiet"
            onClick={() => {
              chooseProject(id);
              go("cabinet");
              close();
            }}
          >
            Перейти к управлению проектом →
          </button>
        )}
      </>
    );
  };
  const newNoticeCount = store.notices.filter((n) => !n.read).length;
  const visibleProjects = store.projects.filter(
    (p) =>
      p.status === "active" &&
      (p.title + " " + p.description)
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!roleFilter ||
        store.vacancies.some(
          (v) => v.project === p.id && v.title === roleFilter,
        )) &&
      (!onlyOpen ||
        store.vacancies.some(
          (v) =>
            v.project === p.id &&
            v.status === "published" &&
            isFuture(v.deadline),
        )),
  );
  const myEntries = store.entries.filter((a) => a.person === actor),
    myOffers = store.offers.filter((o) =>
      myEntries.some((a) => a.id === o.entry),
    );
  const filteredVacancies = store.vacancies.filter(
    (v) =>
      project(v.project)?.status === "active" &&
      v.status === "published" &&
      isFuture(v.deadline) &&
      (v.title + " " + v.description + " " + project(v.project)?.title)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const changeTab = (value: string) => {
    setTab(value);
    setMobileDetail(false);
  };
  return (
    <>
      <a className="skip-link" href="#main">
        К содержимому
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href="?screen=catalog"
            onClick={(e) => {
              e.preventDefault();
              go("catalog");
            }}
          >
            <img src="/club-emblem.png" alt="" />
            <div>
              Бизнес-клуб<span>НИУ ВШЭ</span>
            </div>
          </a>
          <nav aria-label="Основные разделы">
            {(
              ["catalog", "vacancies", "applications", "cabinet"] as Screen[]
            ).map((id) => (
              <a
                key={id}
                href={"?screen=" + id}
                aria-current={screen === id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(id);
                }}
              >
                {title[id]}
              </a>
            ))}
          </nav>
          <div className="account">
            <button
              className="notification-button"
              aria-label={
                "Уведомления" +
                (newNoticeCount ? ": " + newNoticeCount + " непрочитанных" : "")
              }
              onClick={() => go("notifications")}
            >
              <svg
                viewBox="0 0 24 24"
                width="19"
                height="19"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4" />
              </svg>
              {newNoticeCount > 0 && <span className="notification-dot" />}
            </button>
            <button
              className="account-button"
              aria-expanded={account}
              aria-label={me ? "Меню профиля " + me.name : "Войти"}
              onClick={() => (me ? setAccount(!account) : login())}
            >
              <span>{me?.name || "Войти"}</span>
              <span className="account-initials">
                {me?.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2) || "→"}
              </span>
            </button>
            {account && (
              <div className="account-menu">
                <strong>{me?.name}</strong>
                <span>Участник сообщества</span>
                <button onClick={() => go("profile")}>Мой профиль</button>
                <button onClick={() => go("teams")}>Мои команды</button>
                <button
                  onClick={() => {
                    setAccount(false);
                    login();
                  }}
                >
                  Сменить демопользователя
                </button>
                <button
                  onClick={() => {
                    setActor("guest");
                    setAccount(false);
                    go("catalog");
                  }}
                >
                  Выйти
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="layout">
        <main id="main" tabIndex={-1}>
          <div className="prototype-ribbon">
            <span>
              <i /> Полный дизайн · демоданные
            </span>
            <button
              className="quiet"
              onClick={() =>
                setModal({
                  title: "О прототипе",
                  content: (
                    <>
                      <p className="lead">
                        Все согласованные сценарии в новой визуальной системе.
                      </p>
                      <p className="subtle">
                        Это отдельный дизайн-прототип. Он не обращается к API,
                        не авторизует через Telegram и не меняет рабочую базу.
                        Данные сохраняются только в вашем браузере. Права и
                        переходы здесь иллюстративные — сервер остаётся
                        источником истины при интеграции.
                      </p>
                      <div className="form-actions">
                        <button
                          className="secondary"
                          onClick={() => {
                            setStore(seed());
                            setActor("ivan");
                            chooseProject("atlas");
                            setTab("responses");
                            go("catalog");
                            close();
                            setNotice("Демонстрационные данные восстановлены.");
                          }}
                        >
                          Сбросить демоданные
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            setModal({
                              title: "Загрузка и ошибки",
                              content: (
                                <div className="state-examples">
                                  <section className="record-section first">
                                    <h3>Загрузка списка</h3>
                                    <div className="skeleton-row" />
                                    <div className="skeleton-row short" />
                                    <p className="field-hint">
                                      В рабочем приложении список появится после
                                      ответа API.
                                    </p>
                                  </section>
                                  <section className="record-section">
                                    <h3>Ошибка сети</h3>
                                    <h2 className="section-title">
                                      Не удалось загрузить данные
                                    </h2>
                                    <p className="subtle">
                                      Проверьте подключение и попробуйте ещё
                                      раз. Введённые данные сохранятся.
                                    </p>
                                    <button
                                      className="secondary"
                                      onClick={() => {
                                        close();
                                        setNotice(
                                          "Демонстрация повторной загрузки завершена.",
                                        );
                                      }}
                                    >
                                      Повторить
                                    </button>
                                  </section>
                                  <section className="record-section">
                                    <h3>Нет доступа</h3>
                                    <h2 className="section-title">
                                      Этот раздел доступен участникам проекта
                                    </h2>
                                    <p className="subtle">
                                      Проверьте выбранный аккаунт или вернитесь
                                      к каталогу.
                                    </p>
                                  </section>
                                  <section className="record-section">
                                    <h3>Конфликт изменений</h3>
                                    <div className="callout">
                                      Условия уже изменились. Сначала откройте
                                      новую версию, затем повторите действие.
                                    </div>
                                  </section>
                                  <section className="record-section">
                                    <h3>Срок приглашения истёк</h3>
                                    <Badge value="expired" />
                                    <p className="subtle">
                                      Принять это приглашение больше нельзя.
                                      История и прежние условия доступны для
                                      просмотра.
                                    </p>
                                  </section>
                                </div>
                              ),
                            })
                          }
                        >
                          Состояния загрузки и ошибок
                        </button>
                        <a className="quiet" href="/final.html">
                          Исходный final.html ↗
                        </a>
                      </div>
                    </>
                  ),
                })
              }
            >
              Что здесь работает?
            </button>
          </div>
          {(screen === "catalog" || screen === "vacancies") && (
            <>
              <section className="catalog-header">
                <div className="page-title">
                  <h1>{title[screen]}</h1>
                </div>
                <div className="discovery">
                  <label className="search">
                    <Icon name="search" />
                    <input
                      aria-label="Поиск проекта или роли"
                      placeholder="Проект или роль"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        aria-label="Очистить поиск"
                        onClick={() => setQuery("")}
                      >
                        <Icon name="close" />
                      </button>
                    )}
                  </label>
                  <button
                    className="filter-button"
                    aria-expanded={filters}
                    onClick={() => setFilters(!filters)}
                  >
                    <Icon name="filter" />
                    Фильтры
                  </button>
                  <button className="secondary" onClick={startProject}>
                    Создать проект
                  </button>
                </div>
              </section>
              {filters && (
                <div className="filter-panel">
                  <label>
                    Роль
                    <select
                      value={roleFilter}
                      onChange={(e) => setRoleFilter(e.target.value)}
                    >
                      <option value="">Любая роль</option>
                      {[...new Set(store.vacancies.map((v) => v.title))].map(
                        (r) => (
                          <option key={r}>{r}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={onlyOpen}
                      onChange={(e) => setOnlyOpen(e.target.checked)}
                    />
                    С открытым набором
                  </label>
                  <button
                    className="quiet"
                    onClick={() => {
                      setRoleFilter("");
                      setOnlyOpen(false);
                      setQuery("");
                    }}
                  >
                    Сбросить
                  </button>
                </div>
              )}
              {screen === "catalog" ? (
                <section className="project-list" aria-label="Стартапы">
                  {visibleProjects.map((p) => (
                    <article className="project-row" key={p.id}>
                      <div className="project-text">
                        <h2>
                          <button
                            onClick={() =>
                              setModal({
                                title: "О проекте",
                                kind: "project",
                                id: p.id,
                              })
                            }
                          >
                            {p.title}
                          </button>
                        </h2>
                        <p>{p.description.split(". ")[0]}.</p>
                      </div>
                      <div className="project-roles">
                        {store.vacancies
                          .filter(
                            (v) =>
                              v.project === p.id &&
                              v.status === "published" &&
                              isFuture(v.deadline),
                          )
                          .map((v) => (
                            <button
                              key={v.id}
                              onClick={() => openVacancy(v.id)}
                            >
                              {v.title}
                            </button>
                          ))}
                        {!store.vacancies.some(
                          (v) =>
                            v.project === p.id &&
                            v.status === "published" &&
                            isFuture(v.deadline),
                        ) && (
                          <span className="closed">Нет открытых вакансий</span>
                        )}
                      </div>
                    </article>
                  ))}
                  {!visibleProjects.length && (
                    <Empty
                      title="Проектов не найдено"
                      action={
                        <button
                          className="secondary"
                          onClick={() => {
                            setQuery("");
                            setRoleFilter("");
                            setOnlyOpen(false);
                          }}
                        >
                          Сбросить поиск
                        </button>
                      }
                    >
                      Попробуйте другое название или роль.
                    </Empty>
                  )}
                </section>
              ) : (
                <section className="vacancy-feed" aria-label="Все вакансии">
                  {filteredVacancies
                    .filter((v) => !roleFilter || v.title === roleFilter)
                    .map((v) => (
                      <article key={v.id}>
                        <div>
                          <p className="eyebrow">
                            {project(v.project)?.title} · версия{" "}
                            {v.versions.length}
                          </p>
                          <h2>
                            <button onClick={() => openVacancy(v.id)}>
                              {v.title}
                            </button>
                          </h2>
                          <p>{v.description}</p>
                          <div className="metadata">
                            <span>{v.seats} мест</span>
                            <span>До {format(v.deadline)}</span>
                          </div>
                        </div>
                        <button
                          className="secondary"
                          onClick={() => openVacancy(v.id)}
                        >
                          Посмотреть условия
                        </button>
                      </article>
                    ))}
                  {!filteredVacancies.filter(
                    (v) => !roleFilter || v.title === roleFilter,
                  ).length && (
                    <Empty title="Подходящих вакансий пока нет">
                      Измените запрос или вернитесь к каталогу проектов.
                    </Empty>
                  )}
                </section>
              )}
            </>
          )}
          {screen === "profile" &&
            (me ? (
              <>
                <div className="page-title">
                  <h1>Мой профиль</h1>
                </div>
                <div className="profile-layout">
                  <aside className="profile-summary">
                    <span className="avatar large">
                      {me.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <h2>{me.name}</h2>
                    <p>Участник Бизнес-клуба</p>
                    <div className="callout">
                      Этот профиль виден командам, которым вы отправляете
                      отклик.
                    </div>
                  </aside>
                  <section className="surface">
                    <h2 className="section-title">О себе</h2>
                    <Form
                      key={me.id}
                      fields={[
                        {
                          name: "name",
                          label: "Имя и фамилия",
                          value: me.name,
                          required: true,
                        },
                        {
                          name: "bio",
                          label: "Коротко о себе",
                          value: me.bio,
                          type: "textarea",
                        },
                        {
                          name: "skills",
                          label: "Навыки",
                          value: me.skills,
                          hint: "Перечислите через запятую.",
                        },
                        {
                          name: "portfolio",
                          label: "Портфолио",
                          value: me.portfolio,
                          type: "url",
                          hint: "Ссылка на сайт, профиль или примеры работ.",
                        },
                      ]}
                      onCancel={() => go("catalog")}
                      onSave={(values) =>
                        change(
                          (s) =>
                            Object.assign(
                              s.profiles.find((p) => p.id === actor)!,
                              values,
                            ),
                          "Профиль сохранён",
                        )
                      }
                    />
                  </section>
                </div>
              </>
            ) : (
              <Empty
                title="Давайте познакомимся"
                action={
                  <button className="primary" onClick={login}>
                    Войти
                  </button>
                }
              >
                Войдите, чтобы заполнить профиль и откликаться на проекты.
              </Empty>
            ))}
          {screen === "applications" && (
            <>
              <div className="page-title">
                <div>
                  <h1>Мои отклики</h1>
                  <p className="page-subtitle">
                    Решения команд, приглашения и история ваших заявок.
                  </p>
                </div>
                <button className="quiet" onClick={() => go("teams")}>
                  Мои команды →
                </button>
              </div>
              {!me ? (
                <Empty
                  title="Войдите, чтобы увидеть отклики"
                  action={
                    <button className="primary" onClick={login}>
                      Войти
                    </button>
                  }
                />
              ) : (
                <>
                  <section className="record-section first">
                    <h2 className="section-title">Приглашения в команду</h2>
                    {myOffers.length ? (
                      myOffers.map((o) => (
                        <article className="list-row" key={o.id}>
                          <div>
                            <p className="eyebrow">
                              {project(entry(o.entry)!.project)?.title}
                            </p>
                            <h3>{o.title}</h3>
                            <p>Ответить до {format(o.deadline)}</p>
                          </div>
                          <Badge value={o.status} />
                          <button
                            className="secondary"
                            onClick={() => openOffer(o.id)}
                          >
                            Условия приглашения
                          </button>
                        </article>
                      ))
                    ) : (
                      <div className="inline-empty">
                        Приглашений пока нет. Когда команда примет решение, оно
                        появится здесь.
                      </div>
                    )}
                  </section>
                  <section className="record-section">
                    <h2 className="section-title">Отправленные отклики</h2>
                    {myEntries.map((a) => (
                      <article className="list-row" key={a.id}>
                        <div>
                          <p className="eyebrow">{project(a.project)?.title}</p>
                          <h3>{role(a)}</h3>
                          <p className="clamp">{a.letter}</p>
                          {a.reason && (
                            <p className="decision-reason">
                              Причина: {a.reason}
                            </p>
                          )}
                        </div>
                        <Badge value={a.status} />
                        <button
                          className="secondary"
                          onClick={() => openEntry(a.id)}
                        >
                          Открыть отклик
                        </button>
                      </article>
                    ))}
                    {!myEntries.length && (
                      <Empty
                        title="Откликов пока нет"
                        action={
                          <button
                            className="primary"
                            onClick={() => go("catalog")}
                          >
                            Найти проект
                          </button>
                        }
                      >
                        Выберите проект и расскажите команде о себе.
                      </Empty>
                    )}
                  </section>
                  <section className="record-section">
                    <h2 className="section-title">Рекрутерские приглашения</h2>
                    {store.recruiters
                      .filter(
                        (g) => g.person === actor && g.status === "invited",
                      )
                      .map((g) => (
                        <article className="list-row" key={g.id}>
                          <div>
                            <h3>{project(g.project)?.title}</h3>
                            <p>
                              Помогать с рассмотрением кандидатов. Членство в
                              команде не создаётся. Приглашение до{" "}
                              {format(g.deadline)}.
                            </p>
                          </div>
                          <button
                            className="primary"
                            onClick={() =>
                              change((s) => {
                                if (
                                  s.projects.find((p) => p.id === g.project)
                                    ?.status === "archived"
                                )
                                  throw Error("Проект в архиве.");
                                if (
                                  s.recruiters.find((x) => x.id === g.id)
                                    ?.status !== "invited" ||
                                  !g.deadline ||
                                  !isFuture(g.deadline)
                                )
                                  throw Error(
                                    "Срок приглашения истёк или не был сохранён.",
                                  );
                                s.recruiters.find(
                                  (x) => x.id === g.id,
                                )!.status = "active";
                              }, "Рекрутерские полномочия приняты")
                            }
                          >
                            Принять полномочия
                          </button>
                          <button
                            className="quiet"
                            onClick={() =>
                              change((s) => {
                                s.recruiters.find(
                                  (x) => x.id === g.id,
                                )!.status = "declined";
                              })
                            }
                          >
                            Отказаться
                          </button>
                        </article>
                      ))}
                    {!store.recruiters.some(
                      (g) => g.person === actor && g.status === "invited",
                    ) && <p className="subtle">Новых приглашений нет.</p>}
                  </section>
                </>
              )}
            </>
          )}
          {screen === "cabinet" && (
            <>
              {!me ? (
                <Empty
                  title="Войдите в свой кабинет"
                  action={
                    <button className="primary" onClick={login}>
                      Войти
                    </button>
                  }
                />
              ) : !managed.length ? (
                <Empty
                  title="Здесь будут ваши проекты"
                  action={
                    <button className="primary" onClick={startProject}>
                      Создать первый проект
                    </button>
                  }
                >
                  Создайте стартап или примите приглашение стать рекрутером.
                </Empty>
              ) : (
                <>
                  <div className="page-title cabinet-title">
                    <div>
                      <h1>Кабинет</h1>
                      <p className="page-subtitle">
                        Проекты, кандидаты и люди вашей команды.
                      </p>
                    </div>
                    <div className="heading-actions">
                      <label className="project-picker">
                        <span className="sr-only">Управляемый проект</span>
                        <select
                          aria-label="Управляемый проект"
                          value={
                            managed.some((p) => p.id === projectId)
                              ? projectId
                              : ""
                          }
                          onChange={(e) => chooseProject(e.target.value)}
                        >
                          {!managed.some((p) => p.id === projectId) && (
                            <option value="">Выберите проект</option>
                          )}
                          {managed.map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.title} · {labels[p.status]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="secondary" onClick={startProject}>
                        Новый проект
                      </button>
                    </div>
                  </div>
                  {!canManage(current?.id) ? (
                    <Empty title="Выберите управляемый проект">
                      Список включает ваши проекты и проекты с рекрутерскими
                      полномочиями.
                    </Empty>
                  ) : (
                    <>
                      <div className="project-context">
                        <span>{current.title}</span>
                        <Badge value={current.status} />
                        <span className="subtle">
                          {owner ? "Вы основатель" : "Вы рекрутер"}
                        </span>
                      </div>
                      <Tabs
                        label="Управление проектом"
                        value={tab}
                        onChange={changeTab}
                        items={[
                          {
                            id: "responses",
                            label: "Отклики",
                            count: incoming.length,
                          },
                          { id: "vacancies", label: "Вакансии" },
                          { id: "invites", label: "Приглашения" },
                          { id: "team", label: "Команда" },
                          { id: "recruiters", label: "Рекрутеры" },
                          ...(owner
                            ? [{ id: "settings", label: "Настройки" }]
                            : []),
                        ]}
                      />
                      <div
                        className="work-panel"
                        role="tabpanel"
                        id={"panel-" + tab}
                        aria-labelledby={"tab-" + tab}
                      >
                        {tab === "responses" &&
                          (incoming.length ? (
                            <div
                              className={
                                "review-workspace " +
                                (mobileDetail ? "show-detail" : "")
                              }
                            >
                              <section
                                className="candidate-list"
                                aria-label="Входящие отклики"
                              >
                                <div className="candidate-filter">
                                  <select
                                    aria-label="Статус отклика"
                                    value={statusFilter}
                                    onChange={(e) => {
                                      setStatusFilter(e.target.value);
                                      setCandidateId(
                                        incoming.find(
                                          (a) =>
                                            !e.target.value ||
                                            a.status === e.target.value,
                                        )?.id || "",
                                      );
                                      setMobileDetail(false);
                                    }}
                                  >
                                    <option value="">Все отклики</option>
                                    {[
                                      ...new Set(incoming.map((a) => a.status)),
                                    ].map((s) => (
                                      <option value={s} key={s}>
                                        {labels[s] || s}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                {filteredIncoming.map((a) => (
                                  <button
                                    className="candidate-item"
                                    key={a.id}
                                    aria-pressed={selected?.id === a.id}
                                    onClick={() => {
                                      setCandidateId(a.id);
                                      setMobileDetail(true);
                                    }}
                                  >
                                    <strong>{profile(a.person)?.name}</strong>
                                    <span>{role(a)}</span>
                                    <div>
                                      <Badge value={a.status} />
                                      <time>
                                        {format(
                                          a.attempts[a.attempts.length - 1]
                                            .date,
                                        )}
                                      </time>
                                    </div>
                                  </button>
                                ))}
                                {!filteredIncoming.length && (
                                  <Empty title="Нет откликов с таким статусом" />
                                )}
                              </section>
                              <section
                                className="candidate-detail"
                                ref={detail}
                                tabIndex={-1}
                                aria-label="Профиль кандидата"
                              >
                                <button
                                  className="back-link"
                                  onClick={() => {
                                    setMobileDetail(false);
                                    requestAnimationFrame(() =>
                                      document
                                        .querySelector<HTMLButtonElement>(
                                          '.candidate-item[aria-pressed="true"]',
                                        )
                                        ?.focus(),
                                    );
                                  }}
                                >
                                  ← Все отклики
                                </button>
                                {selected ? (
                                  entryDetails(selected)
                                ) : (
                                  <Empty title="Выберите отклик">
                                    Здесь появится профиль кандидата, письмо и
                                    история.
                                  </Empty>
                                )}
                              </section>
                            </div>
                          ) : (
                            <Empty title="Пока нет откликов">
                              Отклики на вакансии и общие обращения появятся
                              здесь.
                            </Empty>
                          ))}
                        {tab === "vacancies" && (
                          <>
                            <div className="section-toolbar">
                              <h2 className="section-title">
                                Вакансии проекта
                              </h2>
                              {current.status !== "archived" && (
                                <button
                                  className="primary"
                                  onClick={() => startVacancy(current.id)}
                                >
                                  Добавить вакансию
                                </button>
                              )}
                            </div>
                            {store.vacancies
                              .filter((v) => v.project === current.id)
                              .map((v) => (
                                <article className="managed-vacancy" key={v.id}>
                                  <div className="list-row">
                                    <div>
                                      <p className="eyebrow">
                                        Версия {v.versions.length}
                                      </p>
                                      <h3>{v.title}</h3>
                                      <p>
                                        {v.seats} мест · приём до{" "}
                                        {format(v.deadline)}
                                      </p>
                                    </div>
                                    <Badge value={v.status} />
                                    <button
                                      className="secondary"
                                      onClick={() => openVacancy(v.id)}
                                    >
                                      Условия и версии
                                    </button>
                                  </div>
                                  {v.status !== "archived" &&
                                    current.status !== "archived" && (
                                      <div className="row-actions">
                                        <button
                                          className="quiet"
                                          onClick={() =>
                                            form(
                                              "Настройки набора",
                                              [
                                                {
                                                  name: "seats",
                                                  label: "Количество мест",
                                                  type: "number",
                                                  value: String(v.seats),
                                                  required: true,
                                                },
                                                {
                                                  name: "deadline",
                                                  label: "Приём откликов до",
                                                  type: "datetime-local",
                                                  value: localInput(v.deadline),
                                                  required: true,
                                                },
                                              ],
                                              (s, values) => {
                                                setCapacity(
                                                  s,
                                                  s.vacancies.find(
                                                    (x) => x.id === v.id,
                                                  )!,
                                                  Number(values.seats),
                                                );
                                                Object.assign(
                                                  s.vacancies.find(
                                                    (x) => x.id === v.id,
                                                  )!,
                                                  {
                                                    seats: Number(values.seats),
                                                    deadline: instant(
                                                      values.deadline,
                                                    ),
                                                  },
                                                );
                                              },
                                            )
                                          }
                                        >
                                          Места и срок
                                        </button>
                                        <button
                                          className="quiet"
                                          onClick={() =>
                                            change((s) => {
                                              s.vacancies.find(
                                                (x) => x.id === v.id,
                                              )!.status =
                                                v.status === "published"
                                                  ? "closed"
                                                  : "published";
                                            })
                                          }
                                        >
                                          {v.status === "published"
                                            ? "Закрыть приём"
                                            : "Возобновить приём"}
                                        </button>
                                        <button
                                          className="quiet danger"
                                          onClick={() =>
                                            form(
                                              "Архивировать вакансию?",
                                              [
                                                {
                                                  name: "note",
                                                  label:
                                                    "История и существующие приглашения сохранятся",
                                                  type: "checkbox",
                                                  value: "true",
                                                },
                                              ],
                                              (s) => {
                                                s.vacancies.find(
                                                  (x) => x.id === v.id,
                                                )!.status = "archived";
                                              },
                                              "Архивировать",
                                            )
                                          }
                                        >
                                          В архив
                                        </button>
                                      </div>
                                    )}
                                </article>
                              ))}
                            {!store.vacancies.some(
                              (v) => v.project === current.id,
                            ) && (
                              <Empty title="Кого ищет ваша команда?">
                                Добавьте первую вакансию с задачами, условиями и
                                сроком приёма.
                              </Empty>
                            )}
                          </>
                        )}
                        {tab === "invites" && (
                          <>
                            <div className="section-toolbar">
                              <h2 className="section-title">
                                Приглашения кандидатам
                              </h2>
                              <span className="subtle">
                                Условия сохраняются на момент отправки
                              </span>
                            </div>
                            {store.offers
                              .filter(
                                (o) => entry(o.entry)?.project === current.id,
                              )
                              .map((o) => (
                                <article className="list-row" key={o.id}>
                                  <div>
                                    <h3>
                                      {profile(entry(o.entry)!.person)?.name}
                                    </h3>
                                    <p>
                                      {o.title} · до {format(o.deadline)}
                                    </p>
                                  </div>
                                  <Badge value={o.status} />
                                  <button
                                    className="secondary"
                                    onClick={() => openOffer(o.id)}
                                  >
                                    Открыть приглашение
                                  </button>
                                </article>
                              ))}
                            {!store.offers.some(
                              (o) => entry(o.entry)?.project === current.id,
                            ) && (
                              <Empty title="Приглашений пока нет">
                                Пригласите кандидата из его отклика.
                              </Empty>
                            )}
                          </>
                        )}
                        {tab === "team" && (
                          <>
                            <div className="section-toolbar">
                              <h2 className="section-title">
                                Команда {current.title}
                              </h2>
                              <span className="subtle">
                                Членство появляется после согласия кандидата
                              </span>
                            </div>
                            <article className="list-row">
                              <div>
                                <h3>{profile(current.owner)?.name}</h3>
                                <p>Основатель проекта</p>
                              </div>
                              <span className="subtle">Владелец</span>
                            </article>
                            {store.members
                              .filter((m) => m.project === current.id)
                              .map((m) => (
                                <article className="list-row" key={m.id}>
                                  <div>
                                    <h3>{profile(m.person)?.name}</h3>
                                    <p>{m.role}</p>
                                  </div>
                                  <Badge
                                    value={m.active ? "joined" : "closed"}
                                  />
                                  {m.active && owner && (
                                    <button
                                      className="quiet danger"
                                      onClick={() =>
                                        form(
                                          "Исключить участника?",
                                          [
                                            {
                                              name: "reason",
                                              label: "Причина",
                                              type: "textarea",
                                              required: true,
                                              hint: "История участия сохранится.",
                                            },
                                          ],
                                          (s) => {
                                            s.members.find(
                                              (x) => x.id === m.id,
                                            )!.active = false;
                                          },
                                          "Исключить из команды",
                                        )
                                      }
                                    >
                                      Исключить
                                    </button>
                                  )}
                                </article>
                              ))}
                            <div className="callout">
                              Участник команды не получает рекрутерские
                              полномочия автоматически.
                            </div>
                          </>
                        )}
                        {tab === "recruiters" && (
                          <>
                            <div className="section-toolbar">
                              <h2 className="section-title">
                                Рекрутерские полномочия
                              </h2>
                              {owner && current.status !== "archived" && (
                                <button
                                  className="primary"
                                  onClick={() =>
                                    form(
                                      "Пригласить рекрутера",
                                      [
                                        {
                                          name: "person",
                                          type: "person",
                                          label: "Участник сообщества",
                                          required: true,
                                          value: store.profiles.find(
                                            (p) => p.id !== actor,
                                          )?.id,
                                          options: store.profiles
                                            .filter((p) => p.id !== actor)
                                            .map((p) => ({
                                              value: p.id,
                                              label: p.name + " · " + p.skills,
                                            })),
                                        },
                                        {
                                          name: "deadline",
                                          label: "Приглашение можно принять до",
                                          type: "datetime-local",
                                          value: day(7),
                                          required: true,
                                        },
                                      ],
                                      (s, values) => {
                                        if (!isFuture(values.deadline))
                                          throw Error("Укажите будущий срок.");
                                        if (
                                          s.recruiters.some(
                                            (g) =>
                                              g.project === current.id &&
                                              g.person === values.person &&
                                              ["active", "invited"].includes(
                                                g.status,
                                              ),
                                          )
                                        )
                                          throw Error(
                                            "Участник уже имеет полномочия или ожидающее приглашение.",
                                          );
                                        s.recruiters.push({
                                          id: uid(),
                                          project: current.id,
                                          person: values.person,
                                          status: "invited",
                                          deadline: instant(values.deadline),
                                        });
                                      },
                                      "Отправить приглашение",
                                    )
                                  }
                                >
                                  Пригласить рекрутера
                                </button>
                              )}
                            </div>
                            <p className="subtle">
                              Рекрутер может работать с кандидатами. Владелец
                              сохраняет управление проектом и полномочиями.
                            </p>
                            {store.recruiters
                              .filter((g) => g.project === current.id)
                              .map((g) => (
                                <article className="list-row" key={g.id}>
                                  <div>
                                    <h3>{profile(g.person)?.name}</h3>
                                    <p>
                                      {g.status === "active"
                                        ? "Может рассматривать отклики и отправлять приглашения"
                                        : "Приглашение и история полномочий"}
                                    </p>
                                  </div>
                                  <Badge value={g.status} />
                                  <span className="subtle">
                                    Приглашение до {format(g.deadline)}
                                  </span>
                                  {owner &&
                                    ["active", "invited"].includes(
                                      g.status,
                                    ) && (
                                      <button
                                        className="quiet danger"
                                        onClick={() =>
                                          form(
                                            "Отозвать полномочия?",
                                            [
                                              {
                                                name: "reason",
                                                label:
                                                  "Комментарий (необязательно)",
                                                type: "textarea",
                                                hint: "Членство человека в команде не изменится.",
                                              },
                                            ],
                                            (s) => {
                                              s.recruiters.find(
                                                (x) => x.id === g.id,
                                              )!.status = "revoked";
                                            },
                                            "Отозвать",
                                          )
                                        }
                                      >
                                        Отозвать
                                      </button>
                                    )}
                                </article>
                              ))}
                            {!store.recruiters.some(
                              (g) => g.project === current.id,
                            ) && (
                              <Empty title="Вы пока управляете набором самостоятельно">
                                Пригласите участника сообщества помочь с
                                кандидатами.
                              </Empty>
                            )}
                          </>
                        )}
                        {tab === "settings" && owner && (
                          <div className="settings-layout">
                            <section className="surface">
                              <h2 className="section-title">О проекте</h2>
                              <Form
                                key={current.id + current.status}
                                fields={[
                                  {
                                    name: "title",
                                    label: "Название",
                                    value: current.title,
                                    required: true,
                                  },
                                  {
                                    name: "description",
                                    label: "Описание",
                                    value: current.description,
                                    type: "textarea",
                                    required: true,
                                  },
                                  {
                                    name: "general",
                                    label: "Разрешить общие отклики",
                                    type: "checkbox",
                                    value: String(current.general),
                                    hint: "Участники смогут предложить помощь без выбора вакансии.",
                                  },
                                ]}
                                onCancel={() => changeTab("responses")}
                                onSave={(values) =>
                                  change((s) => {
                                    Object.assign(
                                      s.projects.find(
                                        (p) => p.id === current.id,
                                      )!,
                                      {
                                        title: values.title,
                                        description: values.description,
                                        general: values.general === "true",
                                      },
                                    );
                                  })
                                }
                              />
                            </section>
                            <aside>
                              <section className="settings-note">
                                <h3>Состояние проекта</h3>
                                <Badge value={current.status} />
                                <p>
                                  Пауза останавливает новые отклики. История и
                                  участники сохраняются.
                                </p>
                                {current.status !== "archived" && (
                                  <button
                                    className="secondary"
                                    onClick={() =>
                                      change((s) => {
                                        s.projects.find(
                                          (p) => p.id === current.id,
                                        )!.status =
                                          current.status === "active"
                                            ? "paused"
                                            : "active";
                                      })
                                    }
                                  >
                                    {current.status === "active"
                                      ? "Приостановить набор"
                                      : "Возобновить набор"}
                                  </button>
                                )}
                              </section>
                              <section className="settings-note danger-zone">
                                <h3>Удаление пустого проекта</h3>
                                <p>
                                  {emptyProject(store, current.id)
                                    ? "Взаимодействий с участниками нет. Проект можно удалить вместе с его вакансиями."
                                    : "В проекте есть история взаимодействий. Доступно только архивирование."}
                                </p>
                                <button
                                  className="quiet danger"
                                  disabled={!emptyProject(store, current.id)}
                                  onClick={() =>
                                    form(
                                      "Удалить пустой проект?",
                                      [
                                        {
                                          name: "confirm",
                                          label:
                                            "Удалить проект и вакансии без истории взаимодействий",
                                          type: "checkbox",
                                          required: true,
                                        },
                                      ],
                                      (s, values) => {
                                        if (values.confirm !== "true")
                                          throw Error("Подтвердите удаление.");
                                        deleteProject(s, current.id);
                                        setProjectId(
                                          s.projects.find(
                                            (p) => p.owner === actor,
                                          )?.id || "",
                                        );
                                        go("cabinet");
                                      },
                                      "Удалить пустой проект",
                                    )
                                  }
                                >
                                  Удалить пустой проект
                                </button>
                                <h3>Архивирование</h3>
                                <p>
                                  Завершит набор и отзовёт ожидающие
                                  приглашения. Участники и история останутся.
                                </p>
                                <button
                                  className="quiet danger"
                                  disabled={current.status === "archived"}
                                  onClick={() =>
                                    form(
                                      "Архивировать " + current.title + "?",
                                      [
                                        {
                                          name: "reason",
                                          label: "Комментарий (необязательно)",
                                          type: "textarea",
                                          hint: "Действие завершает набор. Архив не исключает участников из команды.",
                                        },
                                      ],
                                      (s) => {
                                        s.projects.find(
                                          (p) => p.id === current.id,
                                        )!.status = "archived";
                                        for (const v of s.vacancies.filter(
                                          (v) => v.project === current.id,
                                        ))
                                          v.status = "archived";
                                        for (const a of s.entries.filter(
                                          (a) =>
                                            a.project === current.id &&
                                            [
                                              "pending",
                                              "reviewing",
                                              "offer_pending",
                                            ].includes(a.status),
                                        )) {
                                          a.status = "closed";
                                          sync(a);
                                        }
                                        for (const o of s.offers.filter(
                                          (o) =>
                                            s.entries.some(
                                              (a) =>
                                                a.id === o.entry &&
                                                a.project === current.id,
                                            ) && o.status === "pending",
                                        ))
                                          o.status = "revoked";
                                        for (const g of s.recruiters.filter(
                                          (g) =>
                                            g.project === current.id &&
                                            g.status === "invited",
                                        ))
                                          g.status = "revoked";
                                      },
                                      "Архивировать проект",
                                    )
                                  }
                                >
                                  Архивировать проект
                                </button>
                              </section>
                            </aside>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {screen === "teams" && (
            <>
              <div className="page-title">
                <div>
                  <h1>Мои команды</h1>
                  <p className="page-subtitle">
                    Ваше участие и отдельно — помощь в подборе людей.
                  </p>
                </div>
              </div>
              <section className="record-section first">
                <h2 className="section-title">Участие в командах</h2>
                {store.members
                  .filter((m) => m.person === actor && m.active)
                  .map((m) => (
                    <article className="list-row" key={m.id}>
                      <div>
                        <h3>{project(m.project)?.title}</h3>
                        <p>{m.role}</p>
                      </div>
                      <button
                        className="secondary"
                        onClick={() =>
                          setModal({
                            title: "О проекте",
                            kind: "project",
                            id: m.project,
                          })
                        }
                      >
                        О проекте
                      </button>
                      <button
                        className="quiet danger"
                        onClick={() =>
                          form(
                            "Выйти из команды?",
                            [
                              {
                                name: "reason",
                                label: "Комментарий (необязательно)",
                                type: "textarea",
                                hint: "Членство завершится. Отклики и приглашения останутся в истории.",
                              },
                            ],
                            (s) => {
                              s.members.find((x) => x.id === m.id)!.active =
                                false;
                            },
                            "Выйти из команды",
                          )
                        }
                      >
                        Выйти
                      </button>
                    </article>
                  ))}
                {!store.members.some((m) => m.person === actor && m.active) && (
                  <Empty
                    title="Вы пока не присоединились к команде"
                    action={
                      <button className="primary" onClick={() => go("catalog")}>
                        Найти проект
                      </button>
                    }
                  >
                    Примите приглашение команды — и проект появится здесь.
                  </Empty>
                )}
              </section>
              <section className="record-section">
                <h2 className="section-title">Рекрутерские полномочия</h2>
                {store.recruiters
                  .filter((g) => g.person === actor && g.status === "active")
                  .map((g) => (
                    <article className="list-row" key={g.id}>
                      <div>
                        <h3>{project(g.project)?.title}</h3>
                        <p>
                          Рассмотрение кандидатов, без автоматического членства.
                        </p>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => {
                          chooseProject(g.project);
                          go("cabinet");
                        }}
                      >
                        Открыть кабинет
                      </button>
                    </article>
                  ))}
                {!store.recruiters.some(
                  (g) => g.person === actor && g.status === "active",
                ) && <p className="subtle">Действующих полномочий нет.</p>}
              </section>
            </>
          )}
          {screen === "notifications" && (
            <>
              <div className="page-title">
                <div>
                  <h1>Уведомления</h1>
                  <p className="page-subtitle">
                    Изменения по откликам, приглашениям и условиям.
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={!newNoticeCount}
                  onClick={() =>
                    change((s) => {
                      s.notices.forEach((n) => (n.read = true));
                    }, "Все уведомления прочитаны")
                  }
                >
                  Прочитать все
                </button>
              </div>
              <label className="checkbox notification-filter">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                />
                Только непрочитанные
              </label>
              <div className="notice-list">
                {store.notices
                  .filter((n) => !unreadOnly || !n.read)
                  .map((n) => (
                    <article
                      className={
                        "notification-row " + (!n.read ? "unread" : "")
                      }
                      key={n.id}
                    >
                      <span className="notice-marker" />
                      <div>
                        <h2>{n.title}</h2>
                        <p>{n.body}</p>
                        <div className="row-actions">
                          {n.entry && (
                            <button
                              className="quiet"
                              onClick={() => {
                                change((s) => {
                                  s.notices.find((x) => x.id === n.id)!.read =
                                    true;
                                }, "Уведомление прочитано");
                                openEntry(n.entry!);
                              }}
                            >
                              Открыть событие →
                            </button>
                          )}
                          {!n.read && (
                            <button
                              className="quiet"
                              onClick={() =>
                                change((s) => {
                                  s.notices.find((x) => x.id === n.id)!.read =
                                    true;
                                }, "Уведомление прочитано")
                              }
                            >
                              Прочитано
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
              </div>
              {!store.notices.some((n) => !unreadOnly || !n.read) && (
                <Empty title="Вы всё прочитали">
                  Новые события появятся здесь.
                </Empty>
              )}
            </>
          )}
          <p
            className={"notice " + (notice ? "visible" : "")}
            role="status"
            aria-live="polite"
          >
            {notice}
          </p>
          <footer>
            <span>Бизнес-клуб НИУ ВШЭ</span>
            <span>Дизайн-прототип · данные только в браузере</span>
          </footer>
        </main>
      </div>
      <dialog
        ref={dialog}
        className="project-dialog complete-dialog"
        aria-labelledby="complete-dialog-title"
        onCancel={close}
        onClose={() => {
          if (wasOpen.current) close();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input,select,textarea,a[href],summary",
            ),
          );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="dialog-top">
          <h2 id="complete-dialog-title">{modal?.title}</h2>
          <button
            className="icon-button"
            aria-label="Закрыть окно"
            onClick={close}
            autoFocus
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body" key={modal?.title + ":" + modal?.id}>
          {modal?.kind === "project" && modal.id
            ? projectDetails(modal.id)
            : modal?.kind === "entry" && modal.id && entry(modal.id)
              ? entryDetails(entry(modal.id)!)
              : modal?.kind === "offer" && modal.id
                ? offerDetails(store.offers.find((o) => o.id === modal.id)!)
                : modal?.kind === "vacancy" && modal.id
                  ? vacancyDetails(vacancy(modal.id)!)
                  : modal?.content}
        </div>
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

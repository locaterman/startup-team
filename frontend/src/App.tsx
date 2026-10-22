import { useEffect, useRef, useState } from "react";
import { Plus, ArrowLeft, Search, SlidersHorizontal, X } from "lucide-react";
import { AppHeader } from "./AppHeader";
import "./discovery.css";
import { api, all, setCsrf, dateTime, localDate, instant } from "./api";
import { AuthScreen, OnboardingScreen } from "./AuthScreen";
import { telegramApp, type AuthConfig, type AuthContext } from "./telegram";
import type {
  Person,
  Startup,
  Vacancy,
  Application,
  Offer,
  TestVersion,
  Submission,
  Attempt,
  Event,
  Member,
  Invitation,
  Grant,
  Notification,
  Capacity,
} from "./api";

type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};
type Values = Record<string, string>;
type Dialog = {
  title: string;
  fields: Field[];
  values?: Values;
  notice?: string;
  submit: (values: Values) => Promise<void>;
};
type Context = {
  user: Person;
  revision: number;
  refresh: () => void;
  perform: (fn: () => Promise<void>) => Promise<void>;
  form: (dialog: Dialog) => void;
  open: (startup: Startup) => void;
  busy: boolean;
};
const labels: Record<string, string> = {
  active: "Активен",
  paused: "Пауза",
  archived: "Архив",
  published: "Приём открыт",
  intake_closed: "Приём закрыт",
  pending: "Ожидает решения",
  reviewing: "На рассмотрении",
  offer_pending: "Приглашение",
  rejected: "Отказ",
  withdrawn: "Отозван",
  reset: "Можно подать заново",
  joined: "В команде",
  declined: "Отказ от приглашения",
  already_joined: "Завершён при вступлении",
  closed: "Завершён",
  accepted: "Принято",
  revoked: "Отозвано",
  expired: "Истекло",
  submitted: "Отправлено",
  reviewed: "Проверено",
  superseded: "Нужна новая версия",
};
const eventLabels: Record<string, string> = {
  "application.created": "Отклик отправлен",
  "application.resubmitted": "Подана новая попытка",
  "application.review": "Начато рассмотрение",
  "application.reject": "Отказ",
  "application.withdraw": "Отклик отозван",
  "application.restore": "Отклик восстановлен",
  "offer.sent": "Отправлено приглашение",
  "offer.accept": "Приглашение принято",
  "offer.decline": "Кандидат отказался",
  "offer.revoke": "Приглашение отозвано",
  "offer.expired": "Приглашение истекло",
  "member.left": "Выход из команды",
  "member.removed": "Исключение из команды",
  "vacancy.version.created": "Изменены условия вакансии",
  "test.version.created": "Обновлено тестовое",
  "test.submitted": "Получено решение",
  "test.reviewed": "Решение проверено",
};
function Status({ value }: { value: string }) {
  return (
    <span
      className={
        "status " +
        (["rejected", "declined"].includes(value)
          ? "red"
          : value === "joined"
            ? "green"
            : "")
      }
    >
      {labels[value] || value}
    </span>
  );
}
function useData<T>(request: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    request()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Ошибка загрузки");
      });
    return () => {
      active = false;
    };
  }, deps);
  return { data, error };
}
function DataState({ data, error }: { data: unknown; error: string }) {
  return error ? (
    <p className="error" role="alert">
      Не удалось загрузить: {error}
    </p>
  ) : data === undefined ? (
    <p className="muted" role="status">
      Загрузка…
    </p>
  ) : null;
}
function PersonName({ id }: { id: string }) {
  const r = useData(() => api<Person>("/users/" + id), [id]);
  return <span>{r.data?.name || "Участник"}</span>;
}
const text = (name: string, label: string, required = false): Field => ({
  name,
  label,
  required,
});
const area = (name: string, label: string): Field => ({
  name,
  label,
  type: "textarea",
});
const date = (name: string, label: string): Field => ({
  name,
  label,
  type: "datetime-local",
  required: true,
});
function FormDialog({
  dialog,
  busy,
  error,
  close,
  submit,
}: {
  dialog: Dialog;
  busy: boolean;
  error: string;
  close: () => void;
  submit: (v: Values) => void;
}) {
  const [values, setValues] = useState<Values>(dialog.values || {});
  const root = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current
      ?.querySelector<HTMLElement>("input,textarea,select,button")
      ?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-cover"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <form
        ref={root}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) close();
          if (e.key === "Tab") {
            const controls = Array.from(
              root.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input,textarea,select",
              ) || [],
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
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          submit(values);
        }}
      >
        <div className="modal-top">
          <h2>{dialog.title}</h2>
          <button
            type="button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        </div>
        {dialog.notice && <p>{dialog.notice}</p>}
        {dialog.fields.map((field) => (
          <label key={field.name}>
            {field.label}
            {field.options ? (
              <select
                required={field.required}
                value={values[field.name] || ""}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                maxLength={field.name === "reason" ? 2000 : 5000}
                value={values[field.name] || ""}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              />
            ) : (
              <input
                type={field.type || "text"}
                required={field.required}
                min={field.type === "number" ? 1 : undefined}
                maxLength={
                  field.name === "title"
                    ? 180
                    : field.name === "name"
                      ? 120
                      : 5000
                }
                value={values[field.name] || ""}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              />
            )}
          </label>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy} className="primary">
          {busy ? "Сохранение…" : "Подтвердить"}
        </button>
      </form>
    </div>
  );
}
export default function App() {
  const [user, setUser] = useState<Person | null>(null),
    [ready, setReady] = useState(false),
    [tab, setTab] = useState("projects"),
    [selected, setSelected] = useState<Startup | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [email, setEmail] = useState("ivan@example.test"),
    [password, setPassword] = useState("demo-ivan-123");
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    telegram_enabled: false,
    demo_enabled: false,
  });
  const [onboarding, setOnboarding] = useState(false);
  const refresh = () => setRevision((v) => v + 1);
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      refresh();
      setNotice("Готово");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setBusy(false);
    }
  };
  const form = (value: Dialog) => {
    setError("");
    setDialog(value);
  };
  const finishLogin = async (person: Person) => {
    setCsrf((await api<{ csrf_token: string }>("/auth/csrf")).csrf_token);
    const context = await api<AuthContext>("/auth/context");
    setOnboarding(context.onboarding_required);
    setUser(person);
    setTab("projects");
    setSelected(null);
  };
  const login = async () => {
    await finishLogin(
      await api<Person>("/auth/login", "POST", { email, password }),
    );
  };
  const loginTelegram = async () => {
    const initData = telegramApp()?.initData;
    if (!initData)
      throw Error("Откройте приложение через Telegram-бота клуба.");
    await finishLogin(
      await api<Person>("/auth/telegram", "POST", { init_data: initData }),
    );
  };
  const bootstrap = async () => {
    setReady(false);
    setError("");
    try {
      setAuthConfig(await api<AuthConfig>("/auth/config"));
      if (telegramApp()?.initData) {
        await loginTelegram();
      } else {
        try {
          await finishLogin(await api<Person>("/auth/me"));
        } catch {
          setUser(null);
        }
      }
    } catch (e) {
      setUser(null);
      setError(e instanceof Error ? e.message : "Не удалось проверить вход");
    } finally {
      setReady(true);
      telegramApp()?.ready();
      telegramApp()?.expand();
    }
  };
  useEffect(() => {
    void bootstrap();
  }, []);
  if (!ready)
    return (
      <main className="tg-auth">
        <p role="status" style={{ paddingTop: 60 }}>
          Проверяем вход…
        </p>
      </main>
    );
  if (!user)
    return (
      <AuthScreen
        config={authConfig}
        insideTelegram={!!telegramApp()?.initData}
        error={error}
        busy={busy}
        email={email}
        password={password}
        onEmail={setEmail}
        onPassword={setPassword}
        onDemo={() => void perform(login)}
        onTelegram={() => void perform(loginTelegram)}
        onRetry={() => void perform(bootstrap)}
      />
    );
  if (onboarding)
    return (
      <OnboardingScreen
        user={user}
        busy={busy}
        error={error}
        onSave={(values) =>
          void perform(async () => {
            setUser(await api<Person>("/users/me", "PATCH", values));
            setOnboarding(false);
          })
        }
        onLogout={() =>
          void perform(async () => {
            await api("/auth/logout", "POST");
            setCsrf("");
            setUser(null);
            setOnboarding(false);
          })
        }
      />
    );
  const context: Context = {
    user,
    revision,
    refresh,
    perform,
    form,
    open: (p) => {
      setSelected(p);
      setTab("projects");
    },
    busy,
  };
  return (
    <div className={"page" + (tab === "vacancies" || (tab === "projects" && !selected) ? " integrated-design-page" : "")}>
      <AppHeader
        user={user}
        active={tab}
        busy={busy}
        onNavigate={(section) => {
          setSelected(null);
          setTab(section);
          setError("");
          setNotice("");
        }}
        onLogout={() =>
          void perform(async () => {
            await api("/auth/logout", "POST");
            setCsrf("");
            setUser(null);
            setSelected(null);
            setDialog(null);
          })
        }
      />
      <main id="app-content" tabIndex={-1} className={"container content" + (tab === "vacancies" || (tab === "projects" && !selected) ? " integrated-content" : "")}>
        {error && !dialog && (
          <div className="banner error" role="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {notice && (
          <div className="banner good" role="status">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {tab === "projects" &&
          (selected ? (
            <ProjectView
              key={selected.id}
              startupId={selected.id}
              ctx={context}
              back={() => setSelected(null)}
            />
          ) : (
            <Feed kind="startups" ctx={context} />
          ))}
        {tab === "vacancies" && <Feed kind="vacancies" ctx={context} />}
        {tab === "cabinet" && (
          <Cabinet key={user.id} ctx={context} updateUser={setUser} />
        )}
      </main>
      <footer className="container footer">
        Бизнес-клуб · Startup Team · 2026
      </footer>
      {dialog && (
        <FormDialog
          dialog={dialog}
          busy={busy}
          error={error}
          close={() => {
            setDialog(null);
            setError("");
          }}
          submit={(values) =>
            void perform(async () => {
              await dialog.submit(values);
              setDialog(null);
            })
          }
        />
      )}
    </div>
  );
}
function Feed({ kind, ctx }: { kind: "startups" | "vacancies"; ctx: Context }) {
  // Fetch every authorized page before applying client-side search and filters.
  // Filtering just the first backend page would silently hide matching records.
  const projects = useData(
    () => all<Startup>("/startups?scope=public"),
    [ctx.user.id, ctx.revision],
  );
  const vacancies = useData(
    () => all<Vacancy>("/vacancies"),
    [ctx.user.id, ctx.revision],
  );
  const managed = useData(
    () => all<Startup>("/startups?scope=managed"),
    [ctx.user.id, ctx.revision],
  );
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectedVacancyId, setSelectedVacancyId] = useState<string | null>(null);

  useEffect(() => {
    setVisibleCount(20);
    setSelectedVacancyId(null);
  }, [kind, query, roleFilter, onlyOpen, ctx.user.id]);

  const loadingError = projects.error || vacancies.error;
  const loaded = projects.data !== undefined && vacancies.data !== undefined;
  const allProjects = projects.data || [];
  const allVacancies = vacancies.data || [];
  const now = Date.now();
  const isOpen = (v: Vacancy) =>
    v.startup_status === "active" &&
    v.status === "published" &&
    new Date(v.application_deadline).getTime() > now;
  const openVacancies = allVacancies.filter(isOpen);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const contains = (value: string | null | undefined) =>
    (value || "").toLocaleLowerCase("ru-RU").includes(normalizedQuery);
  const roleOptions = Array.from(new Set(openVacancies.map((v) => v.title)))
    .sort((a, b) => a.localeCompare(b, "ru-RU"));

  const projectVacancies = (projectId: string) =>
    openVacancies.filter((v) => v.startup_id === projectId);
  const filteredProjects = allProjects.filter((p) => {
    const roles = projectVacancies(p.id);
    const matchingText =
      !normalizedQuery ||
      contains(p.title) ||
      contains(p.description) ||
      roles.some((v) => contains(v.title) || contains(v.requirements));
    return matchingText &&
      (!roleFilter || roles.some((v) => v.title === roleFilter)) &&
      (!onlyOpen || roles.length > 0);
  });
  const filteredVacancies = allVacancies.filter((v) =>
    (!normalizedQuery ||
      contains(v.title) ||
      contains(v.description) ||
      contains(v.requirements) ||
      contains(allProjects.find((p) => p.id === v.startup_id)?.title)) &&
    (!roleFilter || v.title === roleFilter) &&
    (!onlyOpen || isOpen(v)),
  );
  const currentItems = kind === "startups" ? filteredProjects : filteredVacancies;
  const currentVisible = currentItems.slice(0, visibleCount);
  const selectedVacancy = selectedVacancyId
    ? allVacancies.find((v) => v.id === selectedVacancyId)
    : undefined;
  const canManage = (startupId: string) =>
    (managed.data || []).some((p) => p.id === startupId);
  const resetFilters = () => {
    setQuery("");
    setRoleFilter("");
    setOnlyOpen(false);
  };

  return (
    <section className="integrated-discovery" aria-label={kind === "startups" ? "Каталог проектов" : "Каталог вакансий"}>
      <div className="integrated-discovery-head">
        <div>
          <h1>{kind === "startups" ? "Стартапы" : "Вакансии"}</h1>
          <p className="integrated-discovery-description">
            {kind === "startups"
              ? "Проекты участников Бизнес-клуба и открытые роли."
              : "Найдите роль и откликнитесь на актуальную вакансию."}
          </p>
        </div>
        <div className="integrated-discovery-actions">
          <label className="integrated-discovery-search">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Поиск проекта или роли"
              placeholder="Проект или роль"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")}>
                <X size={16} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="integrated-discovery-filter-toggle"
            aria-expanded={showFilters}
            aria-controls="integrated-discovery-filters"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal size={17} aria-hidden="true" /> Фильтры
          </button>
          {kind === "startups" && (
            <button
              type="button"
              className="integrated-discovery-secondary"
              disabled={ctx.busy}
              onClick={() =>
                ctx.form({
                  title: "Новый стартап",
                  fields: [
                    text("title", "Название", true),
                    area("description", "Описание"),
                  ],
                  submit: async (values) => {
                    await api("/startups", "POST", {
                      ...values,
                      allow_general_applications: true,
                    });
                  },
                })
              }
            >
              <Plus size={17} aria-hidden="true" /> Создать проект
            </button>
          )}
        </div>
      </div>
      {showFilters && (
        <div id="integrated-discovery-filters" className="integrated-discovery-filters">
          <label className="integrated-discovery-role">
            Роль
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">Любая роль</option>
              {roleOptions.map((role) => (
                <option value={role} key={role}>{role}</option>
              ))}
            </select>
          </label>
          <label className="integrated-discovery-check">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(event) => setOnlyOpen(event.target.checked)}
            />
            С открытым набором
          </label>
          <button type="button" className="integrated-discovery-reset" onClick={resetFilters}>
            Сбросить
          </button>
        </div>
      )}
      <DataState data={loaded ? true : undefined} error={loadingError} />
      {loaded && !loadingError && (
        <>
          <p className="integrated-discovery-status" role="status">
            {currentItems.length
              ? "Найдено: " + currentItems.length + ". Показано: " + currentVisible.length + "."
              : "По выбранным условиям ничего не найдено."}
          </p>
          {kind === "startups" ? (
            <div className="integrated-discovery-projects" aria-label="Стартапы">
              {(currentVisible as Startup[]).map((project) => {
                const roles = projectVacancies(project.id);
                return (
                  <article key={project.id} className="integrated-project-row">
                    <h2>
                      <button type="button" onClick={() => ctx.open(project)}>
                        {project.title}
                      </button>
                    </h2>
                    <p>{project.description || "Описание пока не добавлено."}</p>
                    <div className="integrated-project-roles">
                      {roles.length ? roles.map((vacancy) => (
                        <button
                          type="button"
                          className="integrated-project-role"
                          key={vacancy.id}
                          onClick={() => setSelectedVacancyId(vacancy.id)}
                          aria-label={"Посмотреть вакансию " + vacancy.title + " в проекте " + project.title}
                        >
                          {vacancy.title}
                        </button>
                      )) : <span className="integrated-project-closed">Нет открытых вакансий</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="integrated-discovery-vacancies" aria-label="Все вакансии">
              {(currentVisible as Vacancy[]).map((vacancy) => (
                <VacancyView
                  key={vacancy.id}
                  initial={vacancy}
                  ctx={ctx}
                  manage={canManage(vacancy.startup_id)}
                  projectTitle={allProjects.find((p) => p.id === vacancy.startup_id)?.title}
                />
              ))}
            </div>
          )}
          {!currentItems.length && (
            <div className="integrated-discovery-empty">
              <h2>{kind === "startups" ? "Проектов не найдено" : "Подходящих вакансий пока нет"}</h2>
              <p>Попробуйте другое название или роль.</p>
              <button type="button" className="integrated-discovery-secondary" onClick={resetFilters}>
                Сбросить поиск
              </button>
            </div>
          )}
          {kind === "startups" && selectedVacancy && (
            <div className="integrated-discovery-detail">
              <button
                type="button"
                className="integrated-discovery-secondary"
                onClick={() => setSelectedVacancyId(null)}
              >
                Закрыть условия вакансии
              </button>
              <div className="integrated-discovery-vacancies">
                <VacancyView
                  key={selectedVacancy.id}
                  initial={selectedVacancy}
                  ctx={ctx}
                  manage={canManage(selectedVacancy.startup_id)}
                  projectTitle={allProjects.find((p) => p.id === selectedVacancy.startup_id)?.title}
                />
              </div>
            </div>
          )}
          {visibleCount < currentItems.length && (
            <button
              type="button"
              className="integrated-discovery-secondary integrated-discovery-more"
              onClick={() => setVisibleCount((v) => v + 20)}
            >
              Показать ещё
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ProjectView({
  startupId,
  ctx,
  back,
}: {
  startupId: string;
  ctx: Context;
  back: () => void;
}) {
  const project = useData(
    () => api<Startup>("/startups/" + startupId),
    [startupId, ctx.revision],
  );
  const managed = useData(
    () => all<Startup>("/startups?scope=managed"),
    [ctx.user.id, ctx.revision],
  );
  const vacancies = useData(
    () => all<Vacancy>(`/startups/${startupId}/vacancies`),
    [startupId, ctx.revision],
  );
  const p = project.data;
  const owner = p?.owner_id === ctx.user.id;
  const manage = managed.data?.some((s) => s.id === startupId) || false;
  return (
    <>
      <button className="back" onClick={back}>
        <ArrowLeft size={16} /> Назад к проектам
      </button>
      <DataState {...project} />
      {p && (
        <>
          <div className="detail">
            <div className="eyebrow">Стартап</div>
            <h1>{p.title}</h1>
            <p>{p.description}</p>
            <Status value={p.status} />
            <div className="actions wrap">
              {owner && p.status !== "archived" && (
                <>
                  <button
                    className="outline"
                    onClick={() =>
                      ctx.form({
                        title: "Настройки стартапа",
                        values: {
                          title: p.title,
                          description: p.description,
                          general: String(p.allow_general_applications),
                        },
                        fields: [
                          text("title", "Название", true),
                          area("description", "Описание"),
                          {
                            name: "general",
                            label: "Общие отклики",
                            options: [
                              { value: "true", label: "Разрешены" },
                              { value: "false", label: "Запрещены" },
                            ],
                          },
                        ],
                        submit: async (v) => {
                          await api(
                            `/startups/${p.id}`,
                            "PATCH",
                            {
                              title: v.title,
                              description: v.description,
                              allow_general_applications: v.general === "true",
                            },
                            p.revision,
                          );
                        },
                      })
                    }
                  >
                    Настройки
                  </button>
                  <button
                    className="outline"
                    disabled={ctx.busy}
                    onClick={() =>
                      void ctx.perform(async () => {
                        await api(
                          `/startups/${p.id}/${p.status === "active" ? "pause" : "resume"}`,
                          "POST",
                          undefined,
                          p.revision,
                        );
                      })
                    }
                  >
                    {p.status === "active" ? "Пауза" : "Возобновить"}
                  </button>
                  <button
                    className="outline"
                    onClick={() =>
                      ctx.form({
                        title: "Архивировать стартап",
                        notice:
                          "Набор завершится, ожидающие приглашения будут отозваны. Команда и история сохранятся. Возобновить архивный проект нельзя.",
                        fields: [],
                        submit: async () => {
                          await api(
                            `/startups/${p.id}/archive`,
                            "POST",
                            undefined,
                            p.revision,
                          );
                        },
                      })
                    }
                  >
                    Архивировать
                  </button>
                </>
              )}
              {manage && p.status === "active" && (
                <button
                  className="primary"
                  onClick={() =>
                    ctx.form({
                      title: "Новая вакансия",
                      fields: [
                        text("title", "Название", true),
                        area("description", "Описание"),
                        area("requirements", "Требования"),
                        {
                          name: "positions_count",
                          label: "Количество мест",
                          type: "number",
                          required: true,
                        },
                        date("deadline", "Приём откликов до"),
                      ],
                      values: { positions_count: "1", deadline: localDate() },
                      submit: async (v) => {
                        await api(`/startups/${p.id}/vacancies`, "POST", {
                          title: v.title,
                          description: v.description || "",
                          requirements: v.requirements || "",
                          positions_count: Number(v.positions_count),
                          application_deadline: instant(v.deadline),
                        });
                      },
                    })
                  }
                >
                  Добавить вакансию
                </button>
              )}
              {!owner &&
                p.status === "active" &&
                p.allow_general_applications && (
                  <button
                    className="primary"
                    onClick={() => applicationForm(ctx, "startup", p.id)}
                  >
                    Общий отклик
                  </button>
                )}
            </div>
          </div>
          <h2>Вакансии проекта</h2>
          <DataState {...vacancies} />
          <div className="vacancy-list">
            {vacancies.data?.map((v) => (
              <VacancyView key={v.id} initial={v} ctx={ctx} manage={manage} />
            ))}
            {vacancies.data?.length === 0 && (
              <p className="empty">Вакансий пока нет.</p>
            )}
          </div>
          {manage && (
            <section className="panel section">
              <h2>Отклики и приглашения</h2>
              <ManagedApplications startupId={p.id} ctx={ctx} />
            </section>
          )}
          <section className="panel section">
            <h2>Команда</h2>
            <Team startupId={p.id} owner={owner} ctx={ctx} />
          </section>
          {manage && (
            <section className="panel section">
              <h2>Рекрутеры</h2>
              <Recruiters
                startupId={p.id}
                owner={owner}
                active={p.status === "active"}
                ctx={ctx}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}
function applicationForm(
  ctx: Context,
  target_type: "startup" | "vacancy",
  target_id: string,
) {
  ctx.form({
    title: "Ваш отклик",
    fields: [area("message", "Чем вы можете помочь")],
    submit: async (v) => {
      await api("/applications", "POST", {
        target_type,
        target_id,
        message: v.message || "",
      });
    },
  });
}
function VacancyView({
  initial,
  ctx,
  manage,
  projectTitle,
}: {
  initial: Vacancy;
  ctx: Context;
  manage: boolean;
  projectTitle?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const v = initial;
  return (
    <article className="panel vacancy-block">
      <div className="row">
        <div>
          {projectTitle && <p className="integrated-discovery-vacancy-overline">{projectTitle} · версия {v.current_version}</p>}
          <h3>{v.title}</h3>
          <Status value={v.status} />
          <p>{v.description}</p>
          <p className="muted">
            {v.positions_count} мест · Приём до{" "}
            {dateTime(v.application_deadline)}
          </p>
        </div>
        <button className="outline" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Свернуть" : "Подробнее"}
        </button>
      </div>
      {expanded && (
        <>
          <p>
            <strong>Требования:</strong> {v.requirements || "Не указаны"}
          </p>
          <VacancyDetails vacancy={v} ctx={ctx} manage={manage} />
        </>
      )}
      {v.owner_id !== ctx.user.id &&
        v.startup_status === "active" &&
        v.status === "published" &&
        new Date(v.application_deadline) > new Date() && (
          <button
            className="primary"
            disabled={ctx.busy}
            onClick={() => applicationForm(ctx, "vacancy", v.id)}
          >
            Откликнуться
          </button>
        )}
    </article>
  );
}
function VacancyDetails({
  vacancy: v,
  ctx,
  manage,
}: {
  vacancy: Vacancy;
  ctx: Context;
  manage: boolean;
}) {
  const capacity = useData(
    () => api<Capacity>(`/vacancies/${v.id}/capacity`),
    [v.id, ctx.revision],
  );
  const versions = useData(
    () =>
      all<{
        id: string;
        version: number;
        title: string;
        description: string;
        requirements: string;
      }>(`/vacancies/${v.id}/versions`),
    [v.id, ctx.revision],
  );
  const tests = useData(async () => {
    try {
      return await api<TestVersion>(`/vacancies/${v.id}/tests/current`);
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.toLowerCase().includes("test not found")
      )
        return null;
      throw e;
    }
  }, [v.id, ctx.revision]);
  return (
    <>
      <DataState {...capacity} />
      {capacity.data && (
        <p>
          Занято: {capacity.data.occupied} · В резерве: {capacity.data.reserved}{" "}
          · Свободно: {capacity.data.available}
        </p>
      )}
      {manage && v.status !== "archived" && (
        <div className="actions wrap">
          <button
            className="outline"
            onClick={() =>
              ctx.form({
                title: "Места и срок",
                values: {
                  positions_count: String(v.positions_count),
                  deadline: localDate(v.application_deadline),
                },
                fields: [
                  {
                    name: "positions_count",
                    label: "Количество мест",
                    type: "number",
                    required: true,
                  },
                  date("deadline", "Приём до"),
                ],
                submit: async (values) => {
                  await api(
                    `/vacancies/${v.id}/settings`,
                    "PATCH",
                    {
                      positions_count: Number(values.positions_count),
                      application_deadline: instant(values.deadline),
                    },
                    v.revision,
                  );
                },
              })
            }
          >
            Места и срок
          </button>
          <button
            className="outline"
            onClick={() =>
              ctx.form({
                title: "Новые условия вакансии",
                notice:
                  "Сброс завершает текущие незавершённые попытки, кроме действующих приглашений. История остаётся доступна.",
                values: {
                  title: v.title,
                  description: v.description,
                  requirements: v.requirements,
                  change_mode: "keep_applications",
                },
                fields: [
                  text("title", "Название", true),
                  area("description", "Описание"),
                  area("requirements", "Требования"),
                  {
                    name: "change_mode",
                    label: "Что делать с откликами",
                    options: [
                      {
                        value: "keep_applications",
                        label: "Продолжить рассмотрение",
                      },
                      {
                        value: "reset_applications",
                        label: "Сбросить и разрешить повторную подачу",
                      },
                    ],
                  },
                  area("reason", "Причина изменения"),
                ],
                submit: async (values) => {
                  await api(
                    `/vacancies/${v.id}/versions`,
                    "POST",
                    values,
                    v.revision,
                  );
                },
              })
            }
          >
            Изменить условия
          </button>
          <button
            className="outline"
            disabled={ctx.busy}
            onClick={() =>
              void ctx.perform(async () => {
                await api(
                  `/vacancies/${v.id}/${v.status === "published" ? "close-intake" : "reopen-intake"}`,
                  "POST",
                  undefined,
                  v.revision,
                );
              })
            }
          >
            {v.status === "published" ? "Закрыть приём" : "Возобновить приём"}
          </button>
          <button
            className="outline"
            onClick={() =>
              ctx.form({
                title: "Архивировать вакансию",
                notice:
                  "Новые отклики и приглашения будут запрещены. Ранее отправленные приглашения сохраняются.",
                fields: [],
                submit: async () => {
                  await api(
                    `/vacancies/${v.id}/archive`,
                    "POST",
                    undefined,
                    v.revision,
                  );
                },
              })
            }
          >
            В архив
          </button>
        </div>
      )}
      <details>
        <summary>История условий вакансии</summary>
        <DataState {...versions} />
        {versions.data
          ?.sort((a, b) => b.version - a.version)
          .map((version) => (
            <div key={version.id} className="history-item">
              <strong>
                Версия {version.version}: {version.title}
              </strong>
              <p>{version.description}</p>
              <p>{version.requirements}</p>
            </div>
          ))}
      </details>
      <DataState {...tests} />
      {tests.data && (
        <div className="history-item">
          <h4>Тестовое задание · версия {tests.data.version}</h4>
          <p className="prewrap">{tests.data.description}</p>
          <p>Срок решения: {dateTime(tests.data.submission_deadline)}</p>
        </div>
      )}
      {tests.data === null && (
        <p className="muted">Тестовое задание не требуется.</p>
      )}
      {manage && v.startup_status === "active" && v.status !== "archived" && (
        <button
          className="outline"
          onClick={() =>
            ctx.form({
              title: tests.data ? "Обновить тестовое" : "Добавить тестовое",
              values: {
                description: tests.data?.description || "",
                deadline: localDate(),
                change_type: tests.data ? "ordinary" : "initial",
              },
              fields: [
                area("description", "Текст задания"),
                date("deadline", "Срок отправки решения"),
                {
                  name: "change_type",
                  label: "Тип изменения",
                  options: tests.data
                    ? [
                        {
                          value: "ordinary",
                          label: "Уточнение: прежние решения действуют",
                        },
                        {
                          value: "critical",
                          label: "Критическое: потребуется новая работа",
                        },
                      ]
                    : [{ value: "initial", label: "Первое задание" }],
                },
                area("reason", "Причина"),
              ],
              submit: async (values) => {
                await api(`/vacancies/${v.id}/tests/versions`, "POST", {
                  description: values.description,
                  submission_deadline: instant(values.deadline),
                  change_type: values.change_type,
                  reason: values.reason || "",
                });
              },
            })
          }
        >
          {" "}
          {tests.data ? "Обновить тестовое" : "Добавить тестовое"}
        </button>
      )}
    </>
  );
}
function Cabinet({
  ctx,
  updateUser,
}: {
  ctx: Context;
  updateUser: (user: Person) => void;
}) {
  const managed = useData(
    () => all<Startup>("/startups?scope=managed"),
    [ctx.user.id, ctx.revision],
  );
  const teams = useData(
    () => all<Startup>("/startups?scope=member"),
    [ctx.user.id, ctx.revision],
  );
  const applications = useData(
    () => all<Application>("/applications/mine"),
    [ctx.user.id, ctx.revision],
  );
  const offers = useData(
    () => all<Offer>("/offers/mine"),
    [ctx.user.id, ctx.revision],
  );
  const invitations = useData(
    () => all<Invitation>("/recruiter-invitations/mine"),
    [ctx.user.id, ctx.revision],
  );
  const notifications = useData(
    () => all<Notification>("/notifications"),
    [ctx.user.id, ctx.revision],
  );
  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Профиль / Личный кабинет</div>
          <h1>Привет, {ctx.user.name}.</h1>
          <p>{ctx.user.bio || "Расскажите о себе в профиле."}</p>
          <p>{ctx.user.skills.join(", ")}</p>
          {ctx.user.portfolio_url && (
            <a href={ctx.user.portfolio_url} target="_blank" rel="noreferrer">
              Портфолио
            </a>
          )}
        </div>
        <button
          className="outline"
          onClick={() =>
            ctx.form({
              title: "Мой профиль",
              values: {
                name: ctx.user.name,
                bio: ctx.user.bio,
                skills: ctx.user.skills.join(", "),
                portfolio_url: ctx.user.portfolio_url || "",
              },
              fields: [
                text("name", "Имя", true),
                area("bio", "О себе"),
                text("skills", "Навыки через запятую"),
                { name: "portfolio_url", label: "Портфолио", type: "url" },
              ],
              submit: async (values) => {
                updateUser(
                  await api<Person>("/users/me", "PATCH", {
                    name: values.name,
                    bio: values.bio,
                    skills: values.skills
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    portfolio_url: values.portfolio_url || null,
                  }),
                );
              },
            })
          }
        >
          Редактировать профиль
        </button>
      </div>
      <div className="cabinet-grid">
        <section className="panel">
          <h2>Мои проекты и подбор</h2>
          <DataState {...managed} />
          {managed.data?.map((p) => (
            <div className="line" key={p.id}>
              <button className="text-button" onClick={() => ctx.open(p)}>
                {p.title}
              </button>
              <Status value={p.status} />
            </div>
          ))}
          {managed.data?.length === 0 && (
            <p className="muted">
              У вас пока нет своих проектов или полномочий рекрутера.
            </p>
          )}
        </section>
        <section className="panel">
          <h2>Мои команды</h2>
          <DataState {...teams} />
          {teams.data?.map((p) => (
            <div className="line" key={p.id}>
              <button className="text-button" onClick={() => ctx.open(p)}>
                {p.title}
              </button>
              <Status value={p.status} />
            </div>
          ))}
          {teams.data?.length === 0 && (
            <p className="muted">Вы пока не состоите в командах.</p>
          )}
        </section>
        <section className="panel wide">
          <h2>Отправленные отклики</h2>
          <DataState {...applications} />
          {applications.data?.map((a) => (
            <ApplicationCard
              key={a.id}
              application={a}
              ctx={ctx}
              manager={false}
            />
          ))}
          {applications.data?.length === 0 && (
            <p className="muted">Вы ещё не откликались.</p>
          )}
        </section>
        <section className="panel wide">
          <h2>Приглашения в команду</h2>
          <DataState {...offers} />
          {offers.data?.map((offer) => (
            <OfferCard key={offer.id} offer={offer} ctx={ctx} manager={false} />
          ))}
          {offers.data?.length === 0 && (
            <p className="muted">Приглашений пока нет.</p>
          )}
        </section>
        <section className="panel wide">
          <h2>Полученные отклики</h2>
          <DataState {...managed} />
          {managed.data?.map((p) => (
            <div className="section" key={p.id}>
              <h3>
                <button className="text-button" onClick={() => ctx.open(p)}>
                  {p.title}
                </button>
              </h3>
              <ManagedApplications startupId={p.id} ctx={ctx} />
            </div>
          ))}
          {managed.data?.length === 0 && (
            <p className="muted">Здесь появятся заявки на ваши проекты.</p>
          )}
        </section>
        <section className="panel">
          <h2>Приглашения рекрутером</h2>
          <DataState {...invitations} />
          {invitations.data?.map((inv) => (
            <div className="history-item" key={inv.id}>
              <ProjectName id={inv.startup_id} />
              <p>До {dateTime(inv.expires_at)}</p>
              <Status value={inv.status} />
              {inv.status === "pending" &&
                new Date(inv.expires_at) > new Date() && (
                  <div className="actions wrap">
                    {["accept", "decline"].map((action) => (
                      <button
                        disabled={ctx.busy}
                        className="outline"
                        key={action}
                        onClick={() =>
                          void ctx.perform(async () => {
                            await api(
                              `/recruiter-invitations/${inv.id}/${action}`,
                              "POST",
                            );
                          })
                        }
                      >
                        {action === "accept"
                          ? "Принять полномочия"
                          : "Отказаться"}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          ))}
          {invitations.data?.length === 0 && (
            <p className="muted">Приглашений рекрутером пока нет.</p>
          )}
        </section>
        <section className="panel">
          <h2>Уведомления</h2>
          <DataState {...notifications} />
          {notifications.data
            ?.sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((n) => (
              <div className="history-item" key={n.id}>
                <strong>{n.title}</strong>
                <p>{n.message}</p>
                <p className="muted">{dateTime(n.created_at)}</p>
                {!n.read_at && (
                  <button
                    className="outline"
                    disabled={ctx.busy}
                    onClick={() =>
                      void ctx.perform(async () => {
                        await api(`/notifications/${n.id}/read`, "PATCH");
                      })
                    }
                  >
                    Прочитано
                  </button>
                )}
              </div>
            ))}
          {notifications.data?.length === 0 && (
            <p className="muted">Уведомлений пока нет.</p>
          )}
        </section>
      </div>
    </>
  );
}
function ProjectName({ id }: { id: string }) {
  const project = useData(() => api<Startup>("/startups/" + id), [id]);
  return <strong>{project.data?.title || "Проект"}</strong>;
}
function ManagedApplications({
  startupId,
  ctx,
}: {
  startupId: string;
  ctx: Context;
}) {
  const applications = useData(
    () => all<Application>(`/startups/${startupId}/applications`),
    [startupId, ctx.revision],
  );
  const offers = useData(
    () => all<Offer>(`/startups/${startupId}/offers`),
    [startupId, ctx.revision],
  );
  return (
    <>
      <DataState {...applications} />
      {applications.data?.map((a) => (
        <ApplicationCard key={a.id} application={a} ctx={ctx} manager={true} />
      ))}
      {applications.data?.length === 0 && (
        <p className="muted">Входящих откликов пока нет.</p>
      )}
      <DataState {...offers} />
      {offers.data?.map((offer) => (
        <OfferCard key={offer.id} offer={offer} ctx={ctx} manager={true} />
      ))}
    </>
  );
}
function ApplicationCard({
  application: a,
  ctx,
  manager,
}: {
  application: Application;
  ctx: Context;
  manager: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const own = a.applicant_id === ctx.user.id;
  const membership = useData(
    () =>
      own && ["joined", "already_joined"].includes(a.status)
        ? all<Member>(`/startups/${a.startup_id}/members`)
        : Promise.resolve([]),
    [a.id, a.status, ctx.revision],
  );
  return (
    <article className="history-item">
      <div className="row">
        <div>
          <strong>
            {a.startup_title} · {a.vacancy_title || "Общий отклик"}
          </strong>
          <p>{a.applicant_name}</p>
        </div>
        <Status value={a.status} />
      </div>
      <p className="prewrap">
        {a.message || "Без сопроводительного сообщения"}
      </p>
      {a.rejection_reason && (
        <p>
          <strong>Причина решения:</strong> {a.rejection_reason}
        </p>
      )}
      <div className="actions wrap">
        <button className="outline" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Скрыть историю" : "История и тестовое"}
        </button>
        {manager && !own && ["pending", "reviewing"].includes(a.status) && (
          <>
            <button
              className="outline"
              disabled={ctx.busy || a.status === "reviewing"}
              onClick={() =>
                void ctx.perform(async () => {
                  await api(
                    `/applications/${a.id}/review`,
                    "POST",
                    undefined,
                    a.revision,
                  );
                })
              }
            >
              На рассмотрение
            </button>
            <button
              className="outline"
              onClick={() =>
                ctx.form({
                  title: "Отклонить отклик",
                  fields: [area("reason", "Причина решения")],
                  submit: async (values) => {
                    await api(
                      `/applications/${a.id}/reject`,
                      "POST",
                      { reason: values.reason || "" },
                      a.revision,
                    );
                  },
                })
              }
            >
              Отклонить
            </button>
            <button
              className="primary"
              onClick={() =>
                ctx.form({
                  title: "Пригласить в команду",
                  notice:
                    "Приглашение резервирует место. Кандидат сам решит, принимать ли его.",
                  fields: [
                    area("message", "Условия и сообщение"),
                    date("expires", "Приглашение действует до"),
                  ],
                  values: { expires: localDate() },
                  submit: async (values) => {
                    await api(
                      `/applications/${a.id}/offers`,
                      "POST",
                      {
                        message: values.message || "",
                        expires_at: instant(values.expires),
                      },
                      a.revision,
                    );
                  },
                })
              }
            >
              Пригласить в команду
            </button>
          </>
        )}
        {own && ["pending", "reviewing"].includes(a.status) && (
          <button
            className="outline"
            disabled={ctx.busy}
            onClick={() =>
              void ctx.perform(async () => {
                await api(
                  `/applications/${a.id}/withdraw`,
                  "POST",
                  undefined,
                  a.revision,
                );
              })
            }
          >
            Отозвать отклик
          </button>
        )}
        {own && a.status === "withdrawn" && (
          <button
            className="outline"
            disabled={ctx.busy}
            onClick={() =>
              void ctx.perform(async () => {
                await api(
                  `/applications/${a.id}/restore`,
                  "POST",
                  undefined,
                  a.revision,
                );
              })
            }
          >
            Восстановить отклик
          </button>
        )}
        {own &&
          (a.status === "reset" ||
            (["joined", "already_joined"].includes(a.status) &&
              membership.data &&
              !membership.data.some(
                (m) => m.user_id === ctx.user.id && !m.left_at,
              ))) && (
            <button
              className="outline"
              onClick={() =>
                ctx.form({
                  title: "Новая попытка отклика",
                  notice:
                    "Повторная подача доступна после сброса или выхода из команды, если приём открыт.",
                  fields: [area("message", "Сообщение на новых условиях")],
                  submit: async (values) => {
                    await api(
                      `/applications/${a.id}/attempts`,
                      "POST",
                      { message: values.message || "" },
                      a.revision,
                    );
                  },
                })
              }
            >
              Подать заново
            </button>
          )}
      </div>
      {expanded && (
        <ApplicationDetails
          application={a}
          ctx={ctx}
          manager={manager && !own}
        />
      )}
    </article>
  );
}
function ApplicationDetails({
  application: a,
  ctx,
  manager,
}: {
  application: Application;
  ctx: Context;
  manager: boolean;
}) {
  const attempts = useData(
    () => all<Attempt>(`/applications/${a.id}/attempts`),
    [a.id, ctx.revision],
  );
  const events = useData(
    () => all<Event>(`/applications/${a.id}/history`),
    [a.id, ctx.revision],
  );
  const submissions = useData(
    () => all<Submission>(`/applications/${a.id}/test-submissions`),
    [a.id, ctx.revision],
  );
  const tests = useData(
    () =>
      a.vacancy_id
        ? all<TestVersion>(`/vacancies/${a.vacancy_id}/tests/versions`)
        : Promise.resolve([]),
    [a.id, ctx.revision],
  );
  const latest = tests.data?.slice().sort((x, y) => y.version - x.version)[0];
  return (
    <div className="details-body">
      <h4>Попытки и условия</h4>
      <DataState {...attempts} />
      {attempts.data
        ?.sort((x, y) => x.created_at.localeCompare(y.created_at))
        .map((attempt) => (
          <div key={attempt.id} className="history-item">
            <strong>
              {attempt.is_current ? "Текущая" : "Предыдущая"} попытка ·{" "}
              {dateTime(attempt.created_at)}
            </strong>
            <p>
              {attempt.title || "Общий интерес к стартапу"}
              {attempt.vacancy_version
                ? " · версия " + attempt.vacancy_version
                : ""}
            </p>
            <p className="prewrap">{attempt.description}</p>
            <p>{attempt.requirements}</p>
            <p className="prewrap">
              Сообщение: {attempt.message || "Без сообщения"}
            </p>
            <Status value={attempt.status} />
            {attempt.rejection_reason && (
              <p>Причина: {attempt.rejection_reason}</p>
            )}
          </div>
        ))}
      {a.vacancy_id && (
        <>
          <h4>Тестовое задание и решения</h4>
          <DataState {...tests} />
          {latest ? (
            <>
              <p>
                Актуальная версия {latest.version}, срок{" "}
                {dateTime(latest.submission_deadline)}
              </p>
              <p className="prewrap">{latest.description}</p>
              {a.applicant_id === ctx.user.id &&
                ["pending", "reviewing", "offer_pending"].includes(
                  a.status,
                ) && (
                  <button
                    className="outline"
                    onClick={() =>
                      ctx.form({
                        title: "Отправить решение",
                        notice:
                          "Решение будет связано с выбранной версией задания. После критического обновления старые версии не принимаются.",
                        values: { test_version_id: latest.id },
                        fields: [
                          {
                            name: "test_version_id",
                            label: "Версия задания",
                            options: (tests.data || [])
                              .sort((x, y) => y.version - x.version)
                              .map((t) => ({
                                value: t.id,
                                label: `Версия ${t.version} · ${t.change_type === "critical" ? "критическое обновление" : "условия задания"}`,
                              })),
                          },
                          {
                            name: "solution_url",
                            label: "HTTPS-ссылка на решение",
                            type: "url",
                            required: true,
                          },
                        ],
                        submit: async (values) => {
                          await api(
                            `/applications/${a.id}/test-submissions`,
                            "POST",
                            values,
                          );
                        },
                      })
                    }
                  >
                    Отправить решение
                  </button>
                )}
            </>
          ) : (
            tests.data && <p className="muted">Тестового задания нет.</p>
          )}
          <DataState {...submissions} />
          {submissions.data?.map((sub) => (
            <div className="history-item" key={sub.id}>
              <a href={sub.solution_url} target="_blank" rel="noreferrer">
                Решение · версия{" "}
                {tests.data?.find((t) => t.id === sub.test_version_id)
                  ?.version || "задания"}
              </a>
              <p>{dateTime(sub.submitted_at)}</p>
              <Status value={sub.status} />
              {manager && sub.status === "submitted" && (
                <button
                  className="outline"
                  disabled={ctx.busy}
                  onClick={() =>
                    void ctx.perform(async () => {
                      await api(`/test-submissions/${sub.id}`, "PATCH", {
                        status: "reviewed",
                      });
                    })
                  }
                >
                  Отметить проверенным
                </button>
              )}
            </div>
          ))}
        </>
      )}
      <h4>События</h4>
      <DataState {...events} />
      {events.data
        ?.sort((x, y) => x.created_at.localeCompare(y.created_at))
        .map((e) => (
          <p key={e.id}>
            {dateTime(e.created_at)} ·{" "}
            {eventLabels[e.event_type] || "Изменение в проекте"}
            {e.actor_name ? " · " + e.actor_name : ""}
            {e.metadata?.reason ? " · " + e.metadata.reason : ""}
          </p>
        ))}
    </div>
  );
}
function OfferCard({
  offer: o,
  ctx,
  manager,
}: {
  offer: Offer;
  ctx: Context;
  manager: boolean;
}) {
  const own = o.candidate_id === ctx.user.id;
  return (
    <article className="history-item">
      <div className="row">
        <strong>
          {o.startup_title} · {o.vacancy_title || "Общее приглашение"}
        </strong>
        <Status value={o.status} />
      </div>
      {manager && (
        <p>
          Кандидат: <PersonName id={o.candidate_id} />
        </p>
      )}
      <p className="prewrap">{o.message}</p>
      {o.vacancy_title && (
        <details>
          <summary>Условия именно этого приглашения</summary>
          <p className="prewrap">{o.vacancy_description}</p>
          <p>{o.vacancy_requirements}</p>
        </details>
      )}
      <p className="muted">Действует до {dateTime(o.expires_at)}</p>
      {o.status === "pending" && (
        <div className="actions wrap">
          {own &&
            ["accept", "decline"].map((action) => (
              <button
                className="outline"
                disabled={ctx.busy}
                key={action}
                onClick={() =>
                  void ctx.perform(async () => {
                    await api(
                      `/offers/${o.id}/${action}`,
                      "POST",
                      undefined,
                      o.revision,
                    );
                  })
                }
              >
                {action === "accept"
                  ? "Принять приглашение"
                  : "Отклонить приглашение"}
              </button>
            ))}
          {manager && !own && (
            <button
              className="outline"
              disabled={ctx.busy}
              onClick={() =>
                void ctx.perform(async () => {
                  await api(
                    `/offers/${o.id}/revoke`,
                    "POST",
                    undefined,
                    o.revision,
                  );
                })
              }
            >
              Отозвать приглашение
            </button>
          )}
        </div>
      )}
    </article>
  );
}
function Team({
  startupId,
  owner,
  ctx,
}: {
  startupId: string;
  owner: boolean;
  ctx: Context;
}) {
  const members = useData(
    () => all<Member>(`/startups/${startupId}/members`),
    [startupId, ctx.revision],
  );
  return (
    <>
      <DataState {...members} />
      {members.data?.map((m) => (
        <div className="history-item" key={m.id}>
          <strong>
            <PersonName id={m.user_id} />
          </strong>
          <p>
            Вступление: {dateTime(m.joined_at)}
            {m.left_at ? " · Выход: " + dateTime(m.left_at) : " · В команде"}
          </p>
          {!m.left_at && m.user_id === ctx.user.id && (
            <button
              className="outline"
              onClick={() =>
                ctx.form({
                  title: "Выйти из команды",
                  notice:
                    "Ваше членство завершится, история останется. Рекрутерские полномочия не изменятся.",
                  fields: [],
                  submit: async () => {
                    await api(`/startups/${startupId}/members/leave`, "POST");
                  },
                })
              }
            >
              Выйти из команды
            </button>
          )}
          {!m.left_at && owner && m.user_id !== ctx.user.id && (
            <button
              className="outline"
              onClick={() =>
                ctx.form({
                  title: "Завершить участие",
                  notice: "История участия сохранится.",
                  fields: [],
                  submit: async () => {
                    await api(
                      `/startups/${startupId}/members/${m.user_id}`,
                      "DELETE",
                    );
                  },
                })
              }
            >
              Исключить из команды
            </button>
          )}
        </div>
      ))}
      {members.data?.length === 0 && (
        <p className="muted">
          Участников пока нет. Владелец управляет проектом отдельно от состава
          команды.
        </p>
      )}
    </>
  );
}
function Recruiters({
  startupId,
  owner,
  active,
  ctx,
}: {
  startupId: string;
  owner: boolean;
  active: boolean;
  ctx: Context;
}) {
  const grants = useData(
    () => all<Grant>(`/startups/${startupId}/recruiters`),
    [startupId, ctx.revision],
  );
  const invitations = useData(
    () =>
      owner
        ? all<Invitation>(`/startups/${startupId}/recruiter-invitations`)
        : Promise.resolve([]),
    [startupId, owner, ctx.revision],
  );
  const [query, setQuery] = useState(""),
    [found, setFound] = useState<Person[]>(),
    [error, setError] = useState("");
  return (
    <>
      <DataState {...grants} />
      {grants.data?.map((g) => (
        <div className="line" key={g.id}>
          <PersonName id={g.user_id} />
          {owner && (
            <button
              className="outline"
              onClick={() =>
                ctx.form({
                  title: "Отозвать полномочия",
                  notice:
                    "Доступ к подбору прекратится. Членство в команде и уже отправленные приглашения кандидатам сохранятся.",
                  fields: [],
                  submit: async () => {
                    await api(
                      `/startups/${startupId}/recruiters/${g.user_id}`,
                      "DELETE",
                    );
                  },
                })
              }
            >
              Отозвать права
            </button>
          )}
        </div>
      ))}
      {grants.data?.length === 0 && (
        <p className="muted">Внешних рекрутеров нет.</p>
      )}
      {owner && active && (
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            void all<Person>("/users?query=" + encodeURIComponent(query))
              .then(setFound)
              .catch((e) => setError(e.message));
          }}
        >
          <label>
            Найти участника по имени
            <input
              minLength={2}
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="outline">Найти</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {found
        ?.filter((p) => p.id !== ctx.user.id)
        .map((person) => (
          <div className="line" key={person.id}>
            <span>{person.name}</span>
            <button
              className="outline"
              onClick={() =>
                ctx.form({
                  title: "Пригласить рекрутера: " + person.name,
                  fields: [date("expires", "Полномочия можно принять до")],
                  values: { expires: localDate() },
                  submit: async (values) => {
                    await api(
                      `/startups/${startupId}/recruiter-invitations`,
                      "POST",
                      {
                        user_id: person.id,
                        expires_at: instant(values.expires),
                      },
                    );
                  },
                })
              }
            >
              Пригласить рекрутером
            </button>
          </div>
        ))}
      {found?.length === 0 && <p className="muted">Участники не найдены.</p>}
      {owner && (
        <>
          <h4>Отправленные приглашения рекрутеров</h4>
          <DataState {...invitations} />
          {invitations.data?.map((inv) => (
            <div className="history-item" key={inv.id}>
              <PersonName id={inv.user_id} />
              <p>До {dateTime(inv.expires_at)}</p>
              <Status value={inv.status} />
              {inv.status === "pending" && (
                <button
                  className="outline"
                  disabled={ctx.busy}
                  onClick={() =>
                    void ctx.perform(async () => {
                      await api(
                        `/recruiter-invitations/${inv.id}/revoke`,
                        "POST",
                      );
                    })
                  }
                >
                  Отозвать приглашение
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}

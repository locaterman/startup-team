import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, ArrowLeft, Search, SlidersHorizontal, X } from "lucide-react";
import { AppHeader } from "./AppHeader";
import { getApplyState } from "./getApplyState";
import { FormDialog, type Dialog, type Field } from "./FormDialog";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import "./discovery.css";
import "./complete-workspace.css";
import "./complete-records.css";
import { api, all, setCsrf, dateTime, localDate, instant } from "./api";
import { AuthScreen, OnboardingScreen } from "./AuthScreen";
import { telegramApp, useTelegramBack, type AuthConfig, type AuthContext } from "./telegram";
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

type Context = {
  user: Person;
  revision: number;
  refresh: () => void;
  perform: (fn: () => Promise<void>) => Promise<void>;
  form: (dialog: Dialog) => void;
  open: (startup: Startup) => void;
  showApplications: () => void;
  showProjects: () => void;
  showTeams: () => void;
  myApplications?: Application[];
  myApplicationsError: string;
  retryApplications: () => void;
  memberStartupIds?: ReadonlySet<string>;
  membershipError: string;
  retryMemberships: () => void;
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
function useData<T>(
  request: () => Promise<T>,
  deps: unknown[],
  keepPreviousOnRefresh = false,
) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [retryIndex, setRetryIndex] = useState(0);
  useEffect(() => {
    let active = true;
    if (!keepPreviousOnRefresh) setData(undefined);
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
  }, [...deps, retryIndex]);
  return { data, error, retry: () => setRetryIndex((index) => index + 1) };
}
function DataState({
  data, error, retry,
}: { data: unknown; error: string; retry?: () => void }) {
  return error ? (
    <div className="error" role="alert">
      Не удалось загрузить: {error}
      {retry && <button type="button" className="outline" onClick={retry}>Повторить</button>}
    </div>
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
export default function App() {
  const [user, setUser] = useState<Person | null>(null),
    [ready, setReady] = useState(false),
    [tab, setTab] = useState("projects"),
    [sectionHistory, setSectionHistory] = useState<string[]>([]),
    [detailReturnTab, setDetailReturnTab] = useState<string | null>(null),
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
  const initialBootstrapStarted = useRef(false);
  const authRequestInFlight = useRef(false);
  const dialogDismissRef = useRef<(() => void) | null>(null);
  const refresh = () => setRevision((v) => v + 1);
  // Authentication is not a domain command: success should not create a
  // "Готово" banner or invalidate all application data.
  const authenticate = async (action: () => Promise<void>) => {
    if (authRequestInFlight.current) return;
    authRequestInFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить вход");
    } finally {
      authRequestInFlight.current = false;
      setBusy(false);
    }
  };
  // Domain success banners are transient rather than sticky across navigation.
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);
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
    setSectionHistory([]);
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
  const bootstrap = async (initial = false) => {
    if (initial) setReady(false);
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
    // Only the real Telegram WebView receives native safe-area adjustments.
    document.documentElement.classList.toggle(
      "telegram-mini-app", Boolean(telegramApp()?.initData),
    );
    return () => document.documentElement.classList.remove("telegram-mini-app");
  }, []);
  useEffect(() => {
    // StrictMode runs mount effects twice in development. Do not start a
    // second session/bootstrap request against the same HttpOnly cookie.
    if (initialBootstrapStarted.current) return;
    initialBootstrapStarted.current = true;
    void bootstrap(true);
  }, []);
  // One request for the whole screen tree; never request once per vacancy.
  // Identity + revision in the result prevent showing a stale "Apply" action
  // while the data for a new login or completed command is being refreshed.
  const ownApplications = useData(
    () =>
      user
        ? all<Application>("/applications/mine").then((items) => ({
            userId: user.id, revision, items,
          }))
        : Promise.resolve({ userId: "", revision, items: [] as Application[] }),
    [user?.id, revision],
  );
  const myApplications =
    user &&
    ownApplications.data?.userId === user.id &&
    ownApplications.data.revision === revision
      ? ownApplications.data.items
      : undefined;
  const ownMemberships = useData(
    () => user
      ? all<Startup>("/startups?scope=member").then((members) => ({
          userId: user.id, revision, ids: members.map((project) => project.id),
        }))
      : Promise.resolve({ userId: "", revision, ids: [] as string[] }),
    [user?.id, revision],
  );
  const memberStartupIds =
    user && ownMemberships.data?.userId === user.id && ownMemberships.data.revision === revision
      ? new Set(ownMemberships.data.ids)
      : undefined;
  const navigateSection = (section: string) => {
    if (section !== tab) {
      setSectionHistory((trail) => [...trail.slice(-11), tab]);
    }
    setSelected(null);
    setDetailReturnTab(null);
    setTab(section);
    setError("");
    setNotice("");
  };
  const closeSelected = () => {
    setSelected(null);
    if (detailReturnTab) {
      setTab(detailReturnTab);
      setSectionHistory((trail) => trail.slice(0, -1));
    }
    setDetailReturnTab(null);
  };
  const handleNativeBack = () => {
    if (busy) return;
    if (dialog) {
      dialogDismissRef.current?.();
      return;
    }
    if (selected) {
      closeSelected();
      return;
    }
    if (sectionHistory.length) {
      const previous = sectionHistory[sectionHistory.length - 1];
      setSectionHistory((trail) => trail.slice(0, -1));
      setTab(previous);
    } else {
      setTab("projects");
    }
    setError("");
    setNotice("");
  };
  // Always call the hook before conditional rendering, including onboarding.
  useTelegramBack(
    ready && !!user && !onboarding &&
      (!!dialog || !!selected || sectionHistory.length > 0 || tab !== "projects"),
    handleNativeBack,
    dialog ? 100 : 0,
  );

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
        onDemo={() => void authenticate(login)}
        onTelegram={() => void authenticate(loginTelegram)}
        onRetry={() => void authenticate(() => bootstrap(false))}
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
      if (tab !== "projects") {
        setSectionHistory((trail) => [...trail.slice(-11), tab]);
        setDetailReturnTab(tab);
      } else {
        setDetailReturnTab(null);
      }
      setSelected(p);
      setTab("projects");
    },
    showApplications: () => navigateSection("applications"),
    showProjects: () => navigateSection("projects"),
    showTeams: () => navigateSection("teams"),
    myApplications,
    myApplicationsError: ownApplications.error,
    retryApplications: ownApplications.retry,
    memberStartupIds,
    membershipError: ownMemberships.error,
    retryMemberships: ownMemberships.retry,
    busy,
  };
  return (
    <div className="page integrated-design-page">
      <AppHeader
        user={user}
        active={tab}
        busy={busy}
        revision={revision}
        onNavigate={navigateSection}
        onLogout={() =>
          void perform(async () => {
            await api("/auth/logout", "POST");
            setCsrf("");
            setUser(null);
            setSelected(null);
            setDialog(null);
            setSectionHistory([]);
          })
        }
      />
      <main id="app-content" tabIndex={-1} className="container content integrated-content">
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
              back={closeSelected}
            />
          ) : (
            <Feed kind="startups" ctx={context} />
          ))}
        {tab === "vacancies" && <Feed kind="vacancies" ctx={context} />}
        {tab === "cabinet" && <Cabinet key={user.id} ctx={context} />}
        {tab === "applications" && <ApplicationsScreen key={user.id} ctx={context} />}
        {tab === "teams" && <TeamsScreen key={user.id} ctx={context} />}
        {tab === "profile" && <ProfileScreen key={user.id} ctx={context} updateUser={setUser} />}
        {tab === "notifications" && <NotificationsScreen key={user.id} ctx={context} />}
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
          registerDismiss={(handler) => { dialogDismissRef.current = handler; }}
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
  const vacancyDetailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedVacancyId && vacancyDetailRef.current) {
      vacancyDetailRef.current.scrollIntoView({ block: "start" });
      vacancyDetailRef.current.focus({ preventScroll: true });
    }
  }, [selectedVacancyId]);
  useTelegramBack(
    selectedVacancyId !== null,
    () => setSelectedVacancyId(null),
    50,
  );

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
      <DataState data={loaded ? true : undefined} error={loadingError}
        retry={() => { projects.retry(); vacancies.retry(); }} />
      {managed.error && <DataState {...managed} />}
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
            <div className="integrated-discovery-detail" ref={vacancyDetailRef}
              tabIndex={-1} aria-label="Условия выбранной вакансии">
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
  const generalApplication = ctx.myApplications?.find((a) =>
    a.startup_id === startupId && a.vacancy_id === null
  );
  return (
    <div className="complete-workspace">
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
                  ctx.memberStartupIds?.has(p.id) ? (
                    <button type="button" className="outline" onClick={ctx.showTeams}>
                      Вы уже в команде
                    </button>
                  ) : generalApplication ? (
                    <button type="button" className="outline" onClick={ctx.showApplications}>
                      Мой общий отклик
                    </button>
                  ) : ctx.myApplications === undefined || ctx.memberStartupIds === undefined ? (
                    <>
                      <button type="button" className="outline" disabled>
                        Не удалось проверить отклик
                      </button>
                      {(ctx.myApplicationsError || ctx.membershipError) && (
                        <button type="button" className="outline" onClick={() => {
                          ctx.retryApplications();
                          ctx.retryMemberships();
                        }}>Повторить проверку</button>
                      )}
                    </>
                  ) : (
                    <button className="primary" onClick={() => applicationForm(ctx, "startup", p.id)}>
                      Общий отклик
                    </button>
                  )
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
    </div>
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
  const applyState = ctx.memberStartupIds === undefined
    ? { kind: ctx.membershipError ? "error" : "loading" } as const
    : getApplyState(
        v, ctx.user.id, ctx.myApplications, ctx.myApplicationsError, ctx.busy,
        Date.now(), ctx.memberStartupIds,
      );
  return (
    <article className="cw-vacancy-record panel vacancy-block">
      <div className="cw-vacancy-heading">
        <div className="cw-vacancy-copy">
          {projectTitle && <p className="cw-record-eyebrow">{projectTitle} · версия {v.current_version}</p>}
          <h3>{v.title}</h3>
          <p className="cw-record-preview prewrap">{v.description}</p>
          <p className="cw-record-role">
            {v.positions_count} мест · Приём до {dateTime(v.application_deadline)}
          </p>
        </div>
        <div className="cw-vacancy-controls">
          <Status value={v.status} />
          <button className="outline" type="button" aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}>
            {expanded ? "Свернуть" : "Подробнее"}
          </button>
        </div>
      </div>
      {expanded && (
        <>
          <p>
            <strong>Требования:</strong> {v.requirements || "Не указаны"}
          </p>
          <VacancyDetails vacancy={v} ctx={ctx} manage={manage} />
        </>
      )}
      {applyState.kind !== "hidden" && (
        <div className="vacancy-apply-actions">
          {applyState.kind === "member" ? (
            <button type="button" className="outline" onClick={ctx.showTeams}>
              Вы уже в команде
            </button>
          ) : applyState.kind === "existing" ? (
            <>
              <button type="button" className="primary vacancy-applied" disabled>
                {applyState.applicationStatus === "reset"
                  ? "Новая попытка — через мои отклики"
                  : "Отклик уже отправлен"}
              </button>
              <button type="button" className="outline" onClick={ctx.showApplications}>
                Мои отклики
              </button>
            </>
          ) : applyState.kind === "loading" || applyState.kind === "error" ? (
            <>
              <button type="button" className="primary vacancy-applied" disabled>
                {applyState.kind === "error"
                  ? "Не удалось проверить отклик"
                  : "Проверяем статус отклика…"}
              </button>
              {applyState.kind === "error" && (
                <button type="button" className="outline" onClick={() => {
                  ctx.retryApplications();
                  ctx.retryMemberships();
                }}>
                  Повторить проверку
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={applyState.kind === "busy"}
              onClick={() => applicationForm(ctx, "vacancy", v.id)}
            >
              {applyState.kind === "busy" ? "Сохраняем…" : "Откликнуться"}
            </button>
          )}
        </div>
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
function openCreateProject(ctx: Context) {
  ctx.form({
    title: "Новый стартап",
    fields: [text("title", "Название", true), area("description", "Описание")],
    submit: async (values) => {
      await api("/startups", "POST", {
        title: values.title,
        description: values.description || "",
        allow_general_applications: true,
      });
    },
  });
}

function openCreateVacancy(ctx: Context, startupId: string) {
  ctx.form({
    title: "Новая вакансия",
    fields: [
      text("title", "Название", true),
      area("description", "Описание"),
      area("requirements", "Требования"),
      { name: "positions_count", label: "Количество мест", type: "number", required: true },
      date("deadline", "Приём откликов до"),
    ],
    values: { positions_count: "1", deadline: localDate() },
    submit: async (values) => {
      await api("/startups/" + startupId + "/vacancies", "POST", {
        title: values.title,
        description: values.description || "",
        requirements: values.requirements || "",
        positions_count: Number(values.positions_count),
        application_deadline: instant(values.deadline),
      });
    },
  });
}

function CompleteEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="cw-empty">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

type WorkspaceTab =
  "responses" | "vacancies" | "invites" | "team" | "recruiters" | "settings";

function ProjectWorkspace({
  project, ctx, tab, setTab,
}: {
  project: Startup;
  ctx: Context;
  tab: WorkspaceTab;
  setTab: (value: WorkspaceTab) => void;
}) {
  const owner = project.owner_id === ctx.user.id;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  useTelegramBack(
    tab === "responses" && mobileDetail,
    () => setMobileDetail(false),
    60,
  );
  const [statusFilter, setStatusFilter] = useState("");
  const incoming = useData(
    () => all<Application>("/startups/" + project.id + "/applications"),
    [project.id, ctx.revision],
  );
  const vacancies = useData(
    () => all<Vacancy>("/startups/" + project.id + "/vacancies"),
    [project.id, ctx.revision],
  );
  const invites = useData(
    () => all<Offer>("/startups/" + project.id + "/offers"),
    [project.id, ctx.revision],
  );
  const matchingApplications = (incoming.data || []).filter(
    (app) => !statusFilter || app.status === statusFilter,
  );
  const selected = matchingApplications.find((app) => app.id === selectedId)
    || matchingApplications[0];
  const tabList: { id: WorkspaceTab; label: string; count?: number }[] = [
    { id: "responses", label: "Отклики", count: incoming.data?.length },
    { id: "vacancies", label: "Вакансии", count: vacancies.data?.length },
    { id: "invites", label: "Приглашения", count: invites.data?.length },
    { id: "team", label: "Команда" },
    { id: "recruiters", label: "Рекрутеры" },
    ...(owner ? [{ id: "settings" as const, label: "Настройки" }] : []),
  ];
  const changeTab = (value: WorkspaceTab) => {
    setTab(value);
    setSelectedId(null);
    setMobileDetail(false);
    setStatusFilter("");
  };

  return (
    <>
      <div className="cw-context">
        <strong>{project.title}</strong>
        <Status value={project.status} />
        <span className="cw-owner">{owner ? "Вы основатель" : "Вы рекрутер"}</span>
      </div>
      <div className="cw-tabs" role="tablist" aria-label="Управление проектом">
        {tabList.map((item) => (
          <button
            key={item.id}
            id={"cw-tab-" + item.id}
            role="tab"
            type="button"
            aria-selected={item.id === tab}
            aria-controls={"cw-panel-" + item.id}
            tabIndex={item.id === tab ? 0 : -1}
            onClick={() => changeTab(item.id)}
          >
            {item.label}{item.count !== undefined ? " · " + item.count : ""}
          </button>
        ))}
      </div>
      <div
        id={"cw-panel-" + tab}
        role="tabpanel"
        aria-labelledby={"cw-tab-" + tab}
        className="cw-panel"
      >
        {tab === "responses" && (
          <>
            <DataState {...incoming} />
            {incoming.data && incoming.data.length > 0 && (
              <div className={"cw-candidates" + (mobileDetail ? " cw-show-detail" : "")}>
                <div className="cw-candidate-list" aria-label="Входящие отклики">
                  <select
                    aria-label="Статус отклика"
                    value={statusFilter}
                    onChange={(event) => {
                      setStatusFilter(event.target.value);
                      setSelectedId(null);
                      setMobileDetail(false);
                    }}
                  >
                    <option value="">Все отклики</option>
                    {Array.from(new Set(incoming.data.map((app) => app.status))).map((status) => (
                      <option value={status} key={status}>{labels[status] || status}</option>
                    ))}
                  </select>
                  {matchingApplications.map((app) => (
                    <button
                      type="button"
                      className="cw-candidate-button"
                      aria-pressed={selected?.id === app.id}
                      key={app.id}
                      onClick={() => { setSelectedId(app.id); setMobileDetail(true); }}
                    >
                      <strong>{app.applicant_name || "Кандидат"}</strong>
                      <span>{app.vacancy_title || "Общий отклик"} · {app.startup_title}</span>
                      <small>{labels[app.status] || app.status}</small>
                    </button>
                  ))}
                  {!matchingApplications.length && (
                    <p className="cw-muted" style={{padding:20}}>Нет откликов с таким статусом.</p>
                  )}
                </div>
                <div className="cw-candidate-detail" aria-label="Подробности кандидата">
                  <button type="button" className="cw-mobile-back" onClick={() => setMobileDetail(false)}>
                    <ArrowLeft size={16} aria-hidden="true" /> К списку откликов
                  </button>
                  {selected ? (
                    <ApplicationCard key={selected.id} application={selected} ctx={ctx} manager={true} />
                  ) : (
                    <p className="cw-muted">Выберите отклик.</p>
                  )}
                </div>
              </div>
            )}
            {incoming.data?.length === 0 && (
              <CompleteEmpty
                title="Пока нет откликов"
                description="Отклики на вакансии и общие обращения появятся здесь."
              />
            )}
          </>
        )}
        {tab === "vacancies" && (
          <>
            <div className="cw-panel-head">
              <h2>Вакансии проекта</h2>
              {project.status === "active" && (
                <button className="cw-button primary" disabled={ctx.busy} onClick={() => openCreateVacancy(ctx, project.id)}>
                  Добавить вакансию
                </button>
              )}
            </div>
            <DataState {...vacancies} />
            {vacancies.data?.map((vacancy) => (
              <VacancyView key={vacancy.id} initial={vacancy} ctx={ctx} manage={true} />
            ))}
            {vacancies.data?.length === 0 && (
              <CompleteEmpty
                title="Кого ищет ваша команда?"
                description="Добавьте первую вакансию с требованиями, количеством мест и сроком приёма."
              />
            )}
          </>
        )}
        {tab === "invites" && (
          <>
            <h2>Приглашения в команду</h2>
            <DataState {...invites} />
            {invites.data?.map((offer) => (
              <OfferCard key={offer.id} offer={offer} ctx={ctx} manager={true} />
            ))}
            {invites.data?.length === 0 && (
              <CompleteEmpty title="Приглашений пока нет" description="Здесь появятся отправленные кандидатам предложения." />
            )}
          </>
        )}
        {tab === "team" && (
          <>
            <h2>Состав команды</h2>
            <p className="cw-muted">Членство возникает после принятия приглашения кандидатом. История выхода сохраняется.</p>
            <Team startupId={project.id} owner={owner} ctx={ctx} />
          </>
        )}
        {tab === "recruiters" && (
          <>
            <h2>Рекрутеры</h2>
            <p className="cw-muted">Полномочия рекрутера не равны членству в команде.</p>
            <Recruiters startupId={project.id} owner={owner} active={project.status === "active"} ctx={ctx} />
          </>
        )}
        {tab === "settings" && owner && (
          <ProjectSettingsPanel
            project={project}
            busy={ctx.busy}
            onSave={(values) => ctx.perform(async () => {
              await api("/startups/" + project.id, "PATCH", {
                title: values.title,
                description: values.description,
                allow_general_applications: values.allowGeneral,
              }, project.revision);
            })}
            onPause={() => void ctx.perform(async () => {
              await api(
                "/startups/" + project.id + "/" + (project.status === "active" ? "pause" : "resume"),
                "POST", undefined, project.revision,
              );
            })}
            onArchive={() => ctx.form({
              title: "Архивировать проект?",
              notice: "Ожидающие приглашения будут отозваны. Восстановление невозможно.",
              fields: [],
              submit: async () => {
                await api("/startups/" + project.id + "/archive", "POST", undefined, project.revision);
              },
            })}
          />
        )}
      </div>
    </>
  );
}

function Cabinet({ ctx }: { ctx: Context }) {
  const managed = useData(
    () => all<Startup>("/startups?scope=managed"),
    [ctx.user.id, ctx.revision],
    true,
  );
  const [projectId, setProjectId] = useState("");
  // Keep the selected workspace tab when revision refresh temporarily
  // unmounts ProjectWorkspace while /startups?scope=managed is loading.
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("responses");
  const selected = managed.data?.find((p) => p.id === projectId) || managed.data?.[0];

  return (
    <div className="complete-workspace">
      <div className="cw-heading">
        <div>
          <h1>Кабинет</h1>
          <p className="cw-subtitle">Проекты, кандидаты и люди вашей команды.</p>
        </div>
        <div className="cw-actions">
          {selected && (
            <label className="cw-project-picker">
              <span>Проект</span>
              <select aria-label="Управляемый проект" value={selected.id}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setWorkspaceTab("responses");
                }}>
                {managed.data?.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.title} · {labels[p.status] || p.status}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="cw-button primary" disabled={ctx.busy} onClick={() => openCreateProject(ctx)}>
            <Plus size={16} aria-hidden="true" /> Новый проект
          </button>
        </div>
      </div>
      <DataState {...managed} />
      {!selected && managed.data && (
        <CompleteEmpty
          title="Здесь будут ваши проекты"
          description="Создайте стартап или примите приглашение стать рекрутером. Отклики, личный профиль и уведомления находятся в отдельных разделах."
          action={<button className="cw-button primary" disabled={ctx.busy} onClick={() => openCreateProject(ctx)}>
            Создать первый проект
          </button>}
        />
      )}
      {selected && <ProjectWorkspace key={selected.id} project={selected} ctx={ctx} tab={workspaceTab} setTab={setWorkspaceTab} />}
    </div>
  );
}

function ApplicationsScreen({ ctx }: { ctx: Context }) {
  const applications = useData(
    () => all<Application>("/applications/mine"), [ctx.user.id, ctx.revision],
  );
  const offers = useData(
    () => all<Offer>("/offers/mine"), [ctx.user.id, ctx.revision],
  );
  const invitations = useData(
    () => all<Invitation>("/recruiter-invitations/mine"), [ctx.user.id, ctx.revision],
  );
  return (
    <div className="complete-workspace cw-applications">
      <div className="cw-heading">
        <div>
          <h1>Мои отклики</h1>
          <p className="cw-subtitle">Решения команд, приглашения и история ваших заявок.</p>
        </div>
        <button type="button" className="text-button cw-related-link" onClick={ctx.showTeams}>
          Мои команды →
        </button>
      </div>
      <section className="cw-applications-section cw-applications-first">
        <h2 className="cw-list-title">Приглашения в команду</h2>
      <DataState {...offers} />
      {offers.data?.map((offer) => (
        <OfferCard key={offer.id} offer={offer} ctx={ctx} manager={false} />
      ))}
      {offers.data?.length === 0 && (
        <p className="cw-muted">Приглашений пока нет. Когда команда примет решение, оно появится здесь.</p>
      )}
      </section>
      <section className="cw-applications-section">
        <h2 className="cw-list-title">Отправленные отклики</h2>
      <DataState {...applications} />
      {applications.data?.map((app) => (
        <ApplicationCard key={app.id} application={app} ctx={ctx} manager={false} />
      ))}
      {applications.data?.length === 0 && (
        <CompleteEmpty
          title="Откликов пока нет"
          description="Выберите проект и расскажите команде о себе."
          action={<button type="button" className="cw-button primary" onClick={ctx.showProjects}>
            Найти проект
          </button>}
        />
      )}
      </section>
      <section className="cw-applications-section">
        <h2 className="cw-list-title">Рекрутерские приглашения</h2>
      <DataState {...invitations} />
      {invitations.data?.map((inv) => (
        <div className="cw-entry" key={inv.id}>
          <h3><ProjectName id={inv.startup_id} /></h3>
          <p>Действует до {dateTime(inv.expires_at)}</p>
          <Status value={inv.status} />
          {inv.status === "pending" && new Date(inv.expires_at) > new Date() && (
            <div className="cw-actions">
              {(["accept", "decline"] as const).map((action) => (
                <button className="cw-button" disabled={ctx.busy} key={action}
                  onClick={() => void ctx.perform(async () => {
                    await api("/recruiter-invitations/" + inv.id + "/" + action, "POST");
                  })}>
                  {action === "accept" ? "Принять полномочия" : "Отказаться"}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {invitations.data?.length === 0 && <p className="cw-muted">Новых приглашений нет.</p>}
      </section>
    </div>
  );
}

function TeamsScreen({ ctx }: { ctx: Context }) {
  const teams = useData(
    () => all<Startup>("/startups?scope=member"), [ctx.user.id, ctx.revision],
  );
  return (
    <div className="complete-workspace">
      <div className="cw-heading">
        <div><h1>Мои команды</h1>
          <p className="cw-subtitle">Проекты, в которых вы сейчас состоите.</p>
        </div>
      </div>
      <DataState {...teams} />
      {teams.data?.map((p) => (
        <div className="cw-entry" key={p.id}>
          <h3>{p.title}</h3>
          <p>{p.description || "Описание не указано"}</p>
          <button className="cw-button" onClick={() => ctx.open(p)}>Открыть проект</button>
        </div>
      ))}
      {teams.data?.length === 0 && (
        <CompleteEmpty title="Вы пока не состоите в командах"
          description="После принятия приглашения команда появится здесь." />
      )}
    </div>
  );
}

function ProfileScreen({
  ctx, updateUser,
}: {
  ctx: Context;
  updateUser: (person: Person) => void;
}) {
  const initials = ctx.user.name.split(/\s+/).filter(Boolean)
    .slice(0, 2).map((name) => name[0]?.toUpperCase()).join("");
  return (
    <div className="complete-workspace">
      <div className="cw-heading">
        <div><h1>Мой профиль</h1>
          <p className="cw-subtitle">Информация, которую вы показываете участникам и командам.</p>
        </div>
      </div>
      <div className="cw-profile-layout">
        <aside className="cw-profile-summary">
          <span className="cw-avatar" aria-hidden="true">{initials}</span>
          <h2>{ctx.user.name}</h2>
          <p>Участник Бизнес-клуба</p>
        </aside>
        <section className="cw-profile-fields">
          <h2>О себе</h2>
          <p>{ctx.user.bio || "Расскажите о себе."}</p>
          <h3>Навыки</h3>
          <p>{ctx.user.skills.length ? ctx.user.skills.join(", ") : "Пока не указаны."}</p>
          {ctx.user.portfolio_url && <p><a href={ctx.user.portfolio_url} target="_blank" rel="noreferrer">
            Портфолио ↗
          </a></p>}
          <button className="cw-button primary" disabled={ctx.busy}
            onClick={() => ctx.form({
              title: "Мой профиль",
              values: {
                name: ctx.user.name,
                bio: ctx.user.bio,
                skills: ctx.user.skills.join(", "),
                portfolio_url: ctx.user.portfolio_url || "",
              },
              fields: [
                text("name", "Имя", true), area("bio", "О себе"),
                text("skills", "Навыки через запятую"),
                { name: "portfolio_url", label: "Портфолио", type: "url" },
              ],
              submit: async (values) => {
                updateUser(await api<Person>("/users/me", "PATCH", {
                  name: values.name,
                  bio: values.bio,
                  skills: values.skills.split(",").map((skill) => skill.trim()).filter(Boolean),
                  portfolio_url: values.portfolio_url || null,
                }));
              },
            })}>
            Редактировать профиль
          </button>
        </section>
      </div>
    </div>
  );
}

function NotificationsScreen({ ctx }: { ctx: Context }) {
  const notifications = useData(
    () => all<Notification>("/notifications"), [ctx.user.id, ctx.revision],
  );
  const [unreadOnly, setUnreadOnly] = useState(false);
  const ordered = [...(notifications.data || [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const unread = ordered.filter((n) => !n.read_at).length;
  const visible = unreadOnly ? ordered.filter((n) => !n.read_at) : ordered;
  return (
    <div className="complete-workspace">
      <div className="cw-heading">
        <div><h1>Уведомления</h1>
          <p className="cw-subtitle">События, адресованные вашему аккаунту.</p>
        </div>
        <div className="cw-actions">
          <label className="cw-project-picker">
            <input type="checkbox" checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)} />
            Только непрочитанные
          </label>
          <span className="cw-muted">Непрочитанных: {unread}</span>
        </div>
      </div>
      <DataState {...notifications} />
      {visible.map((item) => (
        <article className={"cw-notification" + (!item.read_at ? " unread" : "")} key={item.id}>
          <div>
            <h3>{item.title}</h3>
            <p>{item.message}</p>
            <time dateTime={item.created_at}>{dateTime(item.created_at)}</time>
          </div>
          {!item.read_at && <button className="cw-button" disabled={ctx.busy}
            onClick={() => void ctx.perform(async () => {
              await api("/notifications/" + item.id + "/read", "PATCH");
            })}>Прочитано</button>}
        </article>
      ))}
      {notifications.data && visible.length === 0 &&
        <CompleteEmpty title={unreadOnly ? "Всё прочитано" : "Уведомлений пока нет"}
          description={unreadOnly ? "Новых уведомлений нет." : "Важные события появятся здесь."} />}
    </div>
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
  const [expanded, setExpanded] = useState(manager);
  const own = a.applicant_id === ctx.user.id;
  const candidate = useData(
    () => manager
      ? api<Person>("/users/" + a.applicant_id)
      : Promise.resolve(undefined),
    [a.applicant_id, manager, ctx.user.id, ctx.revision],
  );
  const membership = useData(
    () =>
      own && ["joined", "already_joined"].includes(a.status)
        ? all<Member>(`/startups/${a.startup_id}/members`)
        : Promise.resolve([]),
    [a.id, a.status, ctx.revision],
  );
  return (
    <article className={"cw-record cw-application-record" + (manager ? " cw-manager-record" : "")}>
      <header className="cw-record-heading">
        <div className="cw-record-identity">
          <p className="cw-record-eyebrow">{a.startup_title}</p>
          <h3>{manager ? a.applicant_name : a.vacancy_title || "Общий отклик"}</h3>
          {manager && <p className="cw-record-role">{a.vacancy_title || "Общий отклик"}</p>}
          <p className="cw-record-preview prewrap">{a.message || "Без сопроводительного сообщения"}</p>
        </div>
        <Status value={a.status} />
      </header>
      {manager && (
        <section className="cw-candidate-profile">
          <h4>О кандидате</h4>
          {candidate.error && <p className="cw-muted">Не удалось загрузить профиль кандидата.</p>}
          {candidate.data ? (
            <>
              <p className="prewrap">{candidate.data.bio || "Описание пока не заполнено."}</p>
              <dl className="cw-candidate-facts">
                <dt>Навыки</dt>
                <dd>{candidate.data.skills.length ? candidate.data.skills.join(", ") : "Не указаны"}</dd>
                <dt>Портфолио</dt>
                <dd>
                  {candidate.data.portfolio_url ? (
                    <a href={candidate.data.portfolio_url} target="_blank" rel="noopener noreferrer">
                      Открыть портфолио ↗
                    </a>
                  ) : "Не добавлено"}
                </dd>
              </dl>
            </>
          ) : !candidate.error && <p className="cw-muted">Загрузка профиля…</p>}
        </section>
      )}
      {a.rejection_reason && (
        <div className="cw-record-reason">
          <strong>Причина решения</strong>
          <p className="prewrap">{a.rejection_reason}</p>
        </div>
      )}
      <div className="cw-record-actions actions wrap">
        <button type="button" className="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
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
    <div className="cw-record-detail details-body">
      <section className="cw-record-section"><h4>Попытки и условия</h4>
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
      </section>
      {a.vacancy_id && (
        <section className="cw-record-section">
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
        </section>
      )}
      <section className="cw-record-section"><h4>События</h4>
      <DataState {...events} />
      <ol className="cw-timeline">
        {events.data
          ?.slice()
          .sort((x, y) => x.created_at.localeCompare(y.created_at))
          .map((e) => (
            <li key={e.id}>
              <time dateTime={e.created_at}>{dateTime(e.created_at)}</time>
              <strong>{eventLabels[e.event_type] || "Изменение в проекте"}</strong>
              {e.actor_name && <p>{e.actor_name}</p>}
              {e.metadata?.reason && <p className="prewrap">{e.metadata.reason}</p>}
            </li>
          ))}
      </ol>
      </section>
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
    <article className="cw-record cw-offer-record">
      <header className="cw-record-heading">
        <div className="cw-record-identity">
          <p className="cw-record-eyebrow">{o.startup_title}</p>
          <h3>{o.vacancy_title || "Общее приглашение"}</h3>
          {manager && <p className="cw-record-role">Кандидат: <PersonName id={o.candidate_id} /></p>}
          <p className="cw-record-preview prewrap">{o.message}</p>
          <p className="cw-record-role">Ответить до {dateTime(o.expires_at)}</p>
        </div>
        <Status value={o.status} />
      </header>
      {o.vacancy_title && (
        <details>
          <summary>Условия именно этого приглашения</summary>
          <p className="prewrap">{o.vacancy_description}</p>
          <p>{o.vacancy_requirements}</p>
        </details>
      )}
      {o.status === "pending" && (
        <div className="cw-record-actions actions wrap">
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
        <div className="cw-record cw-member-record" key={m.id}>
          <h3><PersonName id={m.user_id} /></h3>
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
        <div className="cw-recruiter-row" key={g.id}>
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
          <div className="cw-recruiter-row" key={person.id}>
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
          <h4 className="cw-recruiter-subheading">Отправленные приглашения рекрутеров</h4>
          <DataState {...invitations} />
          {invitations.data?.map((inv) => (
            <div className="cw-recruiter-row cw-recruiter-invite" key={inv.id}>
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

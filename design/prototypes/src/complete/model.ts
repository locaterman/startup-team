import { projects } from "../data";

export type Profile = {
  id: string;
  name: string;
  bio: string;
  skills: string;
  portfolio: string;
};
export type Project = {
  id: string;
  title: string;
  description: string;
  status: string;
  general: boolean;
  owner: string;
};
export type Version = {
  number: number;
  title: string;
  description: string;
  requirements: string;
  reason: string;
  date: string;
};
export type Task = {
  version: number;
  description: string;
  deadline: string;
  critical: boolean;
};
export type Vacancy = {
  id: string;
  project: string;
  title: string;
  description: string;
  requirements: string;
  seats: number;
  deadline: string;
  status: string;
  versions: Version[];
  tasks: Task[];
};
export type Attempt = {
  number: number;
  version: number;
  letter: string;
  status: string;
  reason: string;
  date: string;
};
export type Submission = {
  id: string;
  attempt: number | null;
  testVersion: number;
  solution: string;
  status: string;
  date: string;
  legacy?: boolean;
};
export type Entry = {
  id: string;
  project: string;
  vacancy: string | null;
  person: string;
  status: string;
  letter: string;
  reason: string;
  attempts: Attempt[];
  submissions: Submission[];
  solution?: string;
  testVersion?: number;
  testStatus?: string;
};
export type Offer = {
  attempt: number | null;
  id: string;
  entry: string;
  status: string;
  message: string;
  deadline: string;
  title: string;
  description: string;
  requirements: string;
  version: number;
};
export type Member = {
  vacancy: string | null;
  originUnknown?: boolean;
  id: string;
  project: string;
  person: string;
  role: string;
  active: boolean;
};
export type Recruiter = {
  deadline: string;
  id: string;
  project: string;
  person: string;
  status: string;
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  project?: string;
  entry?: string;
};
export type Event = {
  id: string;
  entry: string;
  title: string;
  detail: string;
  date: string;
};
export type Store = {
  profiles: Profile[];
  projects: Project[];
  vacancies: Vacancy[];
  entries: Entry[];
  offers: Offer[];
  members: Member[];
  recruiters: Recruiter[];
  notices: Notice[];
  events: Event[];
};
export const key = "startup-team-complete-design-v1";
export const uid = () => crypto.randomUUID();
export const localInput = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export const now = () => new Date().toISOString();
export const day = (offset = 7) =>
  localInput(new Date(Date.now() + offset * 86400000).toISOString());
export const instant = (value: string) =>
  new Date(value.length === 10 ? value + "T23:59:59" : value).toISOString();
export const isFuture = (value: string) =>
  new Date(value).getTime() > Date.now();
export const format = (value: string) =>
  !value
    ? "Срок не сохранён"
    : new Date(value).toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
export const labels: Record<string, string> = {
  active: "Активен",
  paused: "Пауза",
  archived: "Архив",
  published: "Приём открыт",
  closed: "Приём закрыт",
  pending: "Ожидает решения",
  reviewing: "На рассмотрении",
  offer_pending: "Приглашение",
  rejected: "Отказ",
  withdrawn: "Отозван",
  reset: "Можно подать заново",
  joined: "В команде",
  already_joined: "Завершён при вступлении",
  declined: "Отказ от приглашения",
  accepted: "Принято",
  revoked: "Отозвано",
  expired: "Истекло",
  submitted: "Решение отправлено",
  reviewed: "Проверено",
  superseded: "Нужна новая версия",
  invited: "Ожидает согласия",
};
export function seed(): Store {
  const profiles = [
    {
      id: "ivan",
      name: "Иван Петров",
      bio: "Основатель ATLAS. Превращаю сложные задачи в понятные продукты.",
      skills: "Продукт, аналитика, Python",
      portfolio: "https://example.org/ivan",
    },
    {
      id: "anna",
      name: "Анна Смирнова",
      bio: "Два года в веб-разработке. Люблю понятные и доступные интерфейсы.",
      skills: "React, TypeScript, Figma",
      portfolio: "https://example.org/anna",
    },
    {
      id: "maria",
      name: "Мария Соколова",
      bio: "Исследую образовательные продукты и помогаю командам расти.",
      skills: "Product management, исследования",
      portfolio: "",
    },
    {
      id: "alex",
      name: "Алексей Морозов",
      bio: "Backend-разработчик. Python, PostgreSQL, надёжность систем.",
      skills: "Python, SQL, Docker",
      portfolio: "https://example.org/alex",
    },
  ];
  const ps = projects.map((p, i) => ({
    id: p.id,
    title: p.name,
    description: p.desc + " " + p.about,
    status: i === 5 ? "paused" : "active",
    general: true,
    owner: i === 1 ? "maria" : "ivan",
  }));
  const vacancies: Vacancy[] = projects.flatMap((p) =>
    p.roles.map((role, i) => ({
      id: p.id + "-" + i,
      project: p.id,
      title: role,
      description:
        "Помогите команде " + p.name + " довести продукт до следующего этапа.",
      requirements:
        "Опыт командной работы, самостоятельность и примеры проектов.",
      seats: 2,
      deadline: instant(day(14)),
      status: "published",
      versions: [
        {
          number: 1,
          title: role,
          description:
            "Помогите команде " +
            p.name +
            " довести продукт до следующего этапа.",
          requirements:
            "Опыт командной работы, самостоятельность и примеры проектов.",
          reason: "Публикация вакансии",
          date: now(),
        },
      ],
      tasks:
        p.id === "atlas" && i === 0
          ? [
              {
                version: 1,
                description:
                  "Сделайте небольшой список проектов с поиском. Опишите принятые решения и приложите ссылку на код.",
                deadline: instant(day(10)),
                critical: false,
              },
            ]
          : [],
    })),
  );
  const entry = (
    id: string,
    person: string,
    vacancy: string | null,
    status: string,
    letter: string,
  ): Entry => ({
    id,
    project: "atlas",
    vacancy,
    person,
    status,
    letter,
    reason: "",
    attempts: [
      { number: 1, version: 1, letter, status, reason: "", date: now() },
    ],
    submissions: [],
  });
  const entries = [
    entry(
      "entry-anna",
      "anna",
      "atlas-0",
      "pending",
      "Хочу работать над интерфейсом аналитического продукта. Покажу опыт на React и помогу с доступностью.",
    ),
    entry(
      "entry-alex",
      "alex",
      "atlas-1",
      "reviewing",
      "Хочу применить опыт работы с данными в вашей команде.",
    ),
    entry(
      "entry-maria",
      "maria",
      null,
      "offer_pending",
      "Интересен продукт. Готова помочь команде с исследованиями и развитием.",
    ),
  ];
  return {
    profiles,
    projects: ps,
    vacancies,
    entries,
    offers: [
      {
        id: "offer-maria",
        attempt: 1,
        entry: "entry-maria",
        status: "pending",
        message:
          "Приглашаем познакомиться с командой и обсудить роль в развитии продукта.",
        deadline: instant(day(7)),
        title: "Общее участие в ATLAS",
        description:
          "Исследования и развитие продукта. Условия обсуждаются с командой.",
        requirements: "Взаимный интерес к проекту",
        version: 1,
      },
    ],
    members: [
      {
        id: "member-alex",
        vacancy: null,
        project: "contour",
        person: "alex",
        role: "Участник команды",
        active: true,
      },
    ],
    recruiters: [
      {
        id: "recruiter-anna",
        deadline: instant(day(7)),
        project: "forma",
        person: "anna",
        status: "invited",
      },
    ],
    notices: [
      {
        id: "n1",
        title: "Новый отклик на Frontend-разработчика",
        body: "Анна рассказала о своём опыте. Откройте отклик, чтобы начать рассмотрение.",
        read: false,
        project: "atlas",
        entry: "entry-anna",
      },
      {
        id: "n2",
        title: "Приглашение отправлено",
        body: "Мария получила приглашение в ATLAS. Вступление произойдёт после её согласия.",
        read: false,
        project: "atlas",
        entry: "entry-maria",
      },
      {
        id: "n3",
        title: "Добро пожаловать в Startup Team",
        body: "Это дизайн-прототип. Все данные вымышлены и сохраняются только в этом браузере.",
        read: true,
      },
    ],
    events: [
      {
        id: "e1",
        entry: "entry-anna",
        title: "Отклик отправлен",
        detail: "Первая попытка · условия версии 1",
        date: now(),
      },
    ],
  };
}
export function load(): Store {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      if (
        data.profiles?.length &&
        data.projects?.length &&
        data.vacancies &&
        data.entries &&
        data.offers &&
        data.members &&
        data.recruiters &&
        data.notices &&
        data.events
      )
        return normalize(data as Store);
    }
  } catch {
    /* Demo can run without storage. */
  }
  return seed();
}
export function event(s: Store, entry: string, title: string, detail = "") {
  s.events.unshift({ id: uid(), entry, title, detail, date: now() });
  s.notices.unshift({
    id: uid(),
    title,
    body: detail || "Изменение сохранено в демонстрационном сценарии.",
    read: false,
    entry,
  });
}
export function sync(entry: Entry) {
  const current = entry.attempts[entry.attempts.length - 1];
  if (current) {
    current.status = entry.status;
    current.reason = entry.reason;
  }
}

// Upgrade the previous local-only prototype without dropping its saved data.
export function normalize(store: Store): Store {
  const date = (value: string) =>
    value?.length === 10 && Number.isFinite(new Date(value).getTime())
      ? instant(value)
      : value;
  for (const v of store.vacancies) {
    v.deadline = date(v.deadline);
    for (const t of v.tasks) t.deadline = date(t.deadline);
  }
  for (const a of store.entries) {
    a.submissions ??= [];
    // Older events retained links but not an authoritative attempt binding.
    for (const e of store.events.filter(
      (e) => e.entry === a.id && e.title === "Решение отправлено",
    )) {
      const match = /Версия тестового (\d+) · (https:\/\/\S+)/.exec(e.detail);
      if (match && !a.submissions.some((t) => t.id === "legacy-" + e.id))
        a.submissions.push({
          id: "legacy-" + e.id,
          attempt: null,
          testVersion: Number(match[1]),
          solution: match[2],
          status: "submitted",
          date: e.date,
          legacy: true,
        });
    }
    if (a.solution && !a.submissions.some((t) => t.solution === a.solution))
      a.submissions.push({
        id: "legacy-current-" + a.id,
        attempt: null,
        testVersion: a.testVersion || 1,
        solution: a.solution,
        status: a.testStatus || "submitted",
        date: a.attempts[a.attempts.length - 1].date,
        legacy: true,
      });
  }
  for (const o of store.offers) {
    o.deadline = date(o.deadline);
    if (o.attempt === undefined) {
      const a = store.entries.find((a) => a.id === o.entry);
      const candidates =
        a?.attempts.filter((at) => at.version === o.version) || [];
      o.attempt = candidates.length === 1 ? candidates[0].number : null;
    }
  }
  for (const m of store.members)
    if (m.vacancy === undefined) {
      m.vacancy = null;
      m.originUnknown = true;
    }
  for (const g of store.recruiters) if (!g.deadline) g.deadline = "";
  return store;
}

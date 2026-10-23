import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { all, type Notification, type Person } from "./api";
import { useTelegramBack } from "./telegram";
import "./integration-header.css";

export type Section =
  "projects" | "vacancies" | "applications" | "cabinet" |
  "profile" | "notifications" | "teams";

const sections: { id: Section; label: string }[] = [
  { id: "projects", label: "Стартапы" },
  { id: "vacancies", label: "Вакансии" },
  { id: "applications", label: "Мои отклики" },
  { id: "cabinet", label: "Кабинет" },
];

/**
 * Shared authenticated header adapted from the final/complete design.
 * The real session and actor are always owned by the live frontend/backend.
 */
export function AppHeader({
  user,
  active,
  busy,
  revision,
  onNavigate,
  onLogout,
}: {
  user: Person;
  active: string;
  busy: boolean;
  revision: number;
  onNavigate: (section: Section) => void;
  onLogout: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  // Dismiss the profile menu before navigating to another screen.
  useTelegramBack(accountOpen, () => setAccountOpen(false), 70);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setUnreadCount(null);
    all<Notification>("/notifications")
      .then((items) => {
        if (active) setUnreadCount(items.filter((item) => !item.read_at).length);
      })
      .catch(() => {
        if (active) setUnreadCount(null);
      });
    return () => { active = false; };
  }, [user.id, revision]);
  const navigate = (section: Section) => {
    setAccountOpen(false);
    onNavigate(section);
  };
  return (
    <>
      <a className="integrated-skip-link" href="#app-content">
        К содержимому
      </a>
      <header className="integrated-header">
        <div className="integrated-header-inner">
          <button
            type="button"
            className="integrated-brand"
            onClick={() => navigate("projects")}
            aria-label="Бизнес-клуб — к стартапам"
          >
            <img src="/club-emblem.png" alt="" />
            <span>
              Бизнес-клуб<small>НИУ ВШЭ</small>
            </span>
          </button>
          <nav className="integrated-nav" aria-label="Основные разделы">
            {sections.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-current={active === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="integrated-account">
            <button
              type="button"
              className="integrated-notifications"
              title="Уведомления"
              aria-label={"Уведомления" + (unreadCount ? ": " + unreadCount + " непрочитанных" : "")}
              onClick={() => navigate("notifications")}
              aria-current={active === "notifications" ? "page" : undefined}
            >
              <Bell size={19} aria-hidden="true" />
              {unreadCount !== null && unreadCount > 0 &&
                <span className="integrated-notification-dot" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="integrated-account-toggle"
              aria-label={"Профиль: " + user.name}
              aria-expanded={accountOpen}
              aria-controls="integrated-account-menu"
              onClick={() => setAccountOpen((value) => !value)}
            >
              <span className="integrated-account-name">{user.name}</span>
              <span className="integrated-account-initials" aria-hidden="true">
                {user.name.split(/\s+/).filter(Boolean).slice(0, 2)
                  .map((part) => part[0]?.toUpperCase()).join("")}
              </span>
            </button>
            {accountOpen && (
              <div id="integrated-account-menu" className="integrated-account-menu">
                <strong>{user.name}</strong>
                <button type="button" onClick={() => navigate("profile")}>
                  Мой профиль
                </button>
                <button type="button" onClick={() => navigate("teams")}>
                  Мои команды
                </button>
                <button type="button" onClick={() => navigate("cabinet")}>
                  Управление проектами
                </button>
                <button type="button" onClick={() => navigate("notifications")}>
                  Уведомления{unreadCount ? " · " + unreadCount : ""}
                </button>
                <button type="button" disabled={busy} onClick={onLogout}>
                  Выйти
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

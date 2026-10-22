import { useState } from "react";
import type { Person } from "./api";
import "./integration-header.css";

type Section = "projects" | "vacancies" | "cabinet";

const sections: { id: Section; label: string }[] = [
  { id: "projects", label: "Стартапы" },
  { id: "vacancies", label: "Вакансии" },
  { id: "cabinet", label: "Мой кабинет" },
];

/**
 * First production slice of the complete design.
 * Navigation uses the existing authenticated app state; it never selects a demo actor.
 */
export function AppHeader({
  user,
  active,
  busy,
  onNavigate,
  onLogout,
}: {
  user: Person;
  active: string;
  busy: boolean;
  onNavigate: (section: Section) => void;
  onLogout: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
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
              className="integrated-account-toggle"
              aria-label={"Профиль: " + user.name}
              aria-expanded={accountOpen}
              aria-controls="integrated-account-menu"
              onClick={() => setAccountOpen((value) => !value)}
            >
              <span className="integrated-account-name">{user.name}</span>
              <span className="integrated-account-initials" aria-hidden="true">
                {user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
              </span>
            </button>
            {accountOpen && (
              <div id="integrated-account-menu" className="integrated-account-menu">
                <strong>{user.name}</strong>
                <button type="button" onClick={() => navigate("cabinet")}>
                  Мой кабинет
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

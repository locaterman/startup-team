import { useState } from "react";
import type { Person } from "./api";
import type { AuthConfig } from "./telegram";
import "./auth.css";

function Brand() {
  return (
    <div className="tg-brand">
      <img src="/club-emblem.png" alt="" />
      <div>
        Бизнес-клуб<span>НИУ ВШЭ</span>
      </div>
    </div>
  );
}
export function AuthScreen({
  config,
  insideTelegram,
  error,
  busy,
  email,
  password,
  onEmail,
  onPassword,
  onDemo,
  onTelegram,
  onRetry,
}: {
  config: AuthConfig;
  insideTelegram: boolean;
  error: string;
  busy: boolean;
  email: string;
  password: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onDemo: () => void;
  onTelegram: () => void;
  onRetry: () => void;
}) {
  return (
    <main className="tg-auth">
      <header>
        <Brand />
      </header>
      <div className="tg-auth-grid">
        <section className="tg-intro">
          <p className="tg-eyebrow">STARTUP TEAM</p>
          <h1>
            Сильные идеи <br />
            находят свою <br />
            <span>команду.</span>
          </h1>
          <p>
            Знакомьтесь с проектами, предлагайте свой опыт и создавайте новое
            вместе с участниками клуба.
          </p>
          <div className="tg-points">
            <span>Проекты и вакансии</span>
            <span>Люди и сотрудничество</span>
          </div>
        </section>
        <section className="tg-card">
          <p className="tg-eyebrow">БИЗНЕС-КЛУБ · СООБЩЕСТВО</p>
          <h2>Добро пожаловать</h2>
          {insideTelegram ? (
            <>
              <p>
                Ваш аккаунт создастся при первом подтверждённом входе через
                Telegram. Отдельный пароль не нужен.
              </p>
              <button
                className="tg-primary"
                disabled={busy || !config.telegram_enabled}
                aria-busy={busy}
                onClick={onTelegram}
              >
                {busy ? "Проверяем вход…" : "Войти через Telegram"}
              </button>
              {!config.telegram_enabled && (
                <p className="tg-hint">
                  Telegram-вход ещё не настроен на сервере.
                </p>
              )}
            </>
          ) : (
            <>
              <p>
                Откройте приложение из Telegram-бота клуба, чтобы войти под
                своим аккаунтом.
              </p>
              <div className="tg-callout">
                Вход привязан к вашему Telegram. Имя, навыки и описание можно
                заполнить после входа.
              </div>
            </>
          )}
          {error && (
            <div className="tg-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={onRetry} disabled={busy} aria-busy={busy}>
                Повторить проверку
              </button>
            </div>
          )}
          {config.demo_enabled && (
            <form
              className="tg-demo"
              onSubmit={(e) => {
                e.preventDefault();
                onDemo();
              }}
            >
              <h3>Демонстрационный вход</h3>
              <p>Для проверки прототипа в обычном браузере.</p>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => onEmail(e.target.value)}
                />
              </label>
              <label>
                Пароль
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => onPassword(e.target.value)}
                />
              </label>
              <button className="tg-secondary" disabled={busy} aria-busy={busy}>
                {busy ? "Выполняем вход…" : "Войти в демо"}
              </button>
              <p className="tg-hint">
                ivan@example.test · demo-ivan-123
                <br />
                maria@example.test · demo-maria-123
                <br />
                alex@example.test · demo-alex-123
              </p>
            </form>
          )}
        </section>
      </div>
      <footer>Бизнес-клуб НИУ ВШЭ · Startup Team</footer>
    </main>
  );
}

export function OnboardingScreen({
  user,
  busy,
  error,
  onSave,
  onLogout,
}: {
  user: Person;
  busy: boolean;
  error: string;
  onSave: (values: {
    name: string;
    bio: string;
    skills: string[];
    portfolio_url: string | null;
  }) => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(user.name),
    [bio, setBio] = useState(user.bio),
    [skills, setSkills] = useState(user.skills.join(", ")),
    [portfolio, setPortfolio] = useState(user.portfolio_url || "");
  return (
    <main className="tg-auth tg-onboarding">
      <header>
        <Brand />
        <button className="tg-link" onClick={onLogout} disabled={busy}>
          Выйти
        </button>
      </header>
      <section className="tg-card">
        <p className="tg-eyebrow">ПЕРВОЕ ЗНАКОМСТВО</p>
        <h1>Расскажите о себе</h1>
        <p>
          Команды увидят ваш профиль вместе с откликом. Его можно будет изменить
          в кабинете.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              name: name.trim(),
              bio,
              skills: skills
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              portfolio_url: portfolio.trim() || null,
            });
          }}
        >
          <label>
            Имя и фамилия
            <input
              required
              maxLength={120}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Коротко о себе
            <textarea
              maxLength={5000}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Опыт, интересы и проекты, над которыми хотите работать"
            />
          </label>
          <label>
            Навыки
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Например: Python, аналитика, исследования"
            />
            <small>Перечислите через запятую.</small>
          </label>
          <label>
            Портфолио <span>· необязательно</span>
            <input
              type="url"
              value={portfolio}
              onChange={(e) => setPortfolio(e.target.value)}
              placeholder="https://"
            />
          </label>
          {error && (
            <p className="tg-error" role="alert">
              {error}
            </p>
          )}
          <button className="tg-primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить и перейти к проектам"}
          </button>
        </form>
      </section>
      <footer>
        Ваш Telegram ID используется для входа и не показывается в публичном
        профиле.
      </footer>
    </main>
  );
}

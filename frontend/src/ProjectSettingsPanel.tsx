import { useEffect, useState, type FormEvent } from "react";
import type { Startup } from "./api";
import "./project-settings.css";

export type ProjectSettingsValues = {
  title: string;
  description: string;
  allowGeneral: boolean;
};

/** Presentational settings form, matching the approved complete view.
 * Writes must go through the caller's existing authenticated API command.
 */
export function ProjectSettingsPanel({
  project,
  busy,
  onSave,
  onPause,
  onArchive,
}: {
  project: Startup;
  busy: boolean;
  onSave: (values: ProjectSettingsValues) => Promise<void>;
  onPause: () => void;
  onArchive: () => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description || "");
  const [allowGeneral, setAllowGeneral] = useState(project.allow_general_applications);
  const archived = project.status === "archived";

  useEffect(() => {
    // Refresh only when the server accepted a new revision or project changed.
    setTitle(project.title);
    setDescription(project.description || "");
    setAllowGeneral(project.allow_general_applications);
  }, [project.id, project.revision]);

  const changed =
    title !== project.title ||
    description !== (project.description || "") ||
    allowGeneral !== project.allow_general_applications;

  const reset = () => {
    setTitle(project.title);
    setDescription(project.description || "");
    setAllowGeneral(project.allow_general_applications);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || archived || !changed || !title.trim()) return;
    void onSave({ title: title.trim(), description, allowGeneral });
  };

  return (
    <div className="cw-project-settings" aria-label="Настройки стартапа">
      <form className="cw-project-settings-editor" onSubmit={submit}>
        <h2>О проекте</h2>
        <label>
          Название *
          <input
            name="title"
            maxLength={180}
            required
            disabled={busy || archived}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Описание
          <textarea
            name="description"
            maxLength={5000}
            disabled={busy || archived}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="cw-project-settings-checkbox">
          <input
            name="allow_general_applications"
            type="checkbox"
            checked={allowGeneral}
            disabled={busy || archived}
            onChange={(event) => setAllowGeneral(event.target.checked)}
          />
          <span>
            Разрешить общие отклики
            <small>Участники смогут предложить помощь без выбора вакансии.</small>
          </span>
        </label>
        {!archived && (
          <div className="cw-project-settings-actions">
            <button type="submit" className="primary" disabled={busy || !changed || !title.trim()}>
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
            <button type="button" className="text-button" disabled={busy || !changed} onClick={reset}>
              Отмена
            </button>
          </div>
        )}
        {archived && <p className="cw-project-settings-hint">Архив проекта нельзя изменить.</p>}
      </form>

      <aside className="cw-project-settings-side">
        <section>
          <h3>Состояние проекта</h3>
          <p>{project.status === "active" ? "Активен" : project.status === "paused" ? "Пауза" : "В архиве"}</p>
          <p>
            Пауза останавливает новые отклики. История и участники сохраняются.
          </p>
          {!archived && (
            <button type="button" className="outline" disabled={busy} onClick={onPause}>
              {project.status === "active" ? "Приостановить набор" : "Возобновить набор"}
            </button>
          )}
        </section>
        <section>
          <h3>Архивирование</h3>
          <p>
            Архивирование завершает набор и отзывает ожидающие приглашения.
            Участники и история остаются. Восстановить проект нельзя.
          </p>
          {!archived && (
            <button type="button" className="text-button cw-project-settings-danger" disabled={busy} onClick={onArchive}>
              Архивировать проект
            </button>
          )}
        </section>
      </aside>
    </div>
  );
}

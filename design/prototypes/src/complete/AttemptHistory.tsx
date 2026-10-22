import { labels, type Entry, type Vacancy } from './model';
import { attemptConditions } from './rules';

export function AttemptHistory({ entry, vacancy }: { entry: Entry; vacancy?: Vacancy }) {
  return (
    <section className="record-section">
      <h3>Попытки и условия</h3>
      {[...entry.attempts].reverse().map((attempt) => {
        const conditions = attemptConditions(entry, attempt, vacancy);
        return (
          <details className="history-record" key={attempt.number}>
            <summary>
              <span>
                Попытка {attempt.number} · {entry.vacancy ? `условия v${attempt.version}` : 'общий отклик'}
              </span>
              <span className={'state state-' + attempt.status}>{labels[attempt.status] || attempt.status}</span>
            </summary>
            <p><strong>Письмо кандидата</strong></p>
            <p className="prewrap">{attempt.letter || 'Без сопроводительного письма.'}</p>
            {attempt.reason && <p className="prewrap">Причина: {attempt.reason}</p>}
            {conditions ? (
              <div className="attempt-conditions">
                <p><strong>Роль</strong></p>
                <h4 className="prewrap">{conditions.title}</h4>
                <p><strong>Описание</strong></p>
                <p className="prewrap">{conditions.description || 'Описание не указано.'}</p>
                <p><strong>Требования</strong></p>
                <p className="prewrap">{conditions.requirements || 'Требования не указаны.'}</p>
              </div>
            ) : (
              <p className="subtle">
                {entry.vacancy
                  ? 'Исторические условия не сохранены. Текущая версия вакансии не заменяет условия этой попытки.'
                  : 'Общий отклик в проект, без привязки к вакансии.'}
              </p>
            )}
          </details>
        );
      })}
    </section>
  );
}

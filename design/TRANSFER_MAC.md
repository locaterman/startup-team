# Дизайн: запуск на Mac и перенос в приложение

Финальная версия: `prototypes/src/final/`, точка входа `prototypes/final.html`.
Предыдущие варианты сохранены: `private.html` — Private Technology v2, `index.html` — исторические A/B/C.

## Запуск в Docker

Из корня репозитория на Mac с Docker Desktop:

```bash
docker compose -p startup_team_design -f design/compose.yaml up --build -d
```

Открыть http://localhost:8081 — финальный каталог; кабинет:
http://localhost:8081/final.html?screen=cabinet.

Остановить:

```bash
docker compose -p startup_team_design -f design/compose.yaml down
```

Для другого порта:

```bash
DESIGN_PORT=8082 docker compose -p startup_team_design -f design/compose.yaml up --build -d
```

Этот Compose независим от корневого приложения: не запускает API, БД и миграции, не использует его тома. Внешние пакеты нужны только при сборке; шрифты и эмблема находятся локально. Исторические страницы также входят в сборку.

## Без Docker

```bash
cd design/prototypes
npm ci
npm run dev
```

Открыть http://localhost:5174/final.html. Для проверки production bundle — `npm run build`.

## Что переносить в действующий frontend

- `src/final/main.tsx`: композиция каталога, кабинета и деталей. Состояния и команды здесь демонстрационные.
- `src/final/primitives.tsx`: вкладки, иконки и пустые состояния.
- `src/final/style.css`: самостоятельные стили и токены, без импорта прежних тем.
- `public/club-emblem.png`, `public/fonts/manrope.ttf`, соответствующая OFL и `public/legal/Untitled-UI-LICENSE.txt`.

`src/data.ts` содержит вымышленные данные. Прототип не подключён к серверу и сбрасывает состояние при перезагрузке. Для продуктовой интеграции нужно связать визуальные компоненты с существующим `frontend/src/api.ts`, сохранить настоящие разрешения, версии условий и доменные состояния. Не заменяйте рабочий frontend целиком этим демоприложением.

Корневые `compose.yaml`, `frontend/Dockerfile` и backend этим переносом не меняются. Docker-конфигурация подготовлена для независимого предпросмотра; фактический запуск контейнеров следует проверить на целевой машине, если Docker недоступен в среде подготовки коммита.

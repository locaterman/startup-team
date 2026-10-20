# Проверка Startup Team v0.3 на macOS

1. Установите **Docker Desktop for Mac** (версия для Apple Silicon или Intel по процессору Mac).
2. Запустите приложение **Docker Desktop** и дождитесь, пока Engine заработает.
3. Распакуйте архив, откройте **Терминал** в папке `startup-team-mvp-v0.3-macos`.
4. Выполните:

   ```bash
   bash tools/test_on_macos.sh
   ```

Скрипт строит образы API и React, запускает сервисы PostgreSQL/API/Nginx, ожидает `/healthz`, проверяет OpenAPI и запускает интеграционные тесты **только в новой временной базе** с уникальным именем `startup_test_*`. Временная база удаляется после выполнения даже при ошибке теста. База приложения `startup` сохраняется. Демо-сайт доступен **только на самом Mac** по адресу `http://127.0.0.1:8080` (либо порту `WEB_PORT` из `.env`).

При повторном запуске без пересборки:

```bash
bash tools/test_on_macos.sh --skip-build
```

Если порт 8080 занят, сначала поменяйте `WEB_PORT=8080` на `WEB_PORT=8081` в `.env`, затем повторите проверку.

Тестовые пользователи:

- `ivan@example.test` / `demo-ivan-123`
- `maria@example.test` / `demo-maria-123`
- `alex@example.test` / `demo-alex-123`

Диагностика при сбое:

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose logs --tail=100 web
```

Перед отправкой логов удалите секреты, если они попали в вывод. Чтобы остановить контейнеры, сохранив данные: `docker compose down`. **Не запускайте** `docker compose down -v`, если хотите сохранить данные.

Этот сценарий не был проверен на настоящем Mac из данной среды. Успех сборки и PostgreSQL-тестов подтверждается только фактическим выводом скрипта.

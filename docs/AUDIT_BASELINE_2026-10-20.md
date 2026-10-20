# Startup Team: исходное состояние для аудита

Дата: 20 октября 2026, Europe/Moscow. Это первичное исследование, не заключение о готовности.
Рабочая папка: `/Users/valeriykhashchenko/Downloads/startup-team-mvp-v0.3-macos`.
Изменения приложения не вносились. Добавлены только материалы аудита в `docs/`.

## Источники и границы доказательств

- Прочитаны мастер-промпт пользователя, актуальные backend/frontend, SQL, миграция, тесты, Docker-конфигурация, документация и генератор/проверка OpenAPI. Контракт дополнительно разобран структурным проверяющим скриптом.
- Оригинал `Тестовое задание_ AI-native разработчик.docx` не найден в проекте, вложениях и просмотренной части Downloads. **BLOCKED:** непосредственная сверка с оригиналом. До его получения все OFFICIAL REQUIREMENT ниже — требования, приписанные ТЗ в пользовательском пересказе, а не самостоятельно подтверждённые цитаты оригинала.
- В этой папке нет `.git`: `git status` сообщает `not a git repository`. Ветка, история, diff и публичный remote недоступны. Не создавался новый Git-репозиторий.
- Найден Compose-проект `startup_team_demo_macos`; `api`, `db`, `web` находились в состоянии `Paused`. Обычный `docker compose ps` без имени проекта показывал пустой список. Основные контейнеры не возобновлялись, не пересобирались, основная БД не мигрировалась.
- Старые README/status говорят о непроверенном PostgreSQL. Это исторические записи: ниже приведены результаты нового запуска актуальных исходников. Они не доказывают соответствие ранее собранного web-образа текущему frontend.

Классификация происхождения:

| Метка | Значение |
|---|---|
| OFFICIAL REQUIREMENT (O*) | Обязательное требование согласно пересказу; сверка с оригиналом заблокирована |
| ACCEPTED PRODUCT DECISION (A) | Явно согласованное пользователем расширение/правило |
| ENGINEERING PROPOSAL (E) | Выбранный технический механизм; его оптимальность не доказана |
| VERIFIED IMPLEMENTATION (V) | Только конкретное поведение с воспроизводимым доказательством |

`CONFIRMED` может означать факт исходного кода; это явно отличается от успешного исполняемого сценария. `INFERRED` — вывод, `ASSUMED` — предположение, `UNVERIFIED` — не проверено. Статус Partial включает наличие кода без полного пользовательского результата.

## Три архитектуры

**Продуктовая:** участник сообщества публикует потребность в людях, другой участник выражает интерес, автор фиксирует решение, кандидат видит результат. Глобального разделения людей на работодателей и кандидатов нет. Гипотеза о потерянной координации в Telegram не подтверждена пользовательским исследованием.

**Логическая:** User владеет Startup; Startup содержит Vacancy; постоянный Application объединяет последовательные ApplicationAttempt. Попытка связана с исторической VacancyVersion. Offer выражает предложение конкретному кандидату на конкретных условиях; только принятие создаёт StartupMember. RecruiterInvitation/RecruiterGrant независимы от членства. TestSubmission связан с TestAssignmentVersion и попыткой. События должны сохранять историю.

**Техническая:** монолит FastAPI, преимущественно SQLAlchemy Core и прямой параметризованный SQL, PostgreSQL 16, одна Alembic-ревизия, React 19/TypeScript/Vite, Nginx, Compose. Одна транзакция `engine.begin()` на зависимость `db`; критические операции сериализуются блокировкой строки стартапа. Реализованы обработчики 60 пар method/path; нет доказательства поведенческого соответствия всех операций контракту. UI существенно уже API.

Разделение Application/Attempt обосновано сохранением истории при сбросах; пока нет причины переписывать модель. Дублирование состояний Offer/Attempt требует проверки совместных переходов. Блокировка стартапа — разумный E для малого масштаба, но не доказательство отсутствия гонок. Уникальные индексы защищают часть инвариантов; сумма занятых/резервов обеспечивается сервисом, не отдельным SQL CHECK.

## Карта файлов и зависимостей

| Файл | Роль и связи |
|---|---|
| `backend/app/main.py` | Все API-обработчики, Pydantic-модели, бизнес-проверки, SQL, запись событий; 700 строк |
| `backend/app/security.py` | PBKDF2, session/CSRF, `lock_startup`, owner/recruiter-доступ |
| `backend/app/database.py` | Engine и транзакционная зависимость |
| `backend/app/seed.py` | Три демо-пользователя; выполняется при старте API |
| `db/001_initial.sql` | 16 таблиц, FK, частичные уникальные индексы, триггеры связности/неизменяемости |
| `backend/alembic/versions/0001_initial.py` | Читает текущий initial SQL; отдельной upgrade-ревизии нет |
| `contracts/openapi.yaml` | Целевой контракт: 60 операций, 43 схемы |
| `tools/generate_contract.py` | Генератор контракта; изменение YAML без синхронизации генератора потеряется |
| `tools/verify_contract.py` | Проверяет структуру и набор маршрутов, не бизнес-поведение |
| `frontend/src/App.tsx` | Весь UI: вход, каталог, создание, кабинет, решения, приглашения |
| `frontend/src/style.css` | Адаптивные правила; реальное мобильное поведение не проверено |
| `backend/tests/test_contract.py`, `test_review_contract.py` | Семь статических/локальных тестов |
| `backend/tests/test_integration_postgres.py` | Один последовательный API-сценарий, capacity, duplicate, один посторонний читатель |
| `backend/tests/test_db_integrity_postgres.py` | Один тест с несколькими отрицательными проверками межтабличных связей |
| `compose.yaml`, Dockerfiles, `frontend/nginx.conf` | БД → API с миграцией/seed → reverse proxy; постоянный том PostgreSQL; порт loopback |
| `tools/test_on_macos.sh` | Фиксирует имя Compose-проекта, создаёт временную тестовую БД, удаляет её |
| `docs/STATE_MACHINES.md` | Принятые правила, переходы, права; требует сверки с поведением |

Python-зависимости: FastAPI, Uvicorn, SQLAlchemy, psycopg, Pydantic, Alembic, sqlparse, email-validator, PyYAML, pytest, httpx. Frontend: React/ReactDOM, lucide-react, TypeScript/Vite. Зависимости заданы диапазонами; lockfile отсутствует. На хосте Python 3.13 без FastAPI, npm не найден; проверки выполнены в существующем Python 3.12 API-образе с актуальной папкой, смонтированной только для чтения. Сборка frontend заново не выполнялась.

## Выполненные проверки

| Проверка | Результат и предел доказательства |
|---|---|
| Семь статических тестов | **CONFIRMED / V: 7 passed**, без сети, актуальный код `/audit`, cache отключён |
| Проверка контракта `--compare` | **CONFIRMED / V:** 60 операций, 43 схемы, 440 ссылок; missing 0, extra 0 |
| Чистая миграция PostgreSQL 16 | **CONFIRMED / V:** initial migration выполнена в новом одноразовом контейнере, БД `startup_test_audit` |
| Два существующих PostgreSQL-теста | **CONFIRMED / V: 2 passed**; последовательный API-процесс и отрицательные связи. Не проверяют браузер/конкурентность |
| HTTP routing probe | **CONFIRMED / V:** `/offers/mine` → динамический route → 422; `/applications/mine` и `/recruiter-invitations/mine` → 200 с пустыми списками |
| Browser E2E, mobile, WebView | **UNVERIFIED**; основные контейнеры приостановлены, UI не запускался в этой проверке |
| Upgrade существующей БД, restart persistence | **UNVERIFIED**; основная БД не трогалась |

Для HTTP probe auth и DB подменены зависимостями: это доказательство маршрутизации, не реальной авторизации или работы запросов PostgreSQL. Для двух интеграционных тестов использовалась настоящая PostgreSQL, без SQLite. Существующий статический тест сам задаёт SQLite URL лишь для импорта приложения; доменные операции через SQLite не проверялись.

Повторение PostgreSQL-проверки из корня: `python3 docs/audit/run_isolated_postgres.py`. Использует уже имеющиеся локальные образы `startup_team_demo_macos-api` и `postgres:16-alpine`, без публикации портов, с БД в tmpfs. Удаляет только созданный им контейнер. Это повторение с текущими установленными зависимостями, не clean build из registry.

Routing probe: в окружении зависимостей `PYTHONPATH=backend python docs/audit/route_probe.py`. Файл фиксирует текущую ошибку, не заменяет будущий регрессионный тест требуемого результата 200.

## Матрица соответствия

Тесты сокращены: S — семь статических; P — `test_primary_scenario_and_capacity`; D — `test_cross_startup_and_person_links_cannot_be_corrupted`. Исходники подтверждают наличие механизма, не все его переходы.

| Requirement | Origin | Backend | Database | Frontend | Tests / Evidence | Status | Risk |
|---|---|---|---|---|---|---|---|
| Разные учётные записи | O* | login/auth/logout/csrf | users, sessions | Вход/выход | P: три клиента; S: hashing | Partial | Истечение/revoke/CSRF-атаки не покрыты полностью |
| Профиль | O* | public_user/update_me | users | Только имя/приветствие, нет формы профиля | Чтение кода | Partial | Профиль не представлен полноценно, null-валидация |
| Создать стартап/публикацию | O*, A | create_startup | startups.owner_id | Форма стартапа | P: 201 | Partial | Повтор команды создаёт новый объект |
| Вакансии внутри стартапа | O*, A | create_vacancy | vacancies, vacancy_versions | Форма вакансии | P: 201 | Partial | UI не проверен, несколько вакансий не тестировались |
| Лента и подробности | O* | list/get startup/vacancy | startups/vacancies/versions | Каталог, карточка стартапа, вакансии списком | Чтение + P создание | Partial | Нет отдельной карточки вакансии, ограничение 100 |
| Отправить отклик | O* | apply | applications/attempts, unique, FK | Кнопка и prompt | P: отклик на вакансию 201 | Partial | Общий отклик не исполнен тестом |
| Решение автора → результат кандидату | O* | received/review/reject/my_apps | attempts.status, events | Кабинет, кнопки | P: review/offer/join, не reject | Partial | Кабинет блокирует 422; причина отказа игнорируется |
| Собственные публикации и отклики | O* | my_apps; отдельного списка всех своих стартапов нет | ownership | Кабинет фильтрует публичную active-ленту | Probe 422, чтение UI | Partial | paused/archived и записи за 100 теряются из кабинета |
| Адаптивный desktop/mobile | O* | — | — | CSS breakpoints 900/650 | Только исходники | Unverified | Overflow, клавиатура, длинные тексты |
| Python/PostgreSQL/Compose | O* | FastAPI/Core | PostgreSQL 16 | Nginx | P/D + чистая миграция | Partial | Полная пересборка Compose не повторялась |
| Сохранение после перезапуска | O* | commit через engine.begin | Compose named volume | — | Нет restart-теста | Unverified | Том существует по конфигурации, runtime не проверен |
| Права доступа | O* | auth, owner_only, can_manage | Связи/independent grants | Часть кнопок по owner | P: чужое чтение 403/404; D | Partial | Не покрыта вся матрица ресурсов/ролей |
| Повторы, ошибки, пустые состояния | O* | guards, handlers | Unique indexes | empty states, error banner | P: duplicate 409 | Partial | Нет replay ключей; DB exceptions не унифицированы |
| Общие отклики и их настройка | A | apply/update_startup | nullable vacancy_id, partial unique | Создание/отклик есть, переключения после создания нет | Чтение | Partial | Полный сценарий не прогонялся |
| Дедлайн отдельно от рассмотрения | A | apply/restore/create_offer/settings | application_deadline / expires_at | Ввод дедлайна, показ | P: только будущая дата | Partial | Пограничные сроки/закрытый приём не проверены |
| Pause/archive/history | A | change_startup/vacancy_state | Статусы, FK, members.left_at | Управления состояниями нет | Чтение | Partial | Архив и сохранение членства не исполнены |
| Приглашения/резервы/согласие | A | create_offer/decide_offer/capacity | offers, startup_members, unique | Отправка, accept/decline есть | P: резерв → членство | Partial | Просрочка/отзыв/последнее место при гонке |
| Внешние рекрутеры/команда | A | invite/respond/revoke/leave/remove | invitations/grants/members | Экранов нет | D: часть связей | Partial | UI собирает входящие только владельцу |
| Тестовые и версии | A | create_test_version/submit_test/review_test | test versions/submissions, triggers | Экранов нет | S: schema; D: связи | Partial | Обновления/пересдачи/дедлайн не прогонялись |
| Версии вакансий/массовый сброс | A | new_version/resubmit | versions, attempts.is_current | Экранов нет | S/D косвенно, не процесс | Partial | Исторические сообщения недоступны через отдельный attempts read API |
| Повторное вступление после выхода | A | leave_team/resubmit | История membership/attempt/offer | Нет UI | Чтение | Unverified | joined разрешён, already_joined закрывает другие заявки |
| Полная история и уведомления | A | evt/history; notifications read | events/notifications | Нет UI | Чтение | Partial | Нет создания notifications; history не включает offer-события |
| Idempotency-Key / If-Match | E | Обработка отсутствует | Таблица keys и revision есть | Заголовки не отправляются | Чтение | Missing | Потеря обновления/retry commands |
| Cursor pagination | E, целевой API | next_cursor всегда null, параметры не принимаются | Нет cursor-запросов | Нет pagination | S проверяет лишь схемы | Missing | Часть списков обрезана, часть не ограничена |
| README/AI/время/публичная сдача | O* | — | — | — | README прочитан; .git отсутствует | Partial | Оригинал/личный пример/время/репозиторий отсутствуют |

Личный пример проверки AI и фактическое время остаются для заполнения пользователем. Их текст и значения не создавались.

## Известные дефекты и отдельные гипотезы

| ID | Тип / тяжесть | Доказательство и последствие | Направление и критерий исправления |
|---|---|---|---|
| F01 | Дефект реализации / BLOCKER, CONFIRMED HTTP | `main.py:339–343`: динамический offer route раньше mine; 422 с loc `offer_id`. `App.tsx:24` ожидает mine+offers в Promise.all и не устанавливает оба списка при отказе | Статический route раньше динамического или явный path converter; тест реального авторизованного GET mine → 200 и браузерный кабинет |
| F02 | Неполнота обязательного кабинета / MAJOR, CONFIRMED код | `loadCabinet`/`myStartups` строят собственные объекты из active публичной ленты, максимум 100; recruiter grants не учитываются | Отдельная корректная выборка управляемых/собственных объектов; тест paused/archive/рекрутер/более 100 |
| F03 | Контракт/реализация / MAJOR, CONFIRMED код | `items` всегда null; отсутствуют limit/cursor handlers. Наличие всех routes ничего не говорит о пагинации | Согласовать минимальный контракт, стабильный порядок + cursor, проверить две страницы без потерь |
| F04 | Контракт/инженерный механизм / MAJOR, CONFIRMED код | `Idempotency-Key`, `If-Match`, ETag не читаются/не применяются; таблица keys не используется. В OpenAPI optional key одновременно описан как required для части команд; If-Match не описан | Определить команды, enforce replay/conflict атомарно; stale revision и concurrent retries тесты |
| F05 | Расширенный scope / MAJOR, CONFIRMED код | Recruiter/team, versions/tests, смена состояний и настроек не имеют UI; приглашения accept/decline УЖЕ есть, поэтому их нельзя записывать как полностью отсутствующие | Доводить согласованные процессы после ядра, каждый с API+UI+negative tests |
| F06 | Миграции / MAJOR, CONFIRMED код | Единственная `0001_initial` читает изменяемый SQL; upgrade head не обновит уже помеченную этой ревизией БД | Зафиксировать initial и добавить incremental migration от реально установленной схемы; тест upgrade с данными |
| F07 | История/уведомления / MAJOR, CONFIRMED код | Нет INSERT notifications; `app_history` фильтрует только application events, offer events связаны с offer id; old attempt texts не возвращаются my_apps/get_app | Уточнить минимальную полноту истории, связать события/попытки, проверить чтение своих исторических условий и решений |
| F08 | Приватность / MAJOR, CONFIRMED код, runtime UNVERIFIED | `members` возвращает всем авторизованным исторические записи с left_at, тогда как STATE_MACHINES запрещает публичную private history | Публично только актуальные допустимые данные; закрытая история по правам; негативный HTTP-тест |
| F09 | Валидация/ошибки / MAJOR, CONFIRMED код, runtime UNVERIFIED | `UserUpdate.name` допускает null, затем `.strip()`; другие nullable update-поля идут в NOT NULL SQL. Не обработаны DB exceptions. `RejectBody.reason` принят, но не сохраняется | Проверять null/длины/constraints на границе, сохранять причину; тест HTTP-ответа и истории |
| F10 | Недостаток тестов / MAJOR, CONFIRMED | Всего два DB test functions, нет многопоточных/многосоединительных проверок, E2E, upgrade/restart и полной RBAC-матрицы | Приоритетные контрпримеры из плана независимого ревью |

Отдельно **UNVERIFIED / гипотезы**, а не доказанные нарушения инвариантов: принятие в момент expiry; одновременная потеря recruiter grant; возврат attempt после expiry/revoke на старой версии, которую ранее массово сбросили; повторный набор после already_joined и выхода; устаревший pending в offers_mine до вызова expire_offers. Требуют воспроизводимых PostgreSQL-сценариев и, где семантика не определена, продуктового решения.

Необязательные улучшения: декомпозиция main.py/App.tsx для читаемости, дизайн после UX-проверки, Telegram initData, рекомендации/ранжирование. Нет доказанной причины вводить микросервисы или менять Core на ORM. Lockfile и закрепление зависимостей полезны для воспроизводимости, но не исправят основной пользовательский дефект.

## Покрытие 20 инвариантов

Все механизмы ниже найдены в коде; отметка теста не означает полного покрытия инварианта.

| INV | Механизм backend / SQL | Исполненное доказательство / пробел |
|---|---|---|
| 01 Свой стартап | apply: owner guard | Отдельного negative test нет |
| 02 Дубли текущих | lock_startup, unique application/current attempt | P duplicate; concurrent нет |
| 03 Только свои команды кандидата | apply/act_on_app/resubmit actor guards | Чужие write-команды не покрыты |
| 04 Решения по полномочиям | can_manage под startup lock | Полная owner/recruiter матрица отсутствует |
| 05 Нет self-review | act_on_app/create_offer/review_test actor checks | Нет сценария recruiter-кандидата |
| 06 Не принять expired/revoked | expire_offers, pending/expiry guard | Границы времени/отзыв не проверены |
| 07 Лимит мест | capacity_locked, startup lock, vacancy_settings | P: один резерв/одно членство; нет гонок/уменьшения |
| 08 Одно pending | uq_pending_offer, expire перед insert | Нет конкурентного duplicate offer |
| 09 Согласие кандидата | accept проверяет candidate; членство создаётся там | P accept, D отвергает membership по pending |
| 10 Одно членство | uq_active_member, is_member | P: одно вступление; double accept нет |
| 11 Recruiter отдельно | grants отдельно members, can_manage не проверяет membership | D связи; role lifecycle нет |
| 12 Сброс сохраняет попытки | new_version UPDATE reset, resubmit inserts new | Процесс не покрыт |
| 13 Версия решения | explicit test_version_id, ensure_test_submission_binding | S схема, D неверная вакансия; race нет |
| 14 Условия приглашения | attempt version copied, offer binding + immutable keys | D несовместимые связи; версия+offer процесс нет |
| 15 Архив хранит историю | change_startup UPDATE, FK, members не удаляет | Archive runtime нет |
| 16 Закрытые данные | get_app/get_offer/visibility/events role guards | P одно чужое чтение; members F08 |
| 17 Общая принадлежность | composite FK + пять binding triggers + immutable keys | D отрицательные вставки/обновления, не исчерпывающе |
| 18 Конкурентность | engine.begin + общий FOR UPDATE, unique | Ни одного concurrent test |
| 19 История не переписывается | immutable versions/bindings; accepted offer terminal | D запрет revoke accepted; полная неизменяемость/доступность нет |
| 20 Серверные права | auth/owner_only/can_manage guards | P один negative read, остальные paths не аудированы исполнением |

## Порядок разработки после независимого ревью

1. Получить оригинальный docx, уточнить только реальные противоречия источников; зафиксировать исходную версию файлов.
2. Сопоставить независимые находки с воспроизведением. Минимальное исправление F01: порядок routes, регрессионный HTTP-тест, затем два пользователя через UI с отказом и положительным результатом. Перестановка маршрутов не требует изменений БД.
3. Закрыть права/ошибки/кабинет, затем транзакционные контрпримеры: последнее место, accept/revoke/archive/expiry, grant revoke, reset/resubmit и версия/apply. Каждое исправление с регрессией.
4. Снять фактическую схему существующей БД read-only, подготовить безопасную incremental migration, доказать upgrade с сохранением данных на копии. Основную БД не использовать для разрушительных тестов.
5. Синхронизировать фактический API, YAML и генератор: типы/ответы/валидация/errors/retries/revisions/pagination. Для каждой инженерной идеи определить минимальный нужный объём.
6. Завершить 12 согласованных групп по вертикальным сценариям; не сокращать scope молча. Сначала настройки/состояния/приглашения/команда, затем рекрутеры и версии/тестовые/история.
7. Чистая сборка Compose, desktop/mobile walkthrough, restart persistence; обновить README и фактические ограничения. Личный AI-пример и время заполняет пользователь. Коммиты/push/публикация — только по отдельному разрешению.

Критерий завершения: основной сценарий работает в браузере, нет известных мешающих сдаче BLOCKER/MAJOR, заявленные функции подтверждены, инварианты покрыты содержательными тестами, документация совпадает с поведением. Девять зелёных тестов сами по себе этим критерием не являются.

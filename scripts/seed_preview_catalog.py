#!/usr/bin/env python3
"""Seed 4 realistic startups and 8 published vacancies in the ISOLATED preview.

Usage on Debian (after fetching the integration branch):
    python3 scripts/seed_preview_catalog.py

Safety:
* HTTP requests only to http://127.0.0.1:18086 (never the 18080 app).
* No direct SQL, no deletes, no production auth, no database migrations.
* Uses the existing demo owner and genuine CSRF/idempotent API commands.
* Safe to rerun: exact project/vacancy titles are checked before inserts.
"""
from __future__ import annotations

import datetime as dt
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ORIGIN = "http://127.0.0.1:18086"
EMAIL = "ivan@example.test"
# Demo-only credentials, as shipped in backend/app/seed.py.
PASSWORD = os.environ.get("STARTUP_PREVIEW_DEMO_PASSWORD", "demo-ivan-123")
DEADLINE = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=75)).isoformat()

PROJECTS = [
    {
        "title": "[ДЕМО] Atlas AI",
        "description": (
            "ИИ-помощник для исследовательских команд: поиск в документах, "
            "подбор релевантных публикаций и краткие отчёты с проверяемыми источниками. "
            "Пилот для студенческих лабораторий и небольших научных групп."
        ),
        "allow_general_applications": True,
        "vacancies": [
            {
                "title": "Backend-разработчик (Python / FastAPI)",
                "description": (
                    "Разработка API для документов, очередей обработки и кабинета исследователя. "
                    "Интеграция с PostgreSQL и внешними ML-сервисами."
                ),
                "requirements": "Python, FastAPI, SQL, REST, базовые навыки Docker.",
                "positions_count": 2,
            },
            {
                "title": "ML-инженер (RAG / NLP)",
                "description": (
                    "Сборка RAG-конвейера, эксперименты с поиском и оценкой ответов, "
                    "подготовка тестового набора научных вопросов."
                ),
                "requirements": "Python, embeddings, retrieval, PyTorch или Transformers.",
                "positions_count": 2,
            },
        ],
    },
    {
        "title": "[ДЕМО] GreenTrack",
        "description": (
            "Сервис учёта экологического следа и потребления ресурсов в университетских "
            "корпусах. Графики, отчёты, соревнования факультетов по экономии энергии."
        ),
        "allow_general_applications": True,
        "vacancies": [
            {
                "title": "Frontend-разработчик (React / TypeScript)",
                "description": (
                    "Интерфейс с интерактивными графиками потребления, "
                    "сравнением периодов и адаптивным личным кабинетом."
                ),
                "requirements": "React, TypeScript, CSS, работа с REST API.",
                "positions_count": 3,
            },
            {
                "title": "Data Analyst (SQL / Python)",
                "description": (
                    "Анализ показаний счётчиков, поиск аномалий и расчёт метрик, "
                    "которые будут показываться пользователям."
                ),
                "requirements": "SQL, pandas, визуализация данных, статистика.",
                "positions_count": 1,
            },
        ],
    },
    {
        "title": "[ДЕМО] CampusFlow",
        "description": (
            "Платформа для организации студенческих мероприятий: афиша, регистрация, "
            "списки ожидания, проверка билетов и аналитика организаторов."
        ),
        "allow_general_applications": False,
        "vacancies": [
            {
                "title": "Fullstack-разработчик (Next.js)",
                "description": (
                    "Личные кабинеты, страницы событий, регистрация с ограничением мест, "
                    "интеграция платёжных и email-сервисов."
                ),
                "requirements": "React или Next.js, Node.js, PostgreSQL, Git.",
                "positions_count": 2,
            },
            {
                "title": "UX/UI-дизайнер",
                "description": (
                    "Проектирование пользовательских сценариев от поиска мероприятия "
                    "до получения билета, дизайн-система и мобильные экраны."
                ),
                "requirements": "Figma, прототипирование, продуктовый UX, UI-kit.",
                "positions_count": 1,
            },
        ],
    },
    {
        "title": "[ДЕМО] PulseBoard",
        "description": (
            "Панель анализа обратной связи пользователей и комментариев. "
            "Выявление тем, отслеживание изменений настроений и формирование "
            "практических рекомендаций для небольших команд."
        ),
        "allow_general_applications": True,
        "vacancies": [
            {
                "title": "Инженер данных (ETL / APIs)",
                "description": (
                    "Разработка устойчивых загрузчиков данных, нормализация событий "
                    "и построение воспроизводимого конвейера обработки."
                ),
                "requirements": "Python, HTTP API, PostgreSQL, очереди или cron.",
                "positions_count": 2,
            },
            {
                "title": "Product Analyst",
                "description": (
                    "Определение метрик качества рекомендаций, сегментация обратной "
                    "связи и дизайн проверяемых продуктовых экспериментов."
                ),
                "requirements": "SQL, Python, A/B-тесты, продуктовые метрики.",
                "positions_count": 2,
            },
        ],
    },
]


class Client:
    def __init__(self) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )
        self.csrf = ""

    def api(self, path: str, method: str = "GET", body: dict | None = None):
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("The API path must be local")
        url = ORIGIN + "/api/v1" + path
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if method not in ("GET", "HEAD") and path != "/auth/login":
            headers["X-CSRF-Token"] = self.csrf
            headers["Idempotency-Key"] = str(uuid.uuid4())
        payload = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        request = urllib.request.Request(
            url, method=method, headers=headers, data=payload
        )
        try:
            with self.opener.open(request, timeout=20) as response:
                data = response.read()
                result = json.loads(data) if data else None
                return response.status, result
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")[:400]
            raise RuntimeError(
                f"{method} {path} failed: HTTP {exc.code}: {details}"
            ) from exc

    def get(self, path: str) -> dict:
        status, result = self.api(path)
        if status != 200:
            raise RuntimeError(f"GET {path}: unexpected HTTP {status}")
        return result

    def create(self, path: str, body: dict) -> dict:
        status, result = self.api(path, method="POST", body=body)
        if status != 201:
            raise RuntimeError(f"POST {path}: unexpected HTTP {status}")
        return result


def main() -> None:
    if "--help" in sys.argv:
        print(__doc__)
        return
    if len(sys.argv) > 1:
        raise SystemExit("No arguments supported. Preview port 18086 is fixed.")
    # Never accept a custom URL pointing to another deployment.
    if urllib.parse.urlsplit(ORIGIN).netloc != "127.0.0.1:18086":
        raise RuntimeError("Unsafe target: only the isolated port 18086 is permitted")

    client = Client()
    status, user = client.api(
        "/auth/login", "POST", {"email": EMAIL, "password": PASSWORD}
    )
    if status != 200 or not user.get("id"):
        raise RuntimeError("Demo login on isolated preview failed")
    client.csrf = client.get("/auth/csrf")["csrf_token"]
    existing = {
        project["title"]: project
        for project in client.get("/startups?scope=managed&limit=100")["items"]
    }

    project_created = vacancy_created = 0
    for definition in PROJECTS:
        name = definition["title"]
        project = existing.get(name)
        if project is None:
            project = client.create(
                "/startups",
                {
                    "title": name,
                    "description": definition["description"],
                    "allow_general_applications": definition["allow_general_applications"],
                },
            )
            project_created += 1
            print(f"  + Project: {name}")
        else:
            if project["owner_id"] != user["id"]:
                raise RuntimeError(f"Project with same title belongs to another owner: {name}")
            if project["status"] != "active":
                raise RuntimeError(f"Existing project is not active: {name}")
            print(f"  = Existing project: {name}")

        path = f"/startups/{project['id']}/vacancies"
        vacancies = {v["title"] for v in client.get(path + "?limit=100")["items"]}
        for vacancy in definition["vacancies"]:
            if vacancy["title"] in vacancies:
                print(f"    = Existing role: {vacancy['title']}")
                continue
            created = client.create(
                path,
                {
                    **vacancy,
                    "application_deadline": DEADLINE,
                },
            )
            if created["status"] != "published":
                raise RuntimeError(f"Vacancy not published: {vacancy['title']}")
            vacancy_created += 1
            print(f"    + Vacancy: {vacancy['title']}")

    # Verify the public catalog used by the frontend.
    public = client.get("/startups?scope=public&limit=100")["items"]
    advertised = client.get("/vacancies?limit=100")["items"]
    missing_projects = [
        item["title"] for item in PROJECTS
        if not any(p["title"] == item["title"] for p in public)
    ]
    missing_roles = [
        (item["title"], vacancy["title"])
        for item in PROJECTS for vacancy in item["vacancies"]
        if not any(v["title"] == vacancy["title"] for v in advertised)
    ]
    if missing_projects or missing_roles:
        raise RuntimeError(
            f"Public catalog verification failed: {missing_projects=}, {missing_roles=}"
        )

    print()
    print("=== DEMO CATALOG READY ===")
    print(f"4 projects, 8 vacancies verified on {ORIGIN}.")
    print(f"Created on this run: {project_created} projects, {vacancy_created} vacancies.")
    print("Safe to rerun; no original projects were deleted or modified.")
    print("Refresh http://localhost:18086 (separate localhost cookie jar).")


if __name__ == "__main__":
    main()

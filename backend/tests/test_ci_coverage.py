"""Guard against excluding deployment and API contract changes from PR CI."""
from fnmatch import fnmatchcase
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_browser_ci_triggers_on_all_relevant_runtime_changes():
    workflow = yaml.safe_load(
        (ROOT / ".github/workflows/frontend-browser.yml").read_text(encoding="utf-8")
    )
    # YAML 1.1 parsers may interpret the GitHub Actions key 'on' as a boolean.
    events = workflow.get("on", workflow.get(True))
    patterns = events["pull_request"]["paths"]
    changed_paths = [
        "backend/app/main.py",
        "frontend/src/App.tsx",
        "compose.yaml",
        "compose.production.yaml",
        "deploy/compose.telegram-staging.yaml",
        "deploy/start-telegram-staging.sh",
        "contracts/openapi.yaml",
        "db/001_initial.sql",
        "scripts/seed_preview_catalog.py",
        "tools/test_on_linux.sh",
        ".github/workflows/frontend-integration.yml",
    ]
    for path in changed_paths:
        assert any(fnmatchcase(path, pattern) for pattern in patterns), path

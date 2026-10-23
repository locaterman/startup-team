#!/usr/bin/env python3
"""Fail if pull-request CI would silently miss changes to runtime/deployment files.

This runs against the actual checkout on the GitHub runner, not the stripped
backend Docker image, which intentionally excludes .github/workflows.
"""
from fnmatch import fnmatchcase
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/frontend-browser.yml"
WATCHED_FILES = (
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
)


def main() -> None:
    source = WORKFLOW.read_text(encoding="utf-8")
    block = re.search(
        r"(?m)^  pull_request:\s*\n    paths:\s*\n(?P<paths>(?:      - [^\n]+\n)+)",
        source,
    )
    if block is None:
        raise SystemExit("Expected pull_request.paths block is missing")
    patterns = [
        line.split("- ", 1)[1].strip().strip("'\"")
        for line in block.group("paths").splitlines()
    ]
    missing = [
        path for path in WATCHED_FILES
        if not any(fnmatchcase(path, pattern) for pattern in patterns)
    ]
    if missing:
        raise SystemExit(f"Browser CI skips relevant paths: {missing}")
    print(f"CI path coverage verified for {len(WATCHED_FILES)} runtime files")


if __name__ == "__main__":
    main()

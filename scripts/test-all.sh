#!/usr/bin/env bash
# Run the full local test suite.
#
# Prereqs:
#   - Docker running
#   - `supabase start` already up (for backend integration tests)
#   - backend/.venv created and deps installed (`pip install -e ".[dev]"`)
#   - frontend deps installed (`npm ci`)
#   - Playwright browsers installed (`cd frontend && npx playwright install chromium`)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

blue "→ Backend: ruff + mypy + pytest"
(
  cd "$ROOT/backend"
  # shellcheck source=/dev/null
  source .venv/bin/activate
  ruff check .
  mypy app
  pytest -q
)

blue "→ Frontend: lint + tsc + jest"
(
  cd "$ROOT/frontend"
  npm run lint
  npx tsc --noEmit
  npm test -- --silent
)

blue "→ Frontend: Playwright E2E"
(
  cd "$ROOT/frontend"
  npx playwright test --reporter=line
)

green "✓ All tests passed"

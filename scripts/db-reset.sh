#!/usr/bin/env bash
# db-reset.sh — drop the local Supabase DB, re-apply migrations and seed.
#
# Wraps `supabase db reset`, which:
#   1. Stops Postgres if running, drops the data volume, restarts.
#   2. Replays every file in supabase/migrations/ in lexicographic order.
#   3. Loads supabase/seed.sql (per supabase/config.toml [db.seed]).
#
# Prereq: `supabase start` has been run at least once for this project.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found. Install with: brew install supabase/tap/supabase" >&2
  exit 1
fi

exec supabase db reset "$@"

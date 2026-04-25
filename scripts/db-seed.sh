#!/usr/bin/env bash
# db-seed.sh — re-seed the local Supabase DB without dropping data.
#
# Today this is a thin wrapper over db-reset.sh because all of our seed
# logic lives in supabase/seed.sql which `supabase db reset` already
# applies. If you ever add custom seed logic that needs to run on top of
# existing data (e.g. via psql on the local Postgres at port 54322),
# this is the place to add it.
set -euo pipefail

cd "$(dirname "$0")/.."

exec ./scripts/db-reset.sh "$@"

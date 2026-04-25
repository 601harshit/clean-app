# Clean.

Know what you eat. An AI-powered food health scoring app that personalizes a 0-100 score for any product based on your health conditions (diabetes, cholesterol, hypertension, obesity), and surfaces healthier alternatives.

- Search or scan a barcode -> get a personalized score, full breakdown, and a Claude-generated body-impact summary
- Browse and filter by category, score tier, Nutri-Score, NOVA group, or condition safety
- Healthier alternatives with Amazon affiliate links
- Built on Open Food Facts data, Supabase auth/storage, Claude Haiku for explanations

## Phases

| Phase | Scope |
|-------|-------|
| 1 | Next.js 14 web app + FastAPI backend (in progress) |
| 2 | React Native mobile app, reuses the FastAPI backend unchanged |
| 3 | MCP server exposing the scoring service to AI agents |

## Tech Stack

- **Frontend**: Next.js 16 (App Router), Tailwind CSS, shadcn/ui, `@zxing/browser` for barcode decode
- **Backend**: FastAPI (Python 3.11+), pydantic v2, httpx
- **Database + Auth**: Supabase (PostgreSQL + GoTrue)
- **Food Data**: Open Food Facts API
- **LLM**: Anthropic Claude Haiku (`claude-haiku-4-5-20251001`)
- **Affiliate**: Amazon Product Advertising API v5
- **Hosting**: Vercel (frontend), Railway (backend)

## Repository layout

```
clean/
  frontend/   Next.js 16 web app
  backend/    FastAPI service
  mcp/        MCP server (Phase 3, deferred)
  docs/       Specs, design, and task breakdown
  supabase/   Local Supabase config + migrations (added in T0.4)
```

## Quickstart

### Prerequisites
- Node 20+
- Python 3.11+
- Docker Desktop (for local Supabase, added in a later task)
- Supabase CLI (`brew install supabase/tap/supabase`)

### Frontend
```bash
cd frontend
cp .env.example .env.local   # fill in NEXT_PUBLIC_* values
npm install
npm run dev                  # http://localhost:3000
```

### Backend
```bash
cd backend
cp .env.example .env         # fill in SUPABASE_* and ANTHROPIC_API_KEY
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload   # http://localhost:8000
```

`GET http://localhost:8000/health` should return `{"status": "ok"}`.

### Local Supabase
Will be added under task T0.4. The CLI starts Postgres + Auth + Studio in Docker.

## Docs

All living design documents live under [`docs/`](./docs):

- [`requirements.md`](./docs/requirements.md) - functional + non-functional requirements
- [`hld.md`](./docs/hld.md) - high-level architecture, data flows, phase boundaries
- [`lld.md`](./docs/lld.md) - DB schema, API contracts, scoring algorithm, module structure
- [`tasks.md`](./docs/tasks.md) - task breakdown and ownership table
- [`testing.md`](./docs/testing.md) - testing strategy, conventions, cassettes
- [`features/`](./docs/features) - per-feature specs (auth, search, scoring, alternatives, mcp)

Per-subproject conventions live in [`CLAUDE.md`](./CLAUDE.md), [`frontend/AGENTS.md`](./frontend/AGENTS.md), and similar files.

## License

MIT - see [LICENSE](./LICENSE).

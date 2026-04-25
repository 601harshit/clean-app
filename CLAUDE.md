# Clean. — AI Food Health Score App

## Project Overview
Clean. is a food health scoring app (like Yuka) that lets users scan or search food items to get a personalized health score based on their health conditions (diabetes, cholesterol, etc.) and see healthier alternatives with Amazon affiliate links.

## Phases
- Phase 1: Next.js web app (current)
- Phase 2: React Native mobile app (reuses backend 100%)
- Phase 3: MCP server for AI agent integrations

## Tech Stack
- **Frontend**: Next.js 14 (App Router), Tailwind CSS, shadcn/ui
- **Backend**: FastAPI (Python 3.11+)
- **Database + Auth**: Supabase (PostgreSQL + Auth)
- **Food Data**: Open Food Facts API
- **Barcode Scan (web)**: @zxing/browser
- **Affiliate**: Amazon Product Advertising API v5
- **MCP**: Python `mcp` SDK (Phase 3)
- **Hosting**: Vercel (frontend), Railway (backend)

## Project Structure
```
clean/
├── frontend/        # Next.js 14 web app
│   ├── app/         # App Router pages
│   ├── components/  # Reusable UI components
│   └── lib/         # API clients, utils
├── backend/         # FastAPI
│   └── app/
│       ├── api/     # Route handlers
│       ├── models/  # Pydantic models
│       ├── services/# Business logic (scoring, food lookup, affiliates)
│       └── core/    # Config, DB, auth
└── mcp/             # Phase 3 MCP server
```

## Commands

### Frontend
```bash
cd frontend
npm run dev        # Start dev server (port 3000)
npm run build      # Production build
npm run lint       # ESLint
```

### Backend
```bash
cd backend
python -m uvicorn app.main:app --reload   # Start dev server (port 8000)
pip install -r requirements.txt           # Install deps
pytest                                     # Run tests
```

## Code Conventions

### Frontend
- Use App Router (`app/` directory), never Pages Router
- Tailwind CSS for all styling — no inline styles
- shadcn/ui for UI components
- API calls go through `lib/api.ts` — never call backend directly from components
- Use `server components` by default; add `"use client"` only when needed

### Backend
- All routes in `app/api/` as separate routers
- Business logic in `app/services/` — keep routes thin
- Use Pydantic v2 models for all request/response types
- All env vars via `app/core/config.py` using pydantic-settings
- Never hardcode secrets

## Key APIs
- **Open Food Facts**: `https://world.openfoodfacts.org/api/v2/product/{barcode}.json`
- **Search**: `https://world.openfoodfacts.org/cgi/search.pl?search_terms={query}&json=true`
- **Supabase**: configured via SUPABASE_URL + SUPABASE_ANON_KEY env vars
- **Amazon PA API**: requires ACCESS_KEY, SECRET_KEY, PARTNER_TAG env vars

## Health Scoring Logic
- Base score from Nutri-Score + NOVA processing level (from Open Food Facts)
- Penalty/bonus modifiers per health condition:
  - Diabetes: penalize high sugar, high GI carbs
  - Cholesterol: penalize saturated fat, trans fat
  - Hypertension: penalize sodium
  - Obesity: penalize calories, low satiety foods
- Score: 0–100 (higher = healthier for the user)

## Environment Variables
See `.env.example` in each subfolder. Never commit `.env` files.

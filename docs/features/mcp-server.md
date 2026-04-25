# Feature Spec: MCP Server (Phase 3)

## Goal
Expose Clean.'s scoring capability as an MCP (Model Context Protocol) server so users can query food health scores directly from Claude, Cursor, or any MCP-compatible AI client — without opening the web app.

## User Stories
- As a developer using Claude Desktop, I can ask "What's the health score for Nutella?" and get a structured result via the Clean. MCP server.
- As a user, I can add Clean. as an MCP tool in my Claude/Cursor config and get food insights inline in my workflow.

## Scope
- Python MCP server using the `mcp` SDK
- Two tools: `score_by_barcode` and `search_and_score`
- Reuses `scoring_service.py` and `food_service.py` from the FastAPI backend directly (shared Python package)

## Out of Scope
- Auth/personalization in MCP (scores are generic, no user conditions)
- Amazon alternatives via MCP (Phase 3.1)

## MCP Tools

### `score_by_barcode`
Input: `{ "barcode": "3017620422003" }`
Output:
```json
{
  "name": "Nutella",
  "brand": "Ferrero",
  "score": 12,
  "score_label": "Avoid",
  "nutri_score": "E",
  "nova_group": 4,
  "score_breakdown": [
    { "factor": "Nutri-Score E", "impact": -25 },
    { "factor": "Ultra-processed (NOVA 4)", "impact": -20 }
  ]
}
```

### `search_and_score`
Input: `{ "query": "almond butter", "limit": 3 }`
Output:
```json
{
  "results": [
    { "barcode": "...", "name": "Justin's Almond Butter", "score": 74, "score_label": "Good" },
    { "barcode": "...", "name": "Whole Foods 365 Almond Butter", "score": 78, "score_label": "Good" }
  ]
}
```

## Acceptance Criteria
- [ ] MCP server runs locally via `python mcp/server.py`
- [ ] Both tools registered and respond correctly to MCP tool call protocol
- [ ] `score_by_barcode` returns correct score for a known barcode (e.g., Nutella = 3017620422003)
- [ ] `search_and_score` returns ranked results for a text query
- [ ] Server documented in `mcp/README.md` with Claude Desktop config snippet
- [ ] Works as a local MCP server (stdio transport)

## Implementation Notes
- MCP server is a separate entry point (`mcp/server.py`) but imports from `backend/app/services/`
- Use `sys.path` manipulation or make `backend/` a proper Python package with `pyproject.toml`
- Transport: `stdio` (standard for local MCP servers)
- No auth required (generic scores only)

### Claude Desktop config snippet (for README)
```json
{
  "mcpServers": {
    "clean": {
      "command": "python",
      "args": ["/path/to/clean/mcp/server.py"]
    }
  }
}
```

## Files to Create
- `mcp/server.py` — MCP server entry point
- `mcp/README.md` — setup + Claude Desktop config
- `mcp/requirements.txt` — `mcp`, shares backend deps

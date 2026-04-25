"""Tests for app.services.llm_service.

Strategy:

* Mock the Anthropic Messages API at the HTTP layer with respx (the SDK
  uses httpx underneath, so this catches every retry/transport path).
* Use synthetic Claude cassettes from tests/cassettes/claude/ as the
  response body — same shape Anthropic returns.
* Use a small in-process FakeSupabase that records reads, writes, and
  optionally raises on either, so we can drive cache hit / miss /
  write-failure paths deterministically.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from app.services import llm_service
from app.services.llm_service import (
    SYSTEM_PROMPT,
    _build_user_prompt,
    _extract_text,
    conditions_key,
    get_body_impact,
)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
CASSETTES = Path(__file__).resolve().parent.parent / "cassettes" / "claude"


def _load(name: str) -> dict[str, Any]:
    return json.loads((CASSETTES / f"{name}.json").read_text())


# ---------------------------------------------------------------------------
# FakeSupabase — minimal builder-style stand-in for the supabase client.
# ---------------------------------------------------------------------------


class _FakeQuery:
    def __init__(self, owner: _FakeTable):
        self._owner = owner
        self._eq: dict[str, Any] = {}

    def eq(self, col: str, val: Any) -> _FakeQuery:
        self._eq[col] = val
        return self

    def limit(self, _n: int) -> _FakeQuery:
        return self

    def execute(self) -> Any:
        if self._owner.read_should_raise:
            raise RuntimeError("read boom")

        rows = [
            r
            for r in self._owner.rows
            if all(r.get(k) == v for k, v in self._eq.items())
        ]

        class _Res:
            def __init__(self, data: list[dict[str, Any]]):
                self.data = data

        return _Res(rows)


class _FakeUpsert:
    def __init__(self, owner: _FakeTable, row: dict[str, Any]):
        self._owner = owner
        self._row = row

    def execute(self) -> Any:
        if self._owner.write_should_raise:
            raise RuntimeError("write boom")
        # Replace any matching row, else append. food_insights pk is
        # (barcode, conditions_key).
        keys = ("barcode", "conditions_key")
        for i, existing in enumerate(self._owner.rows):
            if all(existing.get(k) == self._row.get(k) for k in keys):
                self._owner.rows[i] = self._row
                break
        else:
            self._owner.rows.append(self._row)
        self._owner.upserts.append(self._row)

        class _Res:
            data: list[dict[str, Any]] = []

        return _Res()


class _FakeTable:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self.upserts: list[dict[str, Any]] = []
        self.read_should_raise = False
        self.write_should_raise = False

    def select(self, _cols: str) -> _FakeQuery:
        return _FakeQuery(self)

    def upsert(self, row: dict[str, Any]) -> _FakeUpsert:
        return _FakeUpsert(self, row)


class FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, _FakeTable] = {}

    def table(self, name: str) -> _FakeTable:
        return self.tables.setdefault(name, _FakeTable())


@pytest.fixture
def fake_supabase() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture
def nutella_product() -> dict[str, Any]:
    return {
        "barcode": "3017620422003",
        "name": "Nutella",
        "brand": "Nutella",
        "image_url": "https://example.com/nutella.png",
        "nutri_score": "E",
        "nova_group": 4,
        "nutrients": {
            "energy_kcal": 539.0,
            "fat": 30.9,
            "saturated_fat": 10.6,
            "carbohydrates": 57.5,
            "sugars": 56.3,
            "fiber": 3.0,
            "proteins": 6.3,
            "sodium": 0.0428,
        },
    }


@pytest.fixture
def yogurt_product() -> dict[str, Any]:
    return {
        "barcode": "0894700010014",
        "name": "Greek Yogurt Nonfat Plain",
        "brand": "Fage",
        "image_url": None,
        "nutri_score": "A",
        "nova_group": 1,
        "nutrients": {
            "energy_kcal": 57.0,
            "fat": 0.4,
            "saturated_fat": 0.1,
            "carbohydrates": 3.6,
            "sugars": 3.6,
            "fiber": 0.0,
            "proteins": 10.3,
            "sodium": 0.0367,
        },
    }


# ---------------------------------------------------------------------------
# conditions_key normalization
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, ""),
        ([], ""),
        (["diabetes"], "diabetes"),
        (["hypertension", "diabetes"], "diabetes,hypertension"),
        # Order-insensitive: any permutation collapses to the same key.
        (["diabetes", "hypertension"], "diabetes,hypertension"),
        (["DIABETES", "Hypertension"], "diabetes,hypertension"),
        # Duplicates collapse.
        (["diabetes", "diabetes", "diabetes"], "diabetes"),
        # Invalid conditions are dropped.
        (["bogus"], ""),
        (["diabetes", "bogus"], "diabetes"),
        # Mixed-case + dupes + invalids all in one.
        (
            ["Diabetes", "diabetes", "OBESITY", "made-up", "cholesterol"],
            "cholesterol,diabetes,obesity",
        ),
        # All four valid conditions.
        (
            ["obesity", "hypertension", "diabetes", "cholesterol"],
            "cholesterol,diabetes,hypertension,obesity",
        ),
    ],
)
def test_conditions_key_normalization(raw: list[str] | None, expected: str) -> None:
    assert conditions_key(raw) == expected


def test_conditions_key_ignores_non_strings() -> None:
    # Defensive: garbage list elements are filtered, not crashed on.
    assert conditions_key(["diabetes", 123, None, {"x": 1}]) == "diabetes"  # type: ignore[list-item]


# ---------------------------------------------------------------------------
# _build_user_prompt
# ---------------------------------------------------------------------------


class TestBuildUserPrompt:
    def test_includes_product_and_conditions(
        self, nutella_product: dict[str, Any]
    ) -> None:
        prompt = _build_user_prompt(nutella_product, ["diabetes", "cholesterol"])
        assert "Nutella" in prompt
        assert "Nutri-Score: E" in prompt
        assert "NOVA group: 4" in prompt
        assert "diabetes" in prompt and "cholesterol" in prompt

    def test_guest_says_no_conditions(self, yogurt_product: dict[str, Any]) -> None:
        prompt = _build_user_prompt(yogurt_product, [])
        assert "no specific conditions" in prompt
        assert "Greek Yogurt Nonfat Plain" in prompt

    def test_handles_missing_optional_fields(self) -> None:
        prompt = _build_user_prompt(
            {"name": None, "brand": None, "nutrients": {}}, []
        )
        assert "Unknown product" in prompt
        assert "Nutri-Score: unknown" in prompt
        assert "NOVA group: unknown" in prompt
        # Missing nutrients render as '?', not as a crash.
        assert "?" in prompt


# ---------------------------------------------------------------------------
# _extract_text — parser robustness
# ---------------------------------------------------------------------------


class TestExtractText:
    def test_extracts_text_from_dict_blocks(self) -> None:
        class R:
            content = [{"type": "text", "text": "hello"}]

        assert _extract_text(R()) == "hello"

    def test_concatenates_multiple_text_blocks(self) -> None:
        class R:
            content = [
                {"type": "text", "text": "one "},
                {"type": "text", "text": "two"},
            ]

        assert _extract_text(R()) == "one two"

    def test_skips_non_text_blocks(self) -> None:
        class R:
            content = [
                {"type": "tool_use", "name": "x"},
                {"type": "text", "text": "real"},
            ]

        assert _extract_text(R()) == "real"

    def test_returns_none_for_empty_content(self) -> None:
        class R:
            content: list[Any] = []

        assert _extract_text(R()) is None

    def test_returns_none_when_content_missing(self) -> None:
        class R:
            pass

        assert _extract_text(R()) is None

    def test_returns_none_for_whitespace_only(self) -> None:
        class R:
            content = [{"type": "text", "text": "   "}]

        assert _extract_text(R()) is None


# ---------------------------------------------------------------------------
# get_body_impact — happy / sad / edge
# ---------------------------------------------------------------------------


class TestGetBodyImpactCacheHit:
    @pytest.mark.asyncio
    async def test_cache_hit_skips_anthropic(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        fake_supabase.tables["food_insights"] = _FakeTable()
        fake_supabase.tables["food_insights"].rows.append(
            {
                "barcode": "3017620422003",
                "conditions_key": "cholesterol,diabetes",
                "message": "cached summary",
            }
        )
        with respx.mock(base_url="https://api.anthropic.com") as router:
            # Any anthropic call here would be a route miss → respx raises.
            result = await get_body_impact(
                nutella_product,
                ["diabetes", "cholesterol"],
                fake_supabase,  # type: ignore[arg-type]
            )
            assert not router.calls

        assert result == "cached summary"
        # No new row inserted on a hit.
        assert fake_supabase.tables["food_insights"].upserts == []

    @pytest.mark.asyncio
    async def test_cache_hit_guest_uses_empty_key(
        self, fake_supabase: FakeSupabase, yogurt_product: dict[str, Any]
    ) -> None:
        fake_supabase.tables["food_insights"] = _FakeTable()
        fake_supabase.tables["food_insights"].rows.append(
            {
                "barcode": "0894700010014",
                "conditions_key": "",
                "message": "guest cached",
            }
        )
        with respx.mock(base_url="https://api.anthropic.com"):
            result = await get_body_impact(
                yogurt_product, None, fake_supabase  # type: ignore[arg-type]
            )

        assert result == "guest cached"


class TestGetBodyImpactCacheMiss:
    @pytest.mark.asyncio
    async def test_cache_miss_calls_claude_and_caches(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        cassette = _load("body_impact_nutella_diabetes")
        expected_text = cassette["content"][0]["text"]

        with respx.mock() as router:
            route = router.post(ANTHROPIC_URL).mock(
                return_value=httpx.Response(200, json=cassette)
            )

            result = await get_body_impact(
                nutella_product,
                ["diabetes", "cholesterol"],
                fake_supabase,  # type: ignore[arg-type]
            )

        assert result == expected_text
        # Exactly one Anthropic call.
        assert route.call_count == 1

        # Row written with the normalized key.
        upserts = fake_supabase.tables["food_insights"].upserts
        assert len(upserts) == 1
        assert upserts[0]["barcode"] == "3017620422003"
        assert upserts[0]["conditions_key"] == "cholesterol,diabetes"
        assert upserts[0]["message"] == expected_text

    @pytest.mark.asyncio
    async def test_request_payload_uses_haiku_and_cached_system(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        cassette = _load("body_impact_nutella_diabetes")
        captured: dict[str, Any] = {}

        def _resp(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json=cassette)

        with respx.mock() as router:
            router.post(ANTHROPIC_URL).mock(side_effect=_resp)
            await get_body_impact(
                nutella_product,
                ["diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )

        body = captured["body"]
        assert body["model"] == llm_service.CLAUDE_MODEL
        assert body["model"] == "claude-haiku-4-5-20251001"
        # System is a list of text blocks with cache_control set on the
        # stable prefix so we get prompt-cache reads.
        system = body["system"]
        assert isinstance(system, list)
        assert system[0]["type"] == "text"
        assert system[0]["text"] == SYSTEM_PROMPT
        assert system[0]["cache_control"] == {"type": "ephemeral"}
        # User message carries the dynamic context.
        assert body["messages"][0]["role"] == "user"
        assert "Nutella" in body["messages"][0]["content"]

    @pytest.mark.asyncio
    async def test_two_consecutive_lookups_make_one_claude_call(
        self, fake_supabase: FakeSupabase, yogurt_product: dict[str, Any]
    ) -> None:
        cassette = _load("body_impact_yogurt_guest")

        with respx.mock() as router:
            route = router.post(ANTHROPIC_URL).mock(
                return_value=httpx.Response(200, json=cassette)
            )

            r1 = await get_body_impact(
                yogurt_product, [], fake_supabase  # type: ignore[arg-type]
            )
            r2 = await get_body_impact(
                yogurt_product, [], fake_supabase  # type: ignore[arg-type]
            )

        assert r1 == r2
        assert r1 is not None
        assert route.call_count == 1
        # Only one row inserted across both calls.
        assert len(fake_supabase.tables["food_insights"].upserts) == 1

    @pytest.mark.asyncio
    async def test_conditions_order_insensitive_cache(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        cassette = _load("body_impact_nutella_diabetes")

        with respx.mock() as router:
            route = router.post(ANTHROPIC_URL).mock(
                return_value=httpx.Response(200, json=cassette)
            )
            # First request seeds the cache under "cholesterol,diabetes".
            await get_body_impact(
                nutella_product,
                ["diabetes", "cholesterol"],
                fake_supabase,  # type: ignore[arg-type]
            )
            # Second request uses the SAME conditions in the OPPOSITE order;
            # must hit the same cache row, not call Claude again.
            await get_body_impact(
                nutella_product,
                ["cholesterol", "diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )

        assert route.call_count == 1


class TestGetBodyImpactFailureModes:
    @pytest.mark.asyncio
    async def test_anthropic_5xx_returns_none_no_row(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        with respx.mock() as router:
            router.post(ANTHROPIC_URL).mock(
                return_value=httpx.Response(500, json={"error": "boom"})
            )
            result = await get_body_impact(
                nutella_product,
                ["diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )

        assert result is None
        # No cache write on failure — we don't want to poison the cache
        # with a permanent miss.
        upserts = fake_supabase.tables.get("food_insights")
        assert upserts is None or upserts.upserts == []

    @pytest.mark.asyncio
    async def test_anthropic_network_error_returns_none(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        with respx.mock() as router:
            router.post(ANTHROPIC_URL).mock(
                side_effect=httpx.ConnectError("network down")
            )
            result = await get_body_impact(
                nutella_product,
                ["diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )
        assert result is None

    @pytest.mark.asyncio
    async def test_malformed_response_returns_none(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        # Response that the Anthropic SDK will reject during parsing.
        with respx.mock() as router:
            router.post(ANTHROPIC_URL).mock(
                return_value=httpx.Response(
                    200, json={"id": "msg_x", "totally": "wrong shape"}
                )
            )
            result = await get_body_impact(
                nutella_product,
                ["diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_text_blocks_returns_none(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        # Valid envelope, but no text blocks.
        empty: dict[str, Any] = {
            "id": "msg_empty",
            "type": "message",
            "role": "assistant",
            "model": llm_service.CLAUDE_MODEL,
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "content": [],
            "usage": {
                "input_tokens": 1,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            },
        }
        with respx.mock() as router:
            router.post(ANTHROPIC_URL).mock(return_value=httpx.Response(200, json=empty))
            result = await get_body_impact(
                nutella_product,
                ["diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )
        assert result is None
        # No row inserted.
        upserts = fake_supabase.tables.get("food_insights")
        assert upserts is None or upserts.upserts == []

    @pytest.mark.asyncio
    async def test_cache_read_failure_falls_through_to_claude(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        # Simulate a Supabase read error (DB hiccup) — should NOT crash;
        # should fall back to calling Claude as if it were a miss.
        fake_supabase.tables["food_insights"] = _FakeTable()
        fake_supabase.tables["food_insights"].read_should_raise = True

        cassette = _load("body_impact_nutella_diabetes")

        with respx.mock() as router:
            router.post(ANTHROPIC_URL).mock(
                return_value=httpx.Response(200, json=cassette)
            )
            result = await get_body_impact(
                nutella_product,
                ["diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )

        assert result == cassette["content"][0]["text"]

    @pytest.mark.asyncio
    async def test_cache_write_failure_still_returns_summary(
        self, fake_supabase: FakeSupabase, nutella_product: dict[str, Any]
    ) -> None:
        # Read works (returns []) but write fails — caller still gets the
        # generated summary; cache write failure is logged and swallowed.
        fake_supabase.tables["food_insights"] = _FakeTable()
        fake_supabase.tables["food_insights"].write_should_raise = True

        cassette = _load("body_impact_nutella_diabetes")
        with respx.mock() as router:
            router.post(ANTHROPIC_URL).mock(
                return_value=httpx.Response(200, json=cassette)
            )
            result = await get_body_impact(
                nutella_product,
                ["diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )

        assert result == cassette["content"][0]["text"]


class TestGetBodyImpactGuards:
    @pytest.mark.asyncio
    async def test_missing_barcode_returns_none(
        self, fake_supabase: FakeSupabase
    ) -> None:
        # No barcode → no stable cache key → don't bother calling Claude.
        with respx.mock(base_url="https://api.anthropic.com") as router:
            result = await get_body_impact(
                {"name": "x", "nutrients": {}},
                ["diabetes"],
                fake_supabase,  # type: ignore[arg-type]
            )
            assert not router.calls
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_string_barcode_returns_none(
        self, fake_supabase: FakeSupabase
    ) -> None:
        with respx.mock(base_url="https://api.anthropic.com"):
            result = await get_body_impact(
                {"barcode": "", "name": "x", "nutrients": {}},
                None,
                fake_supabase,  # type: ignore[arg-type]
            )
        assert result is None

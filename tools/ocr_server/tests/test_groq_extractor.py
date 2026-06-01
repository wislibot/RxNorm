from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.groq_extractor import _strip_markdown_fences, extract_fields_with_groq


class TestStripMarkdownFences:
    def test_strips_json_fence(self):
        raw = '```json\n{"patientName": "Test"}\n```'
        assert _strip_markdown_fences(raw) == '{"patientName": "Test"}'

    def test_strips_plain_fence(self):
        raw = '```\n{"patientName": "Test"}\n```'
        assert _strip_markdown_fences(raw) == '{"patientName": "Test"}'

    def test_no_fence_passthrough(self):
        raw = '{"patientName": "Test"}'
        assert _strip_markdown_fences(raw) == '{"patientName": "Test"}'

    def test_handles_leading_trailing_whitespace(self):
        raw = '\n\n```json\n{"patientName": "Test"}\n```\n\n'
        assert _strip_markdown_fences(raw) == '{"patientName": "Test"}'


VALID_OCR_TEXT = """姓名：王小花 女
領藥號：15432
藥名 Trajenta DUO 2.5 & 850mg/膜衣錠 (Linagliptin & Metformin)
總量 28粒
用法 每天兩次，早晚飯後使用，每次1粒，共14天。
用途 治療第二型糖尿病"""

VALID_JSON_RESPONSE = {
    "patientName": "王小花",
    "patientSex": "F",
    "prescriptionNo": "15432",
    "medicationName": "Trajenta DUO 2.5 & 850mg/膜衣錠 (Linagliptin & Metformin)",
    "quantity": "28粒",
    "directions": "每天兩次，早晚飯後使用，每次1粒，共14天。",
    "indications": "治療第二型糖尿病",
    "warnings": None,
    "sideEffects": None,
    "appearance": None,
    "pharmacyName": None,
    "pharmacyAddress": None,
    "pharmacistName": None,
    "physicianName": None,
    "dispensingDate": None,
    "useBefore": None,
    "other": [],
}


class TestExtractFieldsWithGroq:
    @pytest.fixture(autouse=True)
    def setup_env(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "test-api-key")

    @pytest.fixture
    def mock_response(self):
        choice = MagicMock()
        choice.message.content = json.dumps(VALID_JSON_RESPONSE)
        completion = MagicMock()
        completion.choices = [choice]
        return completion

    @pytest.mark.asyncio
    async def test_returns_dict_with_all_16_keys_on_valid_ocr_text(self, mock_response):
        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is not None
        assert len(result) == 17
        assert result["patientName"] == "王小花"
        assert result["patientSex"] == "F"
        assert result["prescriptionNo"] == "15432"
        assert result["medicationName"] == "Trajenta DUO 2.5 & 850mg/膜衣錠 (Linagliptin & Metformin)"
        assert result["quantity"] == "28粒"
        assert result["directions"] == "每天兩次，早晚飯後使用，每次1粒，共14天。"
        assert result["indications"] == "治療第二型糖尿病"
        assert result["warnings"] is None

    @pytest.mark.asyncio
    async def test_returns_none_on_groq_api_error(self):
        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(
                side_effect=Exception("API error")
            )
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_malformed_json_response(self):
        choice = MagicMock()
        choice.message.content = "this is not json at all"
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is None

    @pytest.mark.asyncio
    async def test_json_fence_stripping_works(self):
        choice = MagicMock()
        choice.message.content = (
            '```json\n' + json.dumps(VALID_JSON_RESPONSE) + '\n```'
        )
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is not None
        assert result["patientName"] == "王小花"
        assert result["patientSex"] == "F"

    @pytest.mark.asyncio
    async def test_layout_preserves_column_pairing_for_physician_pharmacist(self):
        """Layout input: physician=left column, pharmacist=right column."""
        layout_input = (
            "處方醫師 王○○ | 調劑藥師 林○○\n"
            "Physiciam | Pharmacist"
        )
        response_data = {
            "patientName": "王小花",
            "patientSex": "F",
            "prescriptionNo": None,
            "medicationName": None,
            "quantity": None,
            "directions": None,
            "indications": None,
            "warnings": "開封後僅能存放3個月",
            "sideEffects": None,
            "appearance": None,
            "pharmacyName": None,
            "pharmacyAddress": None,
            "pharmacistName": "林○○",
            "physicianName": "王○○",
            "dispensingDate": None,
            "useBefore": None,
            "other": ["請依照指示使用，如有任何問題，請與醫療人員討論"],
        }
        choice = MagicMock()
        choice.message.content = json.dumps(response_data)
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(layout_input)

        assert result is not None
        assert result["physicianName"] == "王○○"
        assert result["pharmacistName"] == "林○○"
        assert result["warnings"] == "開封後僅能存放3個月"
        assert any("請依照指示使用" in item for item in result["other"])

    @pytest.mark.asyncio
    async def test_other_field_captures_unassigned_text(self):
        """Unassigned centered text lands in other, not in warnings."""
        layout_input = (
            "警語與注意事項 開封後僅能存放3個月\n"
            "請依照指示使用，如有任何問題，請與醫療人員討論"
        )
        response_data = {
            "patientName": None,
            "patientSex": None,
            "prescriptionNo": None,
            "medicationName": None,
            "quantity": None,
            "directions": None,
            "indications": None,
            "warnings": "開封後僅能存放3個月",
            "sideEffects": None,
            "appearance": None,
            "pharmacyName": None,
            "pharmacyAddress": None,
            "pharmacistName": None,
            "physicianName": None,
            "dispensingDate": None,
            "useBefore": None,
            "other": ["請依照指示使用，如有任何問題，請與醫療人員討論"],
        }
        choice = MagicMock()
        choice.message.content = json.dumps(response_data)
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(layout_input)

        assert result is not None
        assert result["warnings"] == "開封後僅能存放3個月"
        assert len(result["other"]) == 1
        assert "請依照指示使用" in result["other"][0]

    @pytest.mark.asyncio
    async def test_strips_unclosed_think_tag(self):
        choice = MagicMock()
        choice.message.content = (
            '<think> Okay, let me extract the fields from this OCR text.'
            'The patientName is "王小花" and the sex is F.'
            ' {"patientName": "王小花",'
            '"patientSex":"F",'
            '"prescriptionNo":null,'
            '"medicationName":null,'
            '"quantity":null,'
            '"directions":null,'
            '"indications":null,'
            '"warnings":null,'
            '"sideEffects":null,'
            '"appearance":null,'
            '"pharmacyName":null,'
            '"pharmacyAddress":null,'
            '"pharmacistName":null,'
            '"physicianName":null,'
            '"dispensingDate":null,'
            '"useBefore":null,'
            '"other":[]}'
        )
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is not None
        assert result["patientName"] == "王小花"
        assert result["patientSex"] == "F"

    @pytest.mark.asyncio
    async def test_quantity_is_pack_count_not_strength(self):
        """Fix 2: quantity must be a pack count (1盒), not a strength (60puff/bot)."""
        response_data = {
            "patientName": None,
            "patientSex": None,
            "prescriptionNo": None,
            "medicationName": "Spiriva Respimat 2.5mcg/puff, 60puff/bot(tiotropium)",
            "quantity": "1盒",
            "directions": None,
            "indications": None,
            "warnings": None,
            "sideEffects": None,
            "appearance": None,
            "pharmacyName": None,
            "pharmacyAddress": None,
            "pharmacistName": None,
            "physicianName": None,
            "dispensingDate": None,
            "useBefore": None,
            "other": [],
        }
        choice = MagicMock()
        choice.message.content = json.dumps(response_data)
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is not None
        assert result["quantity"] == "1盒"
        assert "60puff/bot" not in (result["quantity"] or "")

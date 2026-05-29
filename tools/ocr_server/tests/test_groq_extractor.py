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
        assert len(result) == 16
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

    @pytest.mark.asyncio
    async def test_returns_none_when_api_key_not_set(self, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)

        result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_empty_text(self):
        result = await extract_fields_with_groq("")

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_whitespace_only_text(self):
        result = await extract_fields_with_groq("   \n  \n  ")

        assert result is None

    @pytest.mark.asyncio
    async def test_handles_timeout(self):
        import asyncio

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(
                side_effect=asyncio.TimeoutError()
            )
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is None

    @pytest.mark.asyncio
    async def test_newline_sanitization_strips_literal_newlines_in_values(self):
        choice = MagicMock()
        choice.message.content = (
            '{"patientName": "Line1\nLine2\nLine3",'
            '"patientSex":null,'
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
            '"useBefore":null}'
        )
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is not None
        assert result["patientName"] == "Line1 Line2 Line3"

    @pytest.mark.asyncio
    async def test_newline_sanitization_strips_carriage_returns(self):
        choice = MagicMock()
        choice.message.content = (
            '{"patientName": "Test\r\nValue",'
            '"patientSex":null,'
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
            '"useBefore":null}'
        )
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is not None
        assert result["patientName"] == "Test Value"

    @pytest.mark.asyncio
    async def test_physician_and_pharmacist_separated_correctly(self):
        response_data = {
            "patientName": "王小花",
            "patientSex": "F",
            "prescriptionNo": None,
            "medicationName": None,
            "quantity": None,
            "directions": None,
            "indications": None,
            "warnings": None,
            "sideEffects": None,
            "appearance": None,
            "pharmacyName": None,
            "pharmacyAddress": None,
            "pharmacistName": "胡慈慈",
            "physicianName": "黃華陀",
            "dispensingDate": None,
            "useBefore": None,
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
        assert result["pharmacistName"] == "胡慈慈"
        assert result["physicianName"] == "黃華陀"

    @pytest.mark.asyncio
    async def test_newline_sanitization_handles_multiline_warnings(self):
        choice = MagicMock()
        choice.message.content = (
            '{"patientName":null,'
            '"patientSex":null,'
            '"prescriptionNo":null,'
            '"medicationName":null,'
            '"quantity":null,'
            '"directions":null,'
            '"indications":null,'
            '"warnings":"Do not take with alcohol.\nConsult doctor if pregnant.\nAvoid sunlight.",'
            '"sideEffects":null,'
            '"appearance":null,'
            '"pharmacyName":null,'
            '"pharmacyAddress":null,'
            '"pharmacistName":null,'
            '"physicianName":null,'
            '"dispensingDate":null,'
            '"useBefore":null}'
        )
        completion = MagicMock()
        completion.choices = [choice]

        with patch("app.groq_extractor.AsyncGroq") as mock_client_class:
            mock_client = MagicMock()
            mock_client.chat.completions.create = AsyncMock(return_value=completion)
            mock_client_class.return_value = mock_client

            result = await extract_fields_with_groq(VALID_OCR_TEXT)

        assert result is not None
        assert "Do not take with alcohol." in result["warnings"]
        assert "Consult doctor if pregnant." in result["warnings"]
        assert "Avoid sunlight." in result["warnings"]
        assert "\n" not in result["warnings"]

    @pytest.mark.asyncio
    async def test_strips_think_tags_before_json_parsing(self):
        choice = MagicMock()
        choice.message.content = (
            '<think> Okay, let me extract the fields from this OCR text... </think>'
            '{"patientName": "王小花",'
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
            '"useBefore":null}'
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
            '"useBefore":null}'
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

from datetime import date
from decimal import Decimal
from pathlib import Path


def test_normalize_text_strips_punctuation_and_collapses_whitespace() -> None:
    from etl.utils import normalize_text

    assert normalize_text("  Acetaminophen (500mg)  ") == "ACETAMINOPHEN 500MG"


def test_parse_decimal_returns_decimal_for_numeric_text() -> None:
    from etl.utils import parse_decimal

    assert parse_decimal("1,234.50") == Decimal("1234.50")
    assert parse_decimal("-") is None


def test_parse_date_supports_multiple_formats() -> None:
    from etl.utils import parse_date

    assert parse_date("2026-05-13") == date(2026, 5, 13)
    assert parse_date("20260513") == date(2026, 5, 13)
    assert parse_date("900401") == date(2001, 4, 1)
    assert parse_date("1130101") == date(2024, 1, 1)


def test_extract_tfda_permit_no_reads_query_and_path_forms() -> None:
    from etl.utils import extract_tfda_permit_no

    assert extract_tfda_permit_no("https://example.com/?permitNo=衛署藥製字第012345號") == "衛署藥製字第012345號"
    assert extract_tfda_permit_no("https://example.com/licenses/衛署藥製字第012345號") == "衛署藥製字第012345號"
    assert extract_tfda_permit_no("https://example.com/?licId=01000015") == "01000015"


def test_split_tfda_ingredients_preserves_original_segments() -> None:
    from etl.utils import split_tfda_ingredients

    assert split_tfda_ingredients("Aspirin ;; Caffeine ;;") == ["Aspirin", "Caffeine"]


def test_open_delimited_rows_supports_csv_and_txt(tmp_path: Path) -> None:
    from etl.utils import open_delimited_rows

    csv_file = tmp_path / "sample.csv"
    txt_file = tmp_path / "sample.TXT"
    csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
    txt_file.write_text("c|d\n3|4\n", encoding="utf-8")

    csv_rows = list(open_delimited_rows(csv_file))
    txt_rows = list(open_delimited_rows(txt_file, delimiter="|"))

    assert csv_rows == [{"a": "1", "b": "2"}]
    assert txt_rows == [{"c": "3", "d": "4"}]


def test_build_import_batch_payload_includes_metadata() -> None:
    from etl.utils import build_import_batch_payload

    payload = build_import_batch_payload(source_name="nhi_items", row_count=3, source_version="2026-05")

    assert payload["source_name"] == "nhi_items"
    assert payload["row_count"] == 3
    assert payload["source_version"] == "2026-05"
    assert payload["imported_at"]

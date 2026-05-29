from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path


def test_build_qc_report_computes_coverage_and_examples() -> None:
    from etl.qc_report import build_qc_report

    dataset = {
        "rx_qc_all1_code_set": [
            {"nhi_code": "A0001"},
            {"nhi_code": "Z9999"},
        ],
        "rx_drug_products": [
            {"nhi_code": "A0001", "atc_code": "N02BE01"},
            {"nhi_code": "B0001", "atc_code": "N02BA71"},
            {"nhi_code": "C0001", "atc_code": None},
        ],
        "rx_product_ingredients": [
            {"nhi_code": "A0001", "ingredient_id": "ing-1", "source": "nhi"},
            {"nhi_code": "B0001", "ingredient_id": "ing-2", "source": "nhi"},
        ],
        "rx_nhi_tfda_map": [
            {"nhi_code": "A0001", "tfda_permit_no": "111"},
        ],
        "rx_atc_reference_latest": [
            {"atc_code": "N02BE01", "atc_name": "PARACETAMOL", "snapshot_date": date(2026, 1, 1)},
        ],
        "rx_review_queue": [
            {
                "source": "tfda_mismatch",
                "nhi_code": "B0001",
                "tfda_permit_no": "222",
                "input_text": "Aspirin + Caffeine",
                "ocr_text": "Aspirin",
                "confidence": Decimal("0.50"),
                "status": "pending",
                "review_notes": "Mismatch",
            }
        ],
        "alias_usage_counts": {"ETHYLPHENYLEPHRINE": 2, "DIPYRONE": 1},
    }

    report = build_qc_report(dataset, mismatch_limit=5)

    assert report["summary"]["nhi_product_count"] == 3
    assert report["summary"]["ingredient_coverage_count"] == 2
    assert report["summary"]["ingredient_coverage_pct"] == "66.67%"
    assert report["summary"]["tfda_join_coverage_pct"] == "33.33%"
    assert report["summary"]["atc_presence_pct"] == "66.67%"
    assert report["summary"]["atc_join_coverage_pct"] == "33.33%"
    assert report["summary"]["nhi_distinct_codes"] == 3
    assert report["summary"]["all1_distinct_codes"] == 2
    assert report["summary"]["overlap_distinct_codes"] == 1
    assert report["summary"]["all1_only_distinct_codes"] == 1
    assert report["summary"]["all1_overlap_count"] == 1
    assert report["summary"]["all1_overlap_pct"] == "33.33%"
    assert len(report["top_tfda_mismatches"]) == 1
    assert report["top_tfda_mismatches"][0]["nhi_code"] == "B0001"
    assert report["summary"]["alias_usage_total"] == 3
    assert report["alias_usage_counts"]["ETHYLPHENYLEPHRINE"] == 2


def test_build_qc_report_all1_debug_fields_explain_100_percent_overlap() -> None:
    from etl.qc_report import build_qc_report

    dataset = {
        "rx_qc_all1_code_set": [
            {"nhi_code": "A0001"},
            {"nhi_code": "B0001"},
            {"nhi_code": "C0001"},
            {"nhi_code": "Z9999"},
        ],
        "rx_drug_products": [
            {"nhi_code": "A0001", "atc_code": "N02BE01"},
            {"nhi_code": "B0001", "atc_code": "N02BA71"},
            {"nhi_code": "C0001", "atc_code": None},
        ],
        "rx_product_ingredients": [],
        "rx_nhi_tfda_map": [],
        "rx_atc_reference_latest": [],
        "rx_review_queue": [],
    }

    report = build_qc_report(dataset, mismatch_limit=5)

    assert report["summary"]["nhi_distinct_codes"] == 3
    assert report["summary"]["all1_distinct_codes"] == 4
    assert report["summary"]["overlap_distinct_codes"] == 3
    assert report["summary"]["all1_only_distinct_codes"] == 1
    assert report["summary"]["all1_overlap_pct"] == "100.00%"


def test_write_qc_outputs_emits_markdown_and_csv(tmp_path: Path) -> None:
    from etl.qc_report import write_qc_outputs

    report = {
        "summary": {
            "nhi_product_count": 2,
            "ingredient_coverage_count": 1,
            "ingredient_coverage_pct": "50.00%",
            "tfda_join_coverage_count": 1,
            "tfda_join_coverage_pct": "50.00%",
            "atc_presence_count": 1,
            "atc_presence_pct": "50.00%",
            "atc_join_coverage_count": 1,
            "atc_join_coverage_pct": "50.00%",
            "nhi_distinct_codes": 2,
            "all1_distinct_codes": 3,
            "overlap_distinct_codes": 1,
            "all1_only_distinct_codes": 2,
            "all1_overlap_count": 1,
            "all1_overlap_pct": "50.00%",
            "review_queue_count": 1,
            "alias_usage_total": 3,
        },
        "top_tfda_mismatches": [
            {
                "nhi_code": "B0001",
                "tfda_permit_no": "222",
                "input_text": "Aspirin + Caffeine",
                "ocr_text": "Aspirin",
                "confidence": "0.50",
                "status": "pending",
                "review_notes": "Mismatch",
            }
        ],
        "alias_usage_counts": {
            "ETHYLPHENYLEPHRINE": 2,
            "DIPYRONE": 1,
        },
    }

    outputs = write_qc_outputs(report, output_dir=tmp_path)

    markdown_text = outputs["markdown"].read_text(encoding="utf-8")
    csv_text = outputs["csv"].read_text(encoding="utf-8")
    top200_text = outputs["csv_top200"].read_text(encoding="utf-8")

    assert outputs["markdown"].name == "qc_report.md"
    assert outputs["csv"].name == "qc_mismatch_examples.csv"
    assert outputs["csv_top200"].name == "qc_mismatch_top200.csv"
    assert "# QC Report" in markdown_text
    assert "ingredient_coverage_pct" in markdown_text
    assert "nhi_distinct_codes" in markdown_text
    assert "all1_distinct_codes" in markdown_text
    assert "alias_usage_total" in markdown_text
    assert "ETHYLPHENYLEPHRINE" in markdown_text
    assert "nhi_code,tfda_permit_no,input_text,ocr_text,confidence,status,review_notes" in csv_text
    assert "B0001,222" in csv_text
    assert "B0001,222" in top200_text

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any


def build_qc_report(
    dataset: dict[str, list[dict[str, Any]]],
    *,
    mismatch_limit: int = 10,
    mismatch_export_limit: int = 200,
) -> dict[str, Any]:
    curated_products = dataset.get("rx_drug_products", [])
    curated_codes = {row.get("nhi_code") for row in curated_products if row.get("nhi_code")}
    ingredient_codes = {row.get("nhi_code") for row in dataset.get("rx_product_ingredients", []) if row.get("nhi_code")}
    tfda_map_codes = {row.get("nhi_code") for row in dataset.get("rx_nhi_tfda_map", []) if row.get("nhi_code")}
    atc_present_codes = {
        row.get("nhi_code")
        for row in curated_products
        if row.get("nhi_code") and row.get("atc_code")
    }
    latest_atc_codes = {row.get("atc_code") for row in dataset.get("rx_atc_reference_latest", []) if row.get("atc_code")}
    atc_join_codes = {
        row.get("nhi_code")
        for row in curated_products
        if row.get("nhi_code") and row.get("atc_code") in latest_atc_codes
    }
    all1_codes = {row.get("nhi_code") for row in dataset.get("rx_qc_all1_code_set", []) if row.get("nhi_code")}
    overlap_codes = curated_codes & all1_codes
    all1_only_codes = all1_codes - curated_codes
    review_queue = dataset.get("rx_review_queue", [])
    tfda_mismatches = [row for row in review_queue if row.get("source") == "tfda_mismatch"][:mismatch_limit]
    tfda_mismatch_export = [row for row in review_queue if row.get("source") == "tfda_mismatch"][:mismatch_export_limit]
    alias_usage_counts = dataset.get("alias_usage_counts", {})

    total_products = len(curated_codes)

    summary = {
        "nhi_product_count": total_products,
        "ingredient_coverage_count": len(ingredient_codes & curated_codes),
        "ingredient_coverage_pct": _format_pct(len(ingredient_codes & curated_codes), total_products),
        "tfda_join_coverage_count": len(tfda_map_codes & curated_codes),
        "tfda_join_coverage_pct": _format_pct(len(tfda_map_codes & curated_codes), total_products),
        "atc_presence_count": len(atc_present_codes),
        "atc_presence_pct": _format_pct(len(atc_present_codes), total_products),
        "atc_join_coverage_count": len(atc_join_codes),
        "atc_join_coverage_pct": _format_pct(len(atc_join_codes), total_products),
        "nhi_distinct_codes": len(curated_codes),
        "all1_distinct_codes": len(all1_codes),
        "overlap_distinct_codes": len(overlap_codes),
        "all1_only_distinct_codes": len(all1_only_codes),
        "all1_overlap_count": len(overlap_codes),
        "all1_overlap_pct": _format_pct(len(overlap_codes), total_products),
        "review_queue_count": len(review_queue),
        "alias_usage_total": sum(int(value) for value in alias_usage_counts.values()),
    }

    mismatch_rows = [
        {
            "nhi_code": row.get("nhi_code"),
            "tfda_permit_no": row.get("tfda_permit_no"),
            "input_text": row.get("input_text"),
            "ocr_text": row.get("ocr_text"),
            "confidence": str(row.get("confidence")),
            "status": row.get("status"),
            "review_notes": row.get("review_notes"),
        }
        for row in tfda_mismatches
    ]
    mismatch_export_rows = [
        {
            "nhi_code": row.get("nhi_code"),
            "tfda_permit_no": row.get("tfda_permit_no"),
            "input_text": row.get("input_text"),
            "ocr_text": row.get("ocr_text"),
            "confidence": str(row.get("confidence")),
            "status": row.get("status"),
            "review_notes": row.get("review_notes"),
        }
        for row in tfda_mismatch_export
    ]

    return {
        "summary": summary,
        "top_tfda_mismatches": mismatch_rows,
        "tfda_mismatch_export": mismatch_export_rows,
        "alias_usage_counts": dict(sorted(alias_usage_counts.items())),
    }


def write_qc_outputs(report: dict[str, Any], *, output_dir: Path | str) -> dict[str, Path]:
    resolved_dir = Path(output_dir)
    resolved_dir.mkdir(parents=True, exist_ok=True)

    markdown_path = resolved_dir / "qc_report.md"
    csv_path = resolved_dir / "qc_mismatch_examples.csv"
    csv_top200_path = resolved_dir / "qc_mismatch_top200.csv"

    markdown_lines = ["# QC Report", "", "## Summary", ""]
    for key, value in report["summary"].items():
        markdown_lines.append(f"- `{key}`: {value}")

    markdown_lines.extend(["", "## Alias Usage", ""])
    if report.get("alias_usage_counts"):
        for key, value in report["alias_usage_counts"].items():
            markdown_lines.append(f"- `{key}`: {value}")
    else:
        markdown_lines.append("- No alias remaps applied.")

    markdown_lines.extend(["", "## Top TFDA Mismatch Examples", ""])
    if report["top_tfda_mismatches"]:
        for row in report["top_tfda_mismatches"]:
            markdown_lines.append(
                f"- `nhi_code={row['nhi_code']}` `tfda_permit_no={row['tfda_permit_no']}` "
                f"`confidence={row['confidence']}` `status={row['status']}`"
            )
            markdown_lines.append(f"  input: {row['input_text']}")
            markdown_lines.append(f"  tfda: {row['ocr_text']}")
    else:
        markdown_lines.append("- No TFDA mismatch review items found.")

    markdown_path.write_text("\n".join(markdown_lines) + "\n", encoding="utf-8")

    fieldnames = ["nhi_code", "tfda_permit_no", "input_text", "ocr_text", "confidence", "status", "review_notes"]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(report["top_tfda_mismatches"])

    with csv_top200_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(report.get("tfda_mismatch_export", report["top_tfda_mismatches"]))

    return {"markdown": markdown_path, "csv": csv_path, "csv_top200": csv_top200_path}


def _format_pct(numerator: int, denominator: int) -> str:
    if denominator <= 0:
        return "0.00%"
    return f"{(numerator / denominator) * 100:.2f}%"

from __future__ import annotations

import argparse
import csv
import json
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Callable

from .config import load_settings
from .db import connect_database
from .utils import open_delimited_rows, normalize_text

SEVERITY_PRIORITY = {
    "minor": 1,
    "moderate": 2,
    "major": 3,
}


class DdiImportRepository:
    def __init__(self, connection) -> None:
        self.connection = connection

    def fetch_existing_name_map(self) -> dict[str, dict[str, object]]:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select
                    ddinter_drug_name,
                    ddinter_ids,
                    occurrences_in_pairs,
                    ingredient_id::text as ingredient_id,
                    match_method,
                    notes
                from public.rx_ddi_name_map
                """
            )
            rows = cursor.fetchall()
            column_names = [column.name if hasattr(column, "name") else column[0] for column in cursor.description]
        return {
            str(row_dict["ddinter_drug_name"]): row_dict
            for row_dict in (dict(zip(column_names, row, strict=False)) for row in rows)
        }

    def fetch_canonical_matches(self, normalized_names: set[str]) -> dict[str, list[str]]:
        if not normalized_names:
            return {}
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select canonical_name_normalized, ingredient_id::text as ingredient_id
                from public.rx_ingredient_concepts
                where canonical_name_normalized = any(%s)
                """,
                (list(normalized_names),),
            )
            rows = cursor.fetchall()
        matches: dict[str, list[str]] = {name: [] for name in normalized_names}
        for normalized_name, ingredient_id in rows:
            matches[str(normalized_name)].append(str(ingredient_id))
        return matches

    def fetch_alias_matches(self, normalized_names: set[str]) -> dict[str, list[str]]:
        if not normalized_names:
            return {}
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select normalized_text, target_id::text as ingredient_id
                from public.rx_name_variants
                where target_type = 'ingredient'
                  and normalized_text = any(%s)
                """,
                (list(normalized_names),),
            )
            rows = cursor.fetchall()
        matches: dict[str, list[str]] = {name: [] for name in normalized_names}
        for normalized_text, ingredient_id in rows:
            matches[str(normalized_text)].append(str(ingredient_id))
        return matches

    def fetch_existing_pairs(self, source: str) -> dict[tuple[str, str, str], dict[str, object]]:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select
                    ingredient_a_id::text as ingredient_a_id,
                    ingredient_b_id::text as ingredient_b_id,
                    severity,
                    source,
                    source_detail,
                    raw_rows_merged
                from public.rx_ddi_pairs
                where source = %s
                """,
                (source,),
            )
            rows = cursor.fetchall()
            column_names = [column.name if hasattr(column, "name") else column[0] for column in cursor.description]
        result: dict[tuple[str, str, str], dict[str, object]] = {}
        for row in rows:
            row_dict = dict(zip(column_names, row, strict=False))
            key = (
                str(row_dict["ingredient_a_id"]),
                str(row_dict["ingredient_b_id"]),
                str(row_dict["source"]),
            )
            result[key] = row_dict
        return result

    def upsert_name_map_rows(self, rows: list[dict[str, object]]) -> None:
        if not rows:
            return
        sql = """
            insert into public.rx_ddi_name_map (
                ddinter_drug_name,
                ddinter_ids,
                occurrences_in_pairs,
                ingredient_id,
                match_method,
                notes
            )
            values (%s, %s, %s, %s, %s, %s)
            on conflict (ddinter_drug_name) do update
            set
                ddinter_ids = excluded.ddinter_ids,
                occurrences_in_pairs = excluded.occurrences_in_pairs,
                ingredient_id = excluded.ingredient_id,
                match_method = excluded.match_method,
                notes = excluded.notes,
                updated_at = timezone('utc', now())
        """
        params = [
            (
                row["ddinter_drug_name"],
                row["ddinter_ids"],
                row["occurrences_in_pairs"],
                row["ingredient_id"],
                row["match_method"],
                row["notes"],
            )
            for row in rows
        ]
        with self.connection.cursor() as cursor:
            cursor.executemany(sql, params)

    def upsert_pair_rows(self, rows: list[dict[str, object]]) -> None:
        if not rows:
            return
        sql = """
            insert into public.rx_ddi_pairs (
                ingredient_a_id,
                ingredient_b_id,
                severity,
                source,
                source_detail,
                raw_rows_merged
            )
            values (%s, %s, %s, %s, %s, %s)
            on conflict (ingredient_a_id, ingredient_b_id, source) do update
            set
                severity = excluded.severity,
                source_detail = excluded.source_detail,
                raw_rows_merged = excluded.raw_rows_merged
        """
        params = [
            (
                row["ingredient_a_id"],
                row["ingredient_b_id"],
                row["severity"],
                row["source"],
                row["source_detail"],
                row["raw_rows_merged"],
            )
            for row in rows
        ]
        with self.connection.cursor() as cursor:
            cursor.executemany(sql, params)


def normalize_ddinter_name(value: str | None) -> str:
    return normalize_text(value)


def normalize_severity(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized not in SEVERITY_PRIORITY:
        raise ValueError(f"Unsupported DDInter severity: {value}")
    return normalized


def _choose_ingredient_id(
    normalized_name: str,
    canonical_matches: dict[str, list[str]],
    alias_matches: dict[str, list[str]],
) -> tuple[str | None, str]:
    canonical_candidates = sorted(set(canonical_matches.get(normalized_name, [])))
    if len(canonical_candidates) == 1:
        return canonical_candidates[0], "exact_canonical"
    if len(canonical_candidates) > 1:
        return None, "unmapped"

    alias_candidates = sorted(set(alias_matches.get(normalized_name, [])))
    if len(alias_candidates) == 1:
        return alias_candidates[0], "exact_alias"
    return None, "unmapped"


def _normalize_source_detail(value: str | None) -> str | None:
    if not value:
        return None
    parts = sorted({part.strip() for part in value.split(";") if part.strip()})
    return ";".join(parts) if parts else None


def _merge_source_detail(current: str | None, incoming: str | None) -> str | None:
    values: set[str] = set()
    for candidate in (current, incoming):
        if not candidate:
            continue
        values.update(part.strip() for part in candidate.split(";") if part.strip())
    if not values:
        return None
    return ";".join(sorted(values))


def _merge_pair_row(current: dict[str, object] | None, incoming: dict[str, object]) -> dict[str, object]:
    if current is None:
        return dict(incoming)

    current_severity = str(current["severity"])
    incoming_severity = str(incoming["severity"])
    merged = dict(current)
    merged["severity"] = (
        incoming_severity
        if SEVERITY_PRIORITY[incoming_severity] > SEVERITY_PRIORITY[current_severity]
        else current_severity
    )
    merged["source_detail"] = _merge_source_detail(
        current.get("source_detail"),
        incoming.get("source_detail"),
    )
    merged["raw_rows_merged"] = int(current.get("raw_rows_merged") or 0) + int(incoming.get("raw_rows_merged") or 0)
    return merged


def _parse_int(value: object) -> int | None:
    if value is None:
        return None
    candidate = str(value).strip()
    if not candidate:
        return None
    return int(candidate)


def _build_casefold_lookup(row: dict[str, object]) -> dict[str, object]:
    return {str(key).casefold(): value for key, value in row.items()}


def _get_row_value(row: dict[str, object], *column_names: str) -> object | None:
    if not row:
        return None
    lookup = _build_casefold_lookup(row)
    for column_name in column_names:
        if column_name.casefold() in lookup:
            return lookup[column_name.casefold()]
    return None


def _format_pct(numerator: int, denominator: int) -> str:
    if denominator <= 0:
        return "0.00%"
    return f"{(numerator / denominator) * 100:.2f}%"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _build_mapping_summary_markdown(summary: dict[str, Any]) -> str:
    lines = [
        "# DDI Mapping Summary",
        "",
        "## Overview",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| `ddinter_unique_names` | {summary['ddinter_unique_names']} |",
        f"| `mapped_names` | {summary['mapped_names']} |",
        f"| `mapped_pct` | {summary['mapped_pct']} |",
        "",
        "## Top Unmapped Names",
        "",
    ]
    if summary["top_unmapped_names"]:
        lines.extend(
            [
                "| DDInter Drug Name | Occurrences In Pairs | DDInter IDs |",
                "| --- | ---: | --- |",
            ]
        )
        for row in summary["top_unmapped_names"]:
            lines.append(
                f"| {row['ddinter_drug_name']} | {row['occurrences_in_pairs']} | {row['ddinter_ids'] or ''} |"
            )
    else:
        lines.append("No unmapped DDInter names found.")
    return "\n".join(lines) + "\n"


def _build_pairs_summary_markdown(summary: dict[str, Any]) -> str:
    by_severity = summary["by_severity"]
    lines = [
        "# DDI Pairs Summary",
        "",
        "## Overview",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| `pairs_total_in_file` | {summary['pairs_total_in_file']} |",
        f"| `pairs_inserted_mapped` | {summary['pairs_inserted_mapped']} |",
        "",
        "## Severity Counts",
        "",
        "| Severity | Count |",
        "| --- | ---: |",
        f"| `major` | {by_severity['major']} |",
        f"| `moderate` | {by_severity['moderate']} |",
        f"| `minor` | {by_severity['minor']} |",
    ]
    return "\n".join(lines) + "\n"


def _write_ddi_qc_outputs(
    *,
    output_dir: Path | str,
    mapping_summary: dict[str, Any],
    pairs_summary: dict[str, Any],
) -> dict[str, Path]:
    resolved_dir = Path(output_dir)
    resolved_dir.mkdir(parents=True, exist_ok=True)

    mapping_json_path = resolved_dir / "ddi_mapping_summary.json"
    mapping_md_path = resolved_dir / "ddi_mapping_summary.md"
    pairs_json_path = resolved_dir / "ddi_pairs_summary.json"
    pairs_md_path = resolved_dir / "ddi_pairs_summary.md"
    unmapped_csv_path = resolved_dir / "unmapped_names_top100.csv"

    _write_json(mapping_json_path, mapping_summary)
    mapping_md_path.write_text(_build_mapping_summary_markdown(mapping_summary), encoding="utf-8")
    _write_json(pairs_json_path, pairs_summary)
    pairs_md_path.write_text(_build_pairs_summary_markdown(pairs_summary), encoding="utf-8")
    _write_csv(
        unmapped_csv_path,
        ["ddinter_drug_name", "occurrences_in_pairs", "ddinter_ids"],
        [
            {
                "ddinter_drug_name": row["ddinter_drug_name"],
                "occurrences_in_pairs": row["occurrences_in_pairs"],
                "ddinter_ids": row["ddinter_ids"],
            }
            for row in mapping_summary["top_unmapped_names"]
        ],
    )

    return {
        "mapping_json": mapping_json_path,
        "mapping_markdown": mapping_md_path,
        "pairs_json": pairs_json_path,
        "pairs_markdown": pairs_md_path,
        "unmapped_csv": unmapped_csv_path,
    }


def import_ddinter(
    repository,
    *,
    names_path: Path | str,
    pairs_path: Path | str,
    force: bool = False,
    output_dir: Path | str | None = None,
) -> dict[str, Any]:
    name_rows = list(open_delimited_rows(names_path))
    existing_name_map = repository.fetch_existing_name_map()
    normalized_names = {
        normalize_ddinter_name(_get_row_value(row, "drug_name", "Drug_Name"))
        for row in name_rows
        if _get_row_value(row, "drug_name", "Drug_Name")
    }
    canonical_matches = repository.fetch_canonical_matches(normalized_names)
    alias_matches = repository.fetch_alias_matches(normalized_names)

    name_map_rows: list[dict[str, object]] = []
    effective_name_map: dict[str, dict[str, object]] = {}
    for row in name_rows:
        ddinter_drug_name = str(_get_row_value(row, "drug_name", "Drug_Name") or "").strip()
        existing_row = existing_name_map.get(ddinter_drug_name, {})
        ingredient_id: str | None
        match_method: str

        if (
            not force
            and str(existing_row.get("match_method") or "") == "manual"
            and existing_row.get("ingredient_id")
        ):
            ingredient_id = str(existing_row["ingredient_id"])
            match_method = "manual"
        else:
            ingredient_id, match_method = _choose_ingredient_id(
                normalize_ddinter_name(ddinter_drug_name),
                canonical_matches,
                alias_matches,
            )

        name_map_row = {
            "ddinter_drug_name": ddinter_drug_name,
            "ddinter_ids": str(_get_row_value(row, "ddinter_ids", "DDInter_IDs") or "").strip() or None,
            "occurrences_in_pairs": _parse_int(_get_row_value(row, "occurrences_in_pairs", "Occurrences_In_Pairs")),
            "ingredient_id": ingredient_id,
            "match_method": match_method,
            "notes": existing_row.get("notes"),
        }
        name_map_rows.append(name_map_row)
        effective_name_map[ddinter_drug_name] = name_map_row

    repository.upsert_name_map_rows(name_map_rows)

    source = "ddinter"
    existing_pairs = (
        repository.fetch_existing_pairs(source)
        if hasattr(repository, "fetch_existing_pairs")
        else {}
    )
    merged_pairs = {key: dict(value) for key, value in existing_pairs.items()}
    imported_pairs: dict[tuple[str, str, str], dict[str, object]] = {}
    loaded_pair_rows = 0
    pairs_total_in_file = 0

    for row in open_delimited_rows(pairs_path):
        pairs_total_in_file += 1
        ingredient_a = effective_name_map.get(
            str(_get_row_value(row, "drug_a", "Drug_A") or "").strip(),
            {},
        ).get("ingredient_id")
        ingredient_b = effective_name_map.get(
            str(_get_row_value(row, "drug_b", "Drug_B") or "").strip(),
            {},
        ).get("ingredient_id")
        if not ingredient_a or not ingredient_b:
            continue

        ingredient_a_id = str(ingredient_a)
        ingredient_b_id = str(ingredient_b)
        if ingredient_a_id == ingredient_b_id:
            continue
        if ingredient_b_id < ingredient_a_id:
            ingredient_a_id, ingredient_b_id = ingredient_b_id, ingredient_a_id

        key = (ingredient_a_id, ingredient_b_id, source)
        incoming_pair_row = {
            "ingredient_a_id": ingredient_a_id,
            "ingredient_b_id": ingredient_b_id,
            "severity": normalize_severity(_get_row_value(row, "severity", "Level")),
            "source": source,
            "source_detail": _normalize_source_detail(
                str(_get_row_value(row, "sources", "Sources") or "").strip() or None
            ),
            "raw_rows_merged": _parse_int(_get_row_value(row, "raw_rows_merged", "Raw_Rows_Merged")) or 0,
        }
        imported_pairs[key] = _merge_pair_row(imported_pairs.get(key), incoming_pair_row)
        merged_pairs[key] = _merge_pair_row(
            merged_pairs.get(key),
            incoming_pair_row,
        )
        loaded_pair_rows += 1

    pair_rows = [
        merged_pairs[key]
        for key in sorted(merged_pairs)
    ]
    repository.upsert_pair_rows(pair_rows)
    top_unmapped_names = sorted(
        [
            {
                "ddinter_drug_name": str(row["ddinter_drug_name"]),
                "occurrences_in_pairs": int(row["occurrences_in_pairs"] or 0),
                "ddinter_ids": row["ddinter_ids"],
            }
            for row in name_map_rows
            if not row.get("ingredient_id")
        ],
        key=lambda item: (-int(item["occurrences_in_pairs"]), str(item["ddinter_drug_name"]).casefold()),
    )[:100]
    mapped_names = sum(1 for row in name_map_rows if row.get("ingredient_id"))
    mapping_summary = {
        "ddinter_unique_names": len(name_map_rows),
        "mapped_names": mapped_names,
        "mapped_pct": _format_pct(mapped_names, len(name_map_rows)),
        "top_unmapped_names": top_unmapped_names,
    }
    by_severity = {severity: 0 for severity in ("major", "moderate", "minor")}
    for row in imported_pairs.values():
        by_severity[str(row["severity"])] += 1
    pairs_summary = {
        "pairs_total_in_file": pairs_total_in_file,
        "pairs_inserted_mapped": len(imported_pairs),
        "by_severity": by_severity,
    }
    results = {
        "name_rows": len(name_map_rows),
        "pair_rows_seen": loaded_pair_rows,
        "pair_rows_written": len(pair_rows),
        "mapping_summary": mapping_summary,
        "pairs_summary": pairs_summary,
    }
    if output_dir is not None:
        results["qc_outputs"] = _write_ddi_qc_outputs(
            output_dir=output_dir,
            mapping_summary=mapping_summary,
            pairs_summary=pairs_summary,
        )
    return results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import curated DDInter DDI names and mapped pairs.")
    parser.add_argument("--names", required=True, help="Path to ddinter_drug_names_unique.csv")
    parser.add_argument("--pairs", required=True, help="Path to ddinter_pairs_combined_dedup.csv")
    parser.add_argument("--database-url", help="Postgres connection string; defaults to DATABASE_URL")
    parser.add_argument("--force", action="store_true", help="Recompute ingredient_id for existing manual DDInter mappings.")
    parser.add_argument("--output-dir", default="outputs/qc-ddi", help="Directory for generated DDI QC artifacts.")
    return parser


def _default_repository_factory(database_url: str):
    connection_context = connect_database(database_url)

    class RepositoryContext:
        def __enter__(self):
            self.connection = connection_context.__enter__()
            return DdiImportRepository(self.connection)

        def __exit__(self, exc_type, exc, tb):
            if exc_type is None:
                self.connection.commit()
            else:
                self.connection.rollback()
            return connection_context.__exit__(exc_type, exc, tb)

    return RepositoryContext()


def run_cli(
    argv: list[str] | None = None,
    *,
    repository_factory: Callable[[str], object] | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    settings = load_settings()
    database_url = args.database_url or settings.database_url
    if not database_url:
        raise ValueError("Provide --database-url or set DATABASE_URL before running the DDInter import.")

    factory = repository_factory or _default_repository_factory
    repository_or_context = factory(database_url)
    manager = repository_or_context if hasattr(repository_or_context, "__enter__") else nullcontext(repository_or_context)
    with manager as repository:
        import_ddinter(
            repository,
            names_path=Path(args.names),
            pairs_path=Path(args.pairs),
            force=bool(args.force),
            output_dir=Path(args.output_dir),
        )
    return 0


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import csv
from pathlib import Path
from uuid import uuid4


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


class FakeDdiRepository:
    def __init__(
        self,
        *,
        canonical_matches: dict[str, list[str]] | None = None,
        alias_matches: dict[str, list[str]] | None = None,
        existing_name_map: dict[str, dict[str, object]] | None = None,
    ) -> None:
        self.canonical_matches = canonical_matches or {}
        self.alias_matches = alias_matches or {}
        self.name_map_table = existing_name_map or {}
        self.pair_rows: list[dict[str, object]] = []

    def fetch_existing_name_map(self) -> dict[str, dict[str, object]]:
        return {key: dict(value) for key, value in self.name_map_table.items()}

    def fetch_canonical_matches(self, normalized_names: set[str]) -> dict[str, list[str]]:
        return {
            name: list(self.canonical_matches.get(name, []))
            for name in normalized_names
        }

    def fetch_alias_matches(self, normalized_names: set[str]) -> dict[str, list[str]]:
        return {
            name: list(self.alias_matches.get(name, []))
            for name in normalized_names
        }

    def upsert_name_map_rows(self, rows: list[dict[str, object]]) -> None:
        for row in rows:
            self.name_map_table[str(row["ddinter_drug_name"])] = dict(row)

    def upsert_pair_rows(self, rows: list[dict[str, object]]) -> None:
        self.pair_rows = [dict(row) for row in rows]


def test_import_ddinter_keeps_ambiguous_name_unmapped(tmp_path: Path) -> None:
    from etl.import_ddi_ddinter import import_ddinter

    names_path = tmp_path / "ddinter_drug_names_unique.csv"
    pairs_path = tmp_path / "ddinter_pairs_combined_dedup.csv"
    _write_csv(
        names_path,
        ["drug_name", "occurrences_in_pairs", "distinct_ddinter_ids", "ddinter_ids"],
        [
            {
                "drug_name": "Alpha / Beta",
                "occurrences_in_pairs": 3,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter1",
            }
        ],
    )
    _write_csv(
        pairs_path,
        ["drug_a", "drug_b", "ddinter_id_a", "ddinter_id_b", "severity", "severity_rank", "sources", "raw_rows_merged"],
        [],
    )
    repository = FakeDdiRepository(
        canonical_matches={"ALPHA BETA": [str(uuid4()), str(uuid4())]},
    )

    import_ddinter(repository, names_path=names_path, pairs_path=pairs_path)

    name_row = repository.name_map_table["Alpha / Beta"]
    assert name_row["ingredient_id"] is None
    assert name_row["match_method"] == "unmapped"


def test_import_ddinter_normalizes_pair_order_and_keeps_highest_severity(tmp_path: Path) -> None:
    from etl.import_ddi_ddinter import import_ddinter

    ingredient_high = "ffffffff-ffff-ffff-ffff-ffffffffffff"
    ingredient_low = "00000000-0000-0000-0000-000000000001"
    names_path = tmp_path / "ddinter_drug_names_unique.csv"
    pairs_path = tmp_path / "ddinter_pairs_combined_dedup.csv"
    _write_csv(
        names_path,
        ["drug_name", "occurrences_in_pairs", "distinct_ddinter_ids", "ddinter_ids"],
        [
            {
                "drug_name": "Drug A",
                "occurrences_in_pairs": 2,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter1",
            },
            {
                "drug_name": "Drug B",
                "occurrences_in_pairs": 2,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter2",
            },
        ],
    )
    _write_csv(
        pairs_path,
        ["drug_a", "drug_b", "ddinter_id_a", "ddinter_id_b", "severity", "severity_rank", "sources", "raw_rows_merged"],
        [
            {
                "drug_a": "Drug A",
                "drug_b": "Drug B",
                "ddinter_id_a": "DDInter1",
                "ddinter_id_b": "DDInter2",
                "severity": "Minor",
                "severity_rank": 1,
                "sources": "file_b.csv",
                "raw_rows_merged": 1,
            },
            {
                "drug_a": "Drug B",
                "drug_b": "Drug A",
                "ddinter_id_a": "DDInter2",
                "ddinter_id_b": "DDInter1",
                "severity": "Major",
                "severity_rank": 3,
                "sources": "file_a.csv",
                "raw_rows_merged": 2,
            },
        ],
    )
    repository = FakeDdiRepository(
        canonical_matches={
            "DRUG A": [ingredient_high],
            "DRUG B": [ingredient_low],
        }
    )

    import_ddinter(repository, names_path=names_path, pairs_path=pairs_path)

    assert repository.name_map_table["Drug A"]["match_method"] == "exact_canonical"
    assert repository.name_map_table["Drug B"]["match_method"] == "exact_canonical"
    assert repository.pair_rows == [
        {
            "ingredient_a_id": ingredient_low,
            "ingredient_b_id": ingredient_high,
            "severity": "major",
            "source": "ddinter",
            "source_detail": "file_a.csv;file_b.csv",
            "raw_rows_merged": 3,
        }
    ]


def test_import_ddinter_loads_pairs_only_when_both_names_map(tmp_path: Path) -> None:
    from etl.import_ddi_ddinter import import_ddinter

    ingredient_a = str(uuid4())
    names_path = tmp_path / "ddinter_drug_names_unique.csv"
    pairs_path = tmp_path / "ddinter_pairs_combined_dedup.csv"
    _write_csv(
        names_path,
        ["drug_name", "occurrences_in_pairs", "distinct_ddinter_ids", "ddinter_ids"],
        [
            {
                "drug_name": "Mapped Drug",
                "occurrences_in_pairs": 1,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter1",
            },
            {
                "drug_name": "Unknown Drug",
                "occurrences_in_pairs": 1,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter2",
            },
        ],
    )
    _write_csv(
        pairs_path,
        ["drug_a", "drug_b", "ddinter_id_a", "ddinter_id_b", "severity", "severity_rank", "sources", "raw_rows_merged"],
        [
            {
                "drug_a": "Mapped Drug",
                "drug_b": "Unknown Drug",
                "ddinter_id_a": "DDInter1",
                "ddinter_id_b": "DDInter2",
                "severity": "Moderate",
                "severity_rank": 2,
                "sources": "file.csv",
                "raw_rows_merged": 1,
            }
        ],
    )
    repository = FakeDdiRepository(
        canonical_matches={"MAPPED DRUG": [ingredient_a]},
    )

    import_ddinter(repository, names_path=names_path, pairs_path=pairs_path)

    assert repository.name_map_table["Mapped Drug"]["ingredient_id"] == ingredient_a
    assert repository.name_map_table["Mapped Drug"]["match_method"] == "exact_canonical"
    assert repository.name_map_table["Unknown Drug"]["ingredient_id"] is None
    assert repository.pair_rows == []


def test_import_ddinter_supports_prepared_header_variants_and_exact_alias(tmp_path: Path) -> None:
    from etl.import_ddi_ddinter import import_ddinter

    ingredient_id = str(uuid4())
    names_path = tmp_path / "ddinter_drug_names_unique.csv"
    pairs_path = tmp_path / "ddinter_pairs_combined_dedup.csv"
    _write_csv(
        names_path,
        ["Drug_Name", "Occurrences_In_Pairs", "Distinct_DDInter_IDs", "DDInter_IDs"],
        [
            {
                "Drug_Name": "Alias Drug",
                "Occurrences_In_Pairs": 1,
                "Distinct_DDInter_IDs": 1,
                "DDInter_IDs": "DDInter9",
            },
            {
                "Drug_Name": "Other Drug",
                "Occurrences_In_Pairs": 1,
                "Distinct_DDInter_IDs": 1,
                "DDInter_IDs": "DDInter10",
            },
        ],
    )
    _write_csv(
        pairs_path,
        ["Drug_A", "Drug_B", "DDInter_ID_A", "DDInter_ID_B", "Level", "Severity_Rank", "Sources", "Raw_Rows_Merged"],
        [
            {
                "Drug_A": "Alias Drug",
                "Drug_B": "Other Drug",
                "DDInter_ID_A": "DDInter9",
                "DDInter_ID_B": "DDInter10",
                "Level": "Moderate",
                "Severity_Rank": 2,
                "Sources": "prepared.csv",
                "Raw_Rows_Merged": 1,
            }
        ],
    )
    repository = FakeDdiRepository(
        canonical_matches={"OTHER DRUG": [str(uuid4())]},
        alias_matches={"ALIAS DRUG": [ingredient_id]},
    )

    import_ddinter(repository, names_path=names_path, pairs_path=pairs_path)

    assert repository.name_map_table["Alias Drug"]["ingredient_id"] == ingredient_id
    assert repository.name_map_table["Alias Drug"]["match_method"] == "exact_alias"
    assert repository.pair_rows == [
        {
            "ingredient_a_id": min(ingredient_id, repository.name_map_table["Other Drug"]["ingredient_id"]),
            "ingredient_b_id": max(ingredient_id, repository.name_map_table["Other Drug"]["ingredient_id"]),
            "severity": "moderate",
            "source": "ddinter",
            "source_detail": "prepared.csv",
            "raw_rows_merged": 1,
        }
    ]


def test_import_ddinter_writes_qc_outputs(tmp_path: Path) -> None:
    import json

    from etl.import_ddi_ddinter import import_ddinter

    ingredient_a = "00000000-0000-0000-0000-000000000001"
    ingredient_b = "00000000-0000-0000-0000-000000000002"
    names_path = tmp_path / "ddinter_drug_names_unique.csv"
    pairs_path = tmp_path / "ddinter_pairs_combined_dedup.csv"
    output_dir = tmp_path / "outputs" / "qc-ddi"
    _write_csv(
        names_path,
        ["drug_name", "occurrences_in_pairs", "distinct_ddinter_ids", "ddinter_ids"],
        [
            {
                "drug_name": "Mapped A",
                "occurrences_in_pairs": 5,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter1",
            },
            {
                "drug_name": "Mapped B",
                "occurrences_in_pairs": 4,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter2",
            },
            {
                "drug_name": "Unknown High",
                "occurrences_in_pairs": 7,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter3",
            },
            {
                "drug_name": "Unknown Low",
                "occurrences_in_pairs": 2,
                "distinct_ddinter_ids": 1,
                "ddinter_ids": "DDInter4",
            },
        ],
    )
    _write_csv(
        pairs_path,
        ["drug_a", "drug_b", "ddinter_id_a", "ddinter_id_b", "severity", "severity_rank", "sources", "raw_rows_merged"],
        [
            {
                "drug_a": "Mapped A",
                "drug_b": "Mapped B",
                "ddinter_id_a": "DDInter1",
                "ddinter_id_b": "DDInter2",
                "severity": "Major",
                "severity_rank": 3,
                "sources": "source-a.csv",
                "raw_rows_merged": 1,
            },
            {
                "drug_a": "Mapped B",
                "drug_b": "Unknown High",
                "ddinter_id_a": "DDInter2",
                "ddinter_id_b": "DDInter3",
                "severity": "Minor",
                "severity_rank": 1,
                "sources": "source-b.csv",
                "raw_rows_merged": 1,
            },
        ],
    )
    repository = FakeDdiRepository(
        canonical_matches={
            "MAPPED A": [ingredient_a],
            "MAPPED B": [ingredient_b],
        }
    )

    result = import_ddinter(
        repository,
        names_path=names_path,
        pairs_path=pairs_path,
        output_dir=output_dir,
    )

    mapping_summary = json.loads((output_dir / "ddi_mapping_summary.json").read_text(encoding="utf-8"))
    pairs_summary = json.loads((output_dir / "ddi_pairs_summary.json").read_text(encoding="utf-8"))
    mapping_markdown = (output_dir / "ddi_mapping_summary.md").read_text(encoding="utf-8")
    pairs_markdown = (output_dir / "ddi_pairs_summary.md").read_text(encoding="utf-8")
    unmapped_rows = list(csv.DictReader((output_dir / "unmapped_names_top100.csv").open(encoding="utf-8", newline="")))

    assert result["mapping_summary"] == mapping_summary
    assert result["pairs_summary"] == pairs_summary
    assert mapping_summary == {
        "ddinter_unique_names": 4,
        "mapped_names": 2,
        "mapped_pct": "50.00%",
        "top_unmapped_names": [
            {
                "ddinter_drug_name": "Unknown High",
                "occurrences_in_pairs": 7,
                "ddinter_ids": "DDInter3",
            },
            {
                "ddinter_drug_name": "Unknown Low",
                "occurrences_in_pairs": 2,
                "ddinter_ids": "DDInter4",
            },
        ],
    }
    assert pairs_summary == {
        "pairs_total_in_file": 2,
        "pairs_inserted_mapped": 1,
        "by_severity": {
            "major": 1,
            "moderate": 0,
            "minor": 0,
        },
    }
    assert "| `ddinter_unique_names` | 4 |" in mapping_markdown
    assert "| Unknown High | 7 | DDInter3 |" in mapping_markdown
    assert "| `pairs_total_in_file` | 2 |" in pairs_markdown
    assert "| `major` | 1 |" in pairs_markdown
    assert unmapped_rows == [
        {
            "ddinter_drug_name": "Unknown High",
            "occurrences_in_pairs": "7",
            "ddinter_ids": "DDInter3",
        },
        {
            "ddinter_drug_name": "Unknown Low",
            "occurrences_in_pairs": "2",
            "ddinter_ids": "DDInter4",
        },
    ]

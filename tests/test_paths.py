from pathlib import Path

import pytest


def test_discover_dataset_paths_reports_presence(tmp_path: Path) -> None:
    from etl.paths import REQUIRED_DATASETS, discover_dataset_paths

    datasets_dir = tmp_path / "Datasets"
    datasets_dir.mkdir()
    (datasets_dir / "A21030000I-E41001-001.csv").write_text("x", encoding="utf-8")

    result = discover_dataset_paths(datasets_dir)

    assert result["A21030000I-E41001-001.csv"].exists is True
    assert result["A21030000I-E41002-002.csv"].required is False
    assert set(result) == {item.file_name for item in REQUIRED_DATASETS}


def test_require_existing_dataset_raises_for_missing_required_file(tmp_path: Path) -> None:
    from etl.paths import DatasetSpec, require_existing_dataset

    missing = tmp_path / "Datasets" / "36_2.csv"

    with pytest.raises(FileNotFoundError, match="36_2.csv"):
        require_existing_dataset(DatasetSpec("36_2.csv", True), missing)

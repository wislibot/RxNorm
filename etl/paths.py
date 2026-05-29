from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import load_settings


@dataclass(frozen=True)
class DatasetSpec:
    file_name: str
    required: bool
    source_name: str = ""
    description: str = ""


@dataclass(frozen=True)
class DatasetLocation:
    spec: DatasetSpec
    path: Path
    exists: bool

    @property
    def file_name(self) -> str:
        return self.spec.file_name

    @property
    def required(self) -> bool:
        return self.spec.required

    @property
    def source_name(self) -> str:
        return self.spec.source_name


REQUIRED_DATASETS: tuple[DatasetSpec, ...] = (
    DatasetSpec(
        file_name="A21030000I-E41001-001.csv",
        required=True,
        source_name="nhi_items",
        description="Primary NHI drug item dictionary.",
    ),
    DatasetSpec(
        file_name="A21030000I-E41002-002.csv",
        required=False,
        source_name="nhi_component_map",
        description="Optional NHI component mapping enrichment.",
    ),
    DatasetSpec(
        file_name="36_2.csv",
        required=True,
        source_name="tfda_36",
        description="TFDA all permits reference.",
    ),
    DatasetSpec(
        file_name="37_2.csv",
        required=True,
        source_name="tfda_37",
        description="TFDA active permits reference.",
    ),
    DatasetSpec(
        file_name="ATC_DDD_fabkury_merged.csv",
        required=True,
        source_name="atc_ddd",
        description="Merged ATC/DDD reference snapshots.",
    ),
    DatasetSpec(
        file_name="all1_11505_1.TXT",
        required=True,
        source_name="all1",
        description="NHI history and price validation file, part 1.",
    ),
    DatasetSpec(
        file_name="all1_11505_2.TXT",
        required=True,
        source_name="all1",
        description="NHI history and price validation file, part 2.",
    ),
)


def discover_dataset_paths(datasets_dir: Path | str | None = None) -> dict[str, DatasetLocation]:
    resolved_dir = Path(datasets_dir) if datasets_dir else load_settings().datasets_dir
    return {
        spec.file_name: DatasetLocation(
            spec=spec,
            path=resolved_dir / spec.file_name,
            exists=(resolved_dir / spec.file_name).exists(),
        )
        for spec in REQUIRED_DATASETS
    }


def require_existing_dataset(spec: DatasetSpec, path: Path | str) -> Path:
    dataset_path = Path(path)
    if spec.required and not dataset_path.exists():
        raise FileNotFoundError(f"Required dataset is missing: {spec.file_name}")
    return dataset_path

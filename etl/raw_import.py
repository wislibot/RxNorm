from __future__ import annotations

import argparse
import itertools
import json
import re
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .config import load_settings
from .paths import discover_dataset_paths, require_existing_dataset
from .utils import open_delimited_rows, parse_date, parse_decimal


@dataclass(frozen=True)
class DatasetPlan:
    key: str
    file_names: tuple[str, ...]
    table_name: str
    source_name: str
    columns: tuple[str, ...]
    parser: Callable[[Path], Iterable[dict[str, object]]]
    optional: bool = False


RAW_NHI_ITEM_COLUMNS = (
    "change_flag",
    "nhi_code",
    "name_en",
    "name_zh",
    "ingredient_text",
    "strength_value",
    "strength_unit",
    "combo_flag",
    "price_nhi",
    "effective_start",
    "effective_end",
    "vendor_name",
    "manufacturer_name",
    "dose_form",
    "drug_category",
    "category_group_name",
    "atc_code",
    "reimbursement_section",
    "tfda_link",
    "reimbursement_section_link",
    "source_payload",
)

RAW_TFDA_COLUMNS = (
    "tfda_permit_no",
    "cancel_status",
    "cancel_date",
    "cancel_reason",
    "expiry_date",
    "issue_date",
    "permit_type",
    "old_permit_no",
    "customs_doc_no",
    "product_name_zh",
    "product_name_en",
    "indications",
    "dosage_form",
    "packaging",
    "drug_class",
    "controlled_substance_level",
    "ingredient_text_tfda",
    "applicant_name",
    "applicant_address",
    "applicant_tax_id",
    "manufacturer_name",
    "manufacturer_site_address",
    "manufacturer_company_address",
    "manufacturer_country",
    "manufacturing_process",
    "change_date",
    "usage_dosage",
    "packaging_barcode",
    "source_payload",
)

RAW_ATC_COLUMNS = (
    "snapshot_date",
    "record_type",
    "atc_code",
    "atc_name",
    "ddd",
    "uom",
    "adm_r",
    "note",
    "brand_name",
    "dosage_form",
    "ingredients",
    "ddd_comb",
    "source_payload",
)

RAW_COMPONENT_COLUMNS = (
    "component_code",
    "reimbursed_component_code",
    "reimbursed_component_name",
    "source_payload",
)

RAW_ALL1_CODE_SET_COLUMNS = ("nhi_code",)

ALL1_SLICES = {
    "validation_status": slice(14, 15),
    "nhi_code": slice(17, 27),
    "price_nhi": slice(32, 37),
    "effective_start": slice(38, 45),
    "effective_end": slice(46, 53),
    "name_en": slice(54, 178),
    "package_quantity": slice(178, 182),
    "package_unit": slice(183, 236),
    "ingredient_text": slice(236, 298),
    "strength_text": slice(298, 358),
    "dose_form": slice(358, 601),
    "manufacturer_short_name": slice(601, 754),
    "name_zh": slice(758, 873),
    "search_text": slice(873, 1776),
    "manufacturer_name": slice(1776, 1808),
    "atc_code": slice(1808, None),
}

ALL1_VARIABLE_BLOCK_RE = re.compile(
    r"(?P<package_quantity>\d+(?:\.\d+)?)\s+(?P<package_unit>[A-Z][A-Z ()/%\.-]*?)\s{2,}(?P<ingredient_text>\s*[^\d\s].*?)\s*$"
)
ALL1_STRENGTH_DOSE_RE = re.compile(r"^(?P<strength_text>.*?\S)\s{2,}(?P<dose_form>\S+)")
ALL1_ATC_RE = re.compile(r"(?P<atc_code>[A-Z][0-9A-Z]{2,7})\s*$")


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _json_payload(row: dict[str, str]) -> str:
    return json.dumps(row, ensure_ascii=False)


def map_nhi_item_row(row: dict[str, str]) -> dict[str, object]:
    return {
        "change_flag": _clean_text(row.get("異動")),
        "nhi_code": _clean_text(row.get("藥品代號")),
        "name_en": _clean_text(row.get("藥品英文名稱")),
        "name_zh": _clean_text(row.get("藥品中文名稱")),
        "ingredient_text": _clean_text(row.get("成分")),
        "strength_value": parse_decimal(row.get("規格量")),
        "strength_unit": _clean_text(row.get("規格單位")),
        "combo_flag": _clean_text(row.get("單複方")),
        "price_nhi": parse_decimal(row.get("支付價")),
        "effective_start": parse_date(row.get("有效起日")),
        "effective_end": parse_date(row.get("有效迄日")),
        "vendor_name": _clean_text(row.get("藥商")),
        "manufacturer_name": _clean_text(row.get("製造廠名稱")),
        "dose_form": _clean_text(row.get("劑型")),
        "drug_category": _clean_text(row.get("藥品分類")),
        "category_group_name": _clean_text(row.get("分類分組名稱")),
        "atc_code": _clean_text(row.get("ATC代碼")),
        "reimbursement_section": _clean_text(row.get("給付規定章節")),
        "tfda_link": _clean_text(row.get("藥品代碼超連結")),
        "reimbursement_section_link": _clean_text(row.get("給付規定章節連結")),
        "source_payload": _json_payload(row),
    }


def map_component_row(row: dict[str, str]) -> dict[str, object]:
    return {
        "component_code": _clean_text(row.get("成分代碼")),
        "reimbursed_component_code": _clean_text(row.get("核價成分代碼")),
        "reimbursed_component_name": _clean_text(row.get("核價成分名稱")),
        "source_payload": _json_payload(row),
    }


def map_tfda_permit_row(row: dict[str, str]) -> dict[str, object]:
    return {
        "tfda_permit_no": _clean_text(row.get("許可證字號")),
        "cancel_status": _clean_text(row.get("註銷狀態")),
        "cancel_date": parse_date(row.get("註銷日期")),
        "cancel_reason": _clean_text(row.get("註銷理由")),
        "expiry_date": parse_date(row.get("有效日期")),
        "issue_date": parse_date(row.get("發證日期")),
        "permit_type": _clean_text(row.get("許可證種類")),
        "old_permit_no": _clean_text(row.get("舊證字號")),
        "customs_doc_no": _clean_text(row.get("通關簽審文件編號")),
        "product_name_zh": _clean_text(row.get("中文品名")),
        "product_name_en": _clean_text(row.get("英文品名")),
        "indications": _clean_text(row.get("適應症")),
        "dosage_form": _clean_text(row.get("劑型")),
        "packaging": _clean_text(row.get("包裝")),
        "drug_class": _clean_text(row.get("藥品類別")),
        "controlled_substance_level": _clean_text(row.get("管制藥品分類級別")),
        "ingredient_text_tfda": _clean_text(row.get("主成分略述")),
        "applicant_name": _clean_text(row.get("申請商名稱")),
        "applicant_address": _clean_text(row.get("申請商地址")),
        "applicant_tax_id": _clean_text(row.get("申請商統一編號")),
        "manufacturer_name": _clean_text(row.get("製造商名稱")),
        "manufacturer_site_address": _clean_text(row.get("製造廠廠址")),
        "manufacturer_company_address": _clean_text(row.get("製造廠公司地址")),
        "manufacturer_country": _clean_text(row.get("製造廠國別")),
        "manufacturing_process": _clean_text(row.get("製程")),
        "change_date": parse_date(row.get("異動日期")),
        "usage_dosage": _clean_text(row.get("用法用量")),
        "packaging_barcode": _clean_text(row.get("包裝與國際條碼")),
        "source_payload": _json_payload(row),
    }


def map_atc_row(row: dict[str, str]) -> dict[str, object]:
    return {
        "snapshot_date": parse_date(row.get("snapshot_date")),
        "record_type": _clean_text(row.get("record_type")),
        "atc_code": _clean_text(row.get("atc_code")),
        "atc_name": _clean_text(row.get("atc_name")),
        "ddd": parse_decimal(row.get("ddd")),
        "uom": _clean_text(row.get("uom")),
        "adm_r": _clean_text(row.get("adm_r")),
        "note": _clean_text(row.get("note")),
        "brand_name": _clean_text(row.get("brand_name")),
        "dosage_form": _clean_text(row.get("dosage_form")),
        "ingredients": _clean_text(row.get("ingredients")),
        "ddd_comb": _clean_text(row.get("ddd_comb")),
        "source_payload": _json_payload(row),
    }


def parse_all1_line(line: str) -> dict[str, object]:
    def field(name: str) -> str | None:
        return _clean_text(line[ALL1_SLICES[name]])

    variable_block = line[ALL1_SLICES["name_en"].start : ALL1_SLICES["strength_text"].start]
    variable_matches = list(ALL1_VARIABLE_BLOCK_RE.finditer(variable_block))
    if variable_matches:
        variable_match = variable_matches[-1]
        name_en = _clean_text(variable_block[: variable_match.start()])
        package_quantity = parse_decimal(variable_match.group("package_quantity"))
        package_unit = _clean_text(variable_match.group("package_unit"))
        ingredient_text = _clean_text(variable_match.group("ingredient_text"))
    else:
        name_en = field("name_en")
        package_quantity = parse_decimal(field("package_quantity"))
        package_unit = field("package_unit")
        ingredient_text = field("ingredient_text")

    strength_dose_block = line[ALL1_SLICES["strength_text"].start : ALL1_SLICES["manufacturer_short_name"].start]
    strength_dose_match = ALL1_STRENGTH_DOSE_RE.match(strength_dose_block)
    if strength_dose_match is None:
        strength_text = field("strength_text")
        dose_form = field("dose_form")
    else:
        strength_text = _clean_text(strength_dose_match.group("strength_text"))
        dose_form = _clean_text(strength_dose_match.group("dose_form"))
    atc_match = ALL1_ATC_RE.search(line)

    return {
        "nhi_code": field("nhi_code"),
        "validation_status": field("validation_status"),
        "price_nhi": parse_decimal(field("price_nhi")),
        "effective_start": parse_date(field("effective_start")),
        "effective_end": parse_date(field("effective_end")),
        "name_en": name_en,
        "package_quantity": package_quantity,
        "package_unit": package_unit,
        "ingredient_text": ingredient_text,
        "strength_text": strength_text,
        "dose_form": dose_form,
        "manufacturer_short_name": field("manufacturer_short_name"),
        "name_zh": field("name_zh"),
        "search_text": field("search_text"),
        "manufacturer_name": field("manufacturer_name"),
        "atc_code": atc_match.group("atc_code") if atc_match else field("atc_code"),
        "raw_line": line.rstrip("\n"),
    }


def _iter_mapped_csv_rows(path: Path, mapper: Callable[[dict[str, str]], dict[str, object]]) -> Iterator[dict[str, object]]:
    for row in open_delimited_rows(path):
        yield mapper(row)


def iter_nhi_rows(path: Path) -> Iterator[dict[str, object]]:
    yield from _iter_mapped_csv_rows(path, map_nhi_item_row)


def iter_component_rows(path: Path) -> Iterator[dict[str, object]]:
    yield from _iter_mapped_csv_rows(path, map_component_row)


def iter_tfda_rows(path: Path) -> Iterator[dict[str, object]]:
    yield from _iter_mapped_csv_rows(path, map_tfda_permit_row)


def iter_atc_rows(path: Path) -> Iterator[dict[str, object]]:
    yield from _iter_mapped_csv_rows(path, map_atc_row)


def iter_all1_rows(path: Path) -> Iterator[dict[str, object]]:
    with path.open("r", encoding="cp950", errors="replace") as handle:
        for line in handle:
            if line.strip():
                yield parse_all1_line(line.rstrip("\n"))


def iter_all1_code_rows(path: Path) -> Iterator[dict[str, object]]:
    for row in iter_all1_rows(path):
        nhi_code = row.get("nhi_code")
        if nhi_code:
            yield {"nhi_code": nhi_code}


DATASET_PLANS: dict[str, DatasetPlan] = {
    "nhi_items": DatasetPlan(
        key="nhi_items",
        file_names=("A21030000I-E41001-001.csv",),
        table_name="raw_nhi_items",
        source_name="nhi_items",
        columns=RAW_NHI_ITEM_COLUMNS,
        parser=iter_nhi_rows,
    ),
    "nhi_component_map": DatasetPlan(
        key="nhi_component_map",
        file_names=("A21030000I-E41002-002.csv",),
        table_name="raw_nhi_component_map",
        source_name="nhi_component_map",
        columns=RAW_COMPONENT_COLUMNS,
        parser=iter_component_rows,
        optional=True,
    ),
    "tfda_36": DatasetPlan(
        key="tfda_36",
        file_names=("36_2.csv",),
        table_name="raw_tfda_permits_all",
        source_name="tfda_36",
        columns=RAW_TFDA_COLUMNS,
        parser=iter_tfda_rows,
    ),
    "tfda_37": DatasetPlan(
        key="tfda_37",
        file_names=("37_2.csv",),
        table_name="raw_tfda_permits_active",
        source_name="tfda_37",
        columns=RAW_TFDA_COLUMNS,
        parser=iter_tfda_rows,
    ),
    "atc_ddd": DatasetPlan(
        key="atc_ddd",
        file_names=("ATC_DDD_fabkury_merged.csv",),
        table_name="raw_atc_ddd",
        source_name="atc_ddd",
        columns=RAW_ATC_COLUMNS,
        parser=iter_atc_rows,
    ),
    "all1": DatasetPlan(
        key="all1",
        file_names=("all1_11505_1.TXT", "all1_11505_2.TXT"),
        table_name="rx_qc_all1_code_set",
        source_name="all1",
        columns=RAW_ALL1_CODE_SET_COLUMNS,
        parser=iter_all1_code_rows,
    ),
}

DEFAULT_DATASET_ORDER = ("nhi_items", "nhi_component_map", "tfda_36", "tfda_37", "atc_ddd", "all1")


def resolve_dataset_keys(dataset: str) -> list[str]:
    if dataset == "all":
        return list(DEFAULT_DATASET_ORDER)
    return [dataset]


def import_dataset(
    repository,
    dataset_key: str,
    *,
    datasets_dir: Path | str | None = None,
    source_version: str | None = None,
) -> int:
    plan = DATASET_PLANS[dataset_key]
    discovered = discover_dataset_paths(datasets_dir)
    file_paths: list[Path] = []
    for file_name in plan.file_names:
        location = discovered[file_name]
        if not location.exists:
            if plan.optional:
                return 0
            require_existing_dataset(location.spec, location.path)
        file_paths.append(location.path)

    batch_id = repository.start_batch(
        source_name=plan.source_name,
        source_version=source_version,
        notes=", ".join(plan.file_names),
    )

    rows = itertools.chain.from_iterable(plan.parser(file_path) for file_path in file_paths)
    if dataset_key == "all1":
        rows = _dedupe_all1_code_rows(rows)
    if dataset_key == "all1":
        total_rows = repository.replace_simple_rows(
            table_name=plan.table_name,
            columns=plan.columns,
            rows=rows,
        )
    else:
        total_rows = repository.insert_rows(
            table_name=plan.table_name,
            columns=plan.columns,
            rows=rows,
            import_batch_id=batch_id,
        )

    repository.complete_batch(batch_id, total_rows)
    return total_rows


def _dedupe_all1_code_rows(rows: Iterable[dict[str, object]]) -> Iterator[dict[str, object]]:
    seen: set[str] = set()
    for row in rows:
        nhi_code = row.get("nhi_code")
        if not isinstance(nhi_code, str):
            continue
        normalized = nhi_code.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        yield {"nhi_code": normalized}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import raw Taiwan RxNorm datasets into Postgres.")
    parser.add_argument(
        "--dataset",
        default="all",
        choices=("all", *DATASET_PLANS.keys()),
        help="Dataset to import. Defaults to all raw datasets.",
    )
    parser.add_argument(
        "--datasets-dir",
        default=None,
        help="Override the default Datasets directory.",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres connection string. Falls back to DATABASE_URL from the environment.",
    )
    parser.add_argument(
        "--source-version",
        default=None,
        help="Optional version label stored on rx_import_batches.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    from .import_raw import run_cli

    return run_cli(list(argv) if argv is not None else None)


__all__ = [
    "DATASET_PLANS",
    "RAW_ALL1_CODE_SET_COLUMNS",
    "RAW_ATC_COLUMNS",
    "RAW_COMPONENT_COLUMNS",
    "RAW_NHI_ITEM_COLUMNS",
    "RAW_TFDA_COLUMNS",
    "build_parser",
    "import_dataset",
    "iter_all1_code_rows",
    "iter_all1_rows",
    "map_atc_row",
    "map_component_row",
    "map_nhi_item_row",
    "map_tfda_permit_row",
    "parse_all1_line",
    "resolve_dataset_keys",
]

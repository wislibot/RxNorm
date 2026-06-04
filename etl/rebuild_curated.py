from __future__ import annotations

import argparse
from contextlib import nullcontext
from typing import Callable

from .config import load_settings
from .curated_build import build_curated_payload, merge_review_queue_items
from .curated_repository import CuratedRepository
from .db import connect_database


CURATED_RELEASE_TABLES = [
    "rx_product_ingredients",
    "rx_nhi_tfda_map",
    "rx_name_variants",
    "rx_review_queue",
    "rx_ingredient_tokens",
    "rx_drug_products",
    "rx_ingredient_concepts",
    "rx_tfda_permits",
    "rx_atc_reference_latest",
]

CURATED_TABLE_COLUMNS = {
    "rx_drug_products": (
        "nhi_code",
        "name_zh",
        "name_en",
        "ingredient_text_nhi",
        "dose_form",
        "strength_value",
        "strength_unit",
        "is_combo",
        "atc_code",
        "tfda_link",
        "price_nhi",
        "effective_start",
        "effective_end",
        "updated_at",
    ),
    "rx_ingredient_concepts": (
        "ingredient_id",
        "canonical_name",
        "created_at",
        "updated_at",
    ),
    "rx_product_ingredients": (
        "nhi_code",
        "ingredient_id",
        "role",
        "strength_value",
        "strength_unit",
        "source",
    ),
    "rx_name_variants": (
        "variant_id",
        "target_type",
        "target_id",
        "variant_text",
        "normalized_text",
        "language",
        "variant_type",
        "source",
        "created_at",
    ),
    "rx_tfda_permits": (
        "tfda_permit_no",
        "is_cancelled",
        "cancel_date",
        "expiry_date",
        "issue_date",
        "controlled_substance_level",
        "product_name",
        "dosage_form",
        "packaging",
        "ingredient_text_tfda",
        "applicant_name",
        "applicant_address",
        "applicant_tax_id",
        "manufacturer_name",
        "manufacturer_address",
        "manufacturer_country",
        "updated_at",
    ),
    "rx_nhi_tfda_map": (
        "nhi_code",
        "tfda_permit_no",
        "link_source",
        "created_at",
    ),
    "rx_atc_reference_latest": (
        "atc_code",
        "atc_name",
        "ddd",
        "uom",
        "adm_r",
        "note",
        "snapshot_date",
    ),
    "rx_ingredient_tokens": (
        "ingredient_id",
        "token",
        "token_stem",
    ),
}


def _default_repository_factory(database_url: str):
    connection_context = connect_database(database_url)

    class RepositoryContext:
        def __enter__(self):
            self.connection = connection_context.__enter__()
            return CuratedRepository(self.connection)

        def __exit__(self, exc_type, exc, tb):
            if exc_type is None:
                self.connection.commit()
            else:
                self.connection.rollback()
            return connection_context.__exit__(exc_type, exc, tb)

    return RepositoryContext()


def _preserve_existing_review_items(existing_items: list[dict]) -> list[dict]:
    return [
        item
        for item in existing_items
        if not (item.get("source") == "tfda_mismatch" and item.get("status") == "pending")
    ]


def run_rebuild(repository, *, review_threshold: float = 0.6) -> dict[str, int]:
    raw_inputs = repository.fetch_raw_inputs()
    existing_review_items = _preserve_existing_review_items(
        repository.fetch_existing_review_queue_items()
    )
    payload = build_curated_payload(raw_inputs, review_threshold=review_threshold)
    merged_review_items = merge_review_queue_items(existing_review_items, payload["rx_review_queue"])

    counts: dict[str, int] = {}
    with repository.transaction():
        repository.clear_curated_tables(CURATED_RELEASE_TABLES)
        for table_name in (
            "rx_drug_products",
            "rx_ingredient_concepts",
            "rx_product_ingredients",
            "rx_name_variants",
            "rx_tfda_permits",
            "rx_nhi_tfda_map",
            "rx_atc_reference_latest",
            "rx_ingredient_tokens",
        ):
            counts[table_name] = repository.replace_table(
                table_name,
                CURATED_TABLE_COLUMNS[table_name],
                payload[table_name],
            )
        counts["rx_review_queue"] = repository.append_review_queue_items(merged_review_items)

    return counts


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Rebuild curated Taiwan RxNorm tables from raw imports.")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres connection string. Falls back to DATABASE_URL.",
    )
    parser.add_argument(
        "--review-threshold",
        type=float,
        default=0.6,
        help="Minimum similarity required before suppressing a TFDA mismatch review item.",
    )
    return parser


def run_cli(
    argv: list[str] | None = None,
    *,
    repository_factory: Callable[[str], object] | None = None,
    runner: Callable[..., dict[str, int] | None] = run_rebuild,
) -> int:
    args = build_parser().parse_args(argv)
    settings = load_settings()
    database_url = args.database_url or settings.database_url
    if not database_url:
        raise ValueError("Provide --database-url or set DATABASE_URL before rebuilding curated tables.")

    factory = repository_factory or _default_repository_factory
    repository_or_context = factory(database_url)
    manager = repository_or_context if hasattr(repository_or_context, "__enter__") else nullcontext(repository_or_context)

    with manager as repository:
        runner(repository, review_threshold=args.review_threshold)

    return 0


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())

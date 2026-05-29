from __future__ import annotations

import argparse
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Callable

from .config import load_settings
from .db import connect_database
from .import_ddi_ddinter import DdiImportRepository

MANUAL_NOTE = "manual map (base-name->salt/hydrate/form in TW concepts)"

MANUAL_DDI_NAME_MAP_PATCHES: tuple[dict[str, str], ...] = (
    {"ddinter_drug_name": "Promethazine", "ingredient_id": "58a8dc7a-bef0-56e1-a837-4dadca9a7f51"},
    {"ddinter_drug_name": "Ethanol", "ingredient_id": "89497baa-8c8a-5280-a573-80fd1a3b6c09"},
    {"ddinter_drug_name": "Ozanimod", "ingredient_id": "98b27219-c91a-577d-9864-786fee0ba263"},
    {"ddinter_drug_name": "Doxepin", "ingredient_id": "30ce1b8d-9ee6-59a4-bb90-f194ffd4b8bb"},
    {"ddinter_drug_name": "Warfarin", "ingredient_id": "85f17a1f-ce4f-56b1-8e93-da323b8e9767"},
    {"ddinter_drug_name": "Nilotinib", "ingredient_id": "05234257-0d01-5591-ae69-f17f238089b7"},
    {"ddinter_drug_name": "Mepyramine", "ingredient_id": "24b6c201-491c-5e15-b41a-318baed3b58f"},
    {"ddinter_drug_name": "Alimemazine", "ingredient_id": "1853cb7f-a006-520e-a4d6-48440570b7d4"},
    {"ddinter_drug_name": "Ribociclib", "ingredient_id": "195d42d8-e920-5498-b836-0272e8da9146"},
    {"ddinter_drug_name": "Imatinib", "ingredient_id": "bcf7dce1-a744-5573-bef6-1dd54b3aa0ff"},
    {"ddinter_drug_name": "Lapatinib", "ingredient_id": "06978039-4504-5f70-93e6-3fd992e4bf64"},
    {"ddinter_drug_name": "Siponimod", "ingredient_id": "2d0392a0-f1c2-52a6-be7b-fc1e48c80373"},
    {"ddinter_drug_name": "Hydroxychloroquine", "ingredient_id": "115573df-a33c-52d1-992f-59d84f20bd6f"},
    {"ddinter_drug_name": "Ondansetron", "ingredient_id": "7a83199e-1cdc-5ece-b91d-a807d36e7225"},
    {"ddinter_drug_name": "Doxepin (topical)", "ingredient_id": "30ce1b8d-9ee6-59a4-bb90-f194ffd4b8bb"},
    {"ddinter_drug_name": "Pazopanib", "ingredient_id": "7afaeccd-7dc3-5e16-9824-b72fa3eebe5d"},
    {"ddinter_drug_name": "Indacaterol", "ingredient_id": "f0cf8dba-deb4-5938-ad31-ae28c111a164"},
    {"ddinter_drug_name": "Quinine", "ingredient_id": "b64c608a-a3fb-5d74-9768-a3024578af4f"},
    {"ddinter_drug_name": "Glyburide", "ingredient_id": "1d47dcee-72bf-50fe-941c-60272ebdc607"},
    {"ddinter_drug_name": "Fedratinib", "ingredient_id": "ea4f09e9-f59c-579f-97db-9c8bef371370"},
    {"ddinter_drug_name": "Fludrocortisone", "ingredient_id": "33b6f96f-5103-55e4-a6c3-ff62f3c05690"},
    {"ddinter_drug_name": "Cabozantinib", "ingredient_id": "cd4a206f-eae5-5735-8a51-0d88e54caf43"},
    {"ddinter_drug_name": "Terbutaline", "ingredient_id": "08e78fe0-b225-5172-a25e-19ddc7cad8e8"},
    {"ddinter_drug_name": "Epinephrine", "ingredient_id": "26f8b228-683f-5194-9d44-7a0994ccd25f"},
    {"ddinter_drug_name": "Ponatinib", "ingredient_id": "cb282ba0-78eb-5459-a6a8-57a0fc0fe430"},
    {"ddinter_drug_name": "Neomycin", "ingredient_id": "9ec35eef-f754-54f7-ba8b-e94819c06e77"},
    {"ddinter_drug_name": "Ethinylestradiol", "ingredient_id": "9e3d20ef-6044-5c3f-a52a-9380dc73df5f"},
    {"ddinter_drug_name": "Vilanterol", "ingredient_id": "cdc56654-cd6a-5ec0-a2d6-d50ed11b7e3e"},
    {"ddinter_drug_name": "Procarbazine", "ingredient_id": "4e310b2b-7359-578f-bf3e-d2b05fb9f4b0"},
    {"ddinter_drug_name": "Abiraterone", "ingredient_id": "d2e30042-d134-59c3-ad05-92b5c1c507bb"},
    {"ddinter_drug_name": "Canagliflozin", "ingredient_id": "415d446a-5fd2-5ea6-a0e3-4e99e36c6b17"},
    {"ddinter_drug_name": "Ertugliflozin", "ingredient_id": "0bd56c81-e3de-5c2d-9907-1b48e732926e"},
    {"ddinter_drug_name": "Sorafenib", "ingredient_id": "ee6cfde1-6f1d-57b8-a65d-f72ca3ec08be"},
    {"ddinter_drug_name": "Dabrafenib", "ingredient_id": "74c6c301-0f7f-5751-879c-b247e9acbaf5"},
    {"ddinter_drug_name": "Pasireotide", "ingredient_id": "fafa18d7-ec0a-5c9b-9514-1cab51e8caf7"},
)


def apply_manual_ddi_name_map_patch(repository, *, force: bool = False) -> dict[str, int]:
    existing_name_map = repository.fetch_existing_name_map()
    rows_to_upsert: list[dict[str, Any]] = []
    skipped_rows = 0

    for patch in MANUAL_DDI_NAME_MAP_PATCHES:
        ddinter_drug_name = patch["ddinter_drug_name"]
        existing_row = existing_name_map.get(ddinter_drug_name, {})
        if not force and existing_row.get("ingredient_id"):
            skipped_rows += 1
            continue

        rows_to_upsert.append(
            {
                "ddinter_drug_name": ddinter_drug_name,
                "ddinter_ids": existing_row.get("ddinter_ids"),
                "occurrences_in_pairs": existing_row.get("occurrences_in_pairs"),
                "ingredient_id": patch["ingredient_id"],
                "match_method": "manual",
                "notes": MANUAL_NOTE,
            }
        )

    repository.upsert_name_map_rows(rows_to_upsert)
    return {
        "total_rows": len(MANUAL_DDI_NAME_MAP_PATCHES),
        "patched_rows": len(rows_to_upsert),
        "skipped_rows": skipped_rows,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apply approved manual DDInter name-to-ingredient mappings.")
    parser.add_argument("--database-url", help="Postgres connection string; defaults to DATABASE_URL")
    parser.add_argument("--force", action="store_true", help="Overwrite existing ingredient_id values in rx_ddi_name_map.")
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
        raise ValueError("Provide --database-url or set DATABASE_URL before running the DDInter patch.")

    factory = repository_factory or _default_repository_factory
    repository_or_context = factory(database_url)
    manager = repository_or_context if hasattr(repository_or_context, "__enter__") else nullcontext(repository_or_context)
    with manager as repository:
        apply_manual_ddi_name_map_patch(repository, force=bool(args.force))
    return 0


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())

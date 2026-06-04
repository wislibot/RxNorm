from __future__ import annotations

from contextlib import contextmanager
from datetime import date
from decimal import Decimal


def test_run_rebuild_uses_transactional_clear_and_rebuilds_pending_tfda_mismatches() -> None:
    from etl.rebuild_curated import run_rebuild

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0002",
                "name_zh": "不一致藥品",
                "name_en": "MISMATCH DRUG",
                "ingredient_text": "Acetaminophen",
                "dose_form": "tablet",
                "strength_value": Decimal("500"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "N02BE01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第333333號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第333333號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "不一致藥品",
                "product_name_en": "MISMATCH DRUG",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "Ibuprofen",
                "applicant_name": "Applicant",
                "applicant_address": "Address",
                "applicant_tax_id": "12345678",
                "manufacturer_name": "Maker",
                "manufacturer_site_address": "Plant",
                "manufacturer_company_address": "Company",
                "manufacturer_country": "TW",
            }
        ],
        "raw_tfda_permits_all": [],
        "raw_atc_ddd": [],
    }

    class FakeRepository:
        def __init__(self) -> None:
            self.events: list[tuple[str, object]] = []
            self.existing_review_items = [
                {
                    "review_id": "pending-review",
                    "created_at": "2026-05-13T00:00:00+00:00",
                    "source": "tfda_mismatch",
                    "nhi_code": "A0002",
                    "tfda_permit_no": "衛署藥製字第333333號",
                    "input_text": "Acetaminophen",
                    "ocr_text": "Ibuprofen",
                    "candidate_ingredient_ids": ["ing-a", "ing-b"],
                    "confidence": Decimal("0"),
                    "status": "pending",
                    "review_notes": "existing",
                },
                {
                    "review_id": "approved-review",
                    "created_at": "2026-05-12T00:00:00+00:00",
                    "source": "unknown_brand",
                    "nhi_code": None,
                    "tfda_permit_no": None,
                    "input_text": "Brand only",
                    "ocr_text": "Brand only",
                    "candidate_ingredient_ids": [],
                    "confidence": None,
                    "status": "approved",
                    "review_notes": "keep me",
                }
            ]

        def fetch_raw_inputs(self):
            self.events.append(("fetch_raw_inputs", None))
            return raw_data

        def fetch_existing_review_queue_items(self):
            self.events.append(("fetch_existing_review_queue_items", None))
            return self.existing_review_items

        @contextmanager
        def transaction(self):
            self.events.append(("transaction_enter", None))
            try:
                yield self
            finally:
                self.events.append(("transaction_exit", None))

        def clear_curated_tables(self, table_names):
            self.events.append(("clear", tuple(table_names)))

        def replace_table(self, table_name, columns, rows):
            self.events.append(("replace", table_name, tuple(columns), len(list(rows))))

        def append_review_queue_items(self, rows):
            row_list = list(rows)
            self.events.append(("append_review_queue_items", len(row_list)))

    repository = FakeRepository()

    run_rebuild(repository, review_threshold=0.8)

    clear_event = next(event for event in repository.events if event[0] == "clear")
    assert "rx_review_queue" in clear_event[1]
    assert ("append_review_queue_items", 2) in repository.events
    replace_tables = [event[1] for event in repository.events if event[0] == "replace"]
    assert replace_tables == [
        "rx_drug_products",
        "rx_ingredient_concepts",
        "rx_product_ingredients",
        "rx_name_variants",
        "rx_tfda_permits",
        "rx_nhi_tfda_map",
        "rx_atc_reference_latest",
        "rx_ingredient_tokens",
    ]

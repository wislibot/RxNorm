from __future__ import annotations

from datetime import date
from decimal import Decimal


def test_build_curated_payload_creates_products_mappings_and_latest_atc() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0001",
                "name_zh": "舊藥品",
                "name_en": "OLD DRUG",
                "ingredient_text": "Acetaminophen",
                "dose_form": "tablet",
                "strength_value": Decimal("250"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "N02BE01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第111111號",
                "price_nhi": Decimal("8"),
                "effective_start": date(2023, 1, 1),
                "effective_end": date(2023, 12, 31),
            },
            {
                "nhi_code": "A0001",
                "name_zh": "新藥品",
                "name_en": "NEW DRUG",
                "ingredient_text": "Acetaminophen",
                "dose_form": "tablet",
                "strength_value": Decimal("500"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "N02BE01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第111111號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            },
            {
                "nhi_code": "B0001",
                "name_zh": "複方藥品",
                "name_en": "COMBO DRUG",
                "ingredient_text": "Aspirin + Caffeine",
                "dose_form": "capsule",
                "strength_value": Decimal("1"),
                "strength_unit": "CAP",
                "combo_flag": "複方",
                "atc_code": "N02BA71",
                "tfda_link": "https://example.com/licenses/衛署藥製字第222222號",
                "price_nhi": Decimal("12"),
                "effective_start": date(2024, 2, 1),
                "effective_end": None,
            },
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第111111號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2026, 12, 31),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "新藥品",
                "product_name_en": "NEW DRUG",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "Acetaminophen",
                "applicant_name": "Applicant A",
                "applicant_address": "Address A",
                "applicant_tax_id": "12345678",
                "manufacturer_name": "Maker A",
                "manufacturer_site_address": "Plant A",
                "manufacturer_company_address": "Company A",
                "manufacturer_country": "TW",
            },
            {
                "tfda_permit_no": "衛署藥製字第222222號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 12, 31),
                "issue_date": date(2021, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "複方藥品",
                "product_name_en": "COMBO DRUG",
                "dosage_form": "capsule",
                "packaging": "box",
                "ingredient_text_tfda": "Aspirin ;; Caffeine",
                "applicant_name": "Applicant B",
                "applicant_address": "Address B",
                "applicant_tax_id": "87654321",
                "manufacturer_name": "Maker B",
                "manufacturer_site_address": "Plant B",
                "manufacturer_company_address": "Company B",
                "manufacturer_country": "TW",
            },
        ],
        "raw_tfda_permits_all": [],
        "raw_atc_ddd": [
            {
                "atc_code": "N02BE01",
                "atc_name": "PARACETAMOL OLD",
                "ddd": Decimal("2"),
                "uom": "g",
                "adm_r": "O",
                "note": "old",
                "snapshot_date": date(2025, 1, 1),
            },
            {
                "atc_code": "N02BE01",
                "atc_name": "PARACETAMOL",
                "ddd": Decimal("3"),
                "uom": "g",
                "adm_r": "O",
                "note": "latest",
                "snapshot_date": date(2026, 1, 1),
            },
        ],
    }

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    products = {row["nhi_code"]: row for row in payload["rx_drug_products"]}
    assert set(products) == {"A0001", "B0001"}
    assert products["A0001"]["name_zh"] == "新藥品"
    assert products["A0001"]["strength_value"] == Decimal("500")
    assert products["A0001"]["is_combo"] is False
    assert products["B0001"]["is_combo"] is True

    assert payload["rx_atc_reference_latest"] == [
        {
            "atc_code": "N02BE01",
            "atc_name": "PARACETAMOL",
            "ddd": Decimal("3"),
            "uom": "g",
            "adm_r": "O",
            "note": "latest",
            "snapshot_date": date(2026, 1, 1),
        }
    ]

    assert {row["tfda_permit_no"] for row in payload["rx_tfda_permits"]} == {
        "衛署藥製字第111111號",
        "衛署藥製字第222222號",
    }
    assert {(row["nhi_code"], row["tfda_permit_no"]) for row in payload["rx_nhi_tfda_map"]} == {
        ("A0001", "衛署藥製字第111111號"),
        ("B0001", "衛署藥製字第222222號"),
    }
    assert len(payload["rx_product_ingredients"]) == 6
    assert any(row["variant_text"] == "新藥品" for row in payload["rx_name_variants"])
    assert payload["rx_review_queue"] == []


def test_build_curated_payload_generates_tfda_mismatch_review_items() -> None:
    from etl.curated_build import build_curated_payload

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

    payload = build_curated_payload(raw_data, review_threshold=0.8)

    assert len(payload["rx_review_queue"]) == 1
    review_item = payload["rx_review_queue"][0]
    assert review_item["source"] == "tfda_mismatch"
    assert review_item["nhi_code"] == "A0002"
    assert review_item["tfda_permit_no"] == "衛署藥製字第333333號"
    assert review_item["status"] == "pending"
    assert review_item["confidence"] < Decimal("0.8")
    assert len(review_item["candidate_ingredient_ids"]) == 2


def test_build_curated_payload_ignores_strength_only_nhi_tfda_differences() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0003",
                "name_zh": "鎮靜藥品",
                "name_en": "DIAZEPAM TABLET",
                "ingredient_text": "DIAZEPAM 5 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("5"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "N05BA01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第444444號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第444444號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "鎮靜藥品",
                "product_name_en": "DIAZEPAM TABLET",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "DIAZEPAM",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_ignores_combo_strength_and_order_differences() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0004",
                "name_zh": "胃腸藥品",
                "name_en": "COMBO GI DRUG",
                "ingredient_text": (
                    "DICYCLOMINE HCL 5 MG/GM+ALUMINUM HYDROXIDE (=ALUMINA HYDRATED) 400 MG/GM+"
                    "MAGNESIUM OXIDE 200 MG/GM"
                ),
                "dose_form": "gel",
                "strength_value": Decimal("1"),
                "strength_unit": "GM",
                "combo_flag": "複方",
                "atc_code": "A02AB",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第555555號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第555555號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "胃腸藥品",
                "product_name_en": "COMBO GI DRUG",
                "dosage_form": "gel",
                "packaging": "box",
                "ingredient_text_tfda": (
                    "MAGNESIUM OXIDE ;; ALUMINUM HYDROXIDE (ALUMINA HYDRATED) ;; DICYCLOMINE HCL"
                ),
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_still_generates_true_mismatch_review_items() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0005",
                "name_zh": "真實不一致藥品",
                "name_en": "TRUE MISMATCH DRUG",
                "ingredient_text": "DIAZEPAM 5 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("5"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "N05BA01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第666666號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第666666號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "真實不一致藥品",
                "product_name_en": "TRUE MISMATCH DRUG",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "IBUPROFEN",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert len(payload["rx_review_queue"]) == 1
    assert payload["rx_review_queue"][0]["nhi_code"] == "A0005"
    assert payload["rx_review_queue"][0]["source"] == "tfda_mismatch"


def test_build_curated_payload_ignores_eq_to_parenthetical_synonyms() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0007",
                "name_zh": "麻黃鹼藥品",
                "name_en": "EPHEDRINE TABLET",
                "ingredient_text": "EPHEDRINE HCL 25 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("25"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "R01AA",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888888號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888888號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "麻黃鹼藥品",
                "product_name_en": "EPHEDRINE TABLET",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "EPHEDRINE HCL (EQ TO EPHEDRINE HYDROCHLORIDE)",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_ignores_casefolded_parenthetical_synonyms() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0008",
                "name_zh": "消炎藥品",
                "name_en": "INDOMETHACIN CAPSULE",
                "ingredient_text": "INDOMETHACIN 25 MG",
                "dose_form": "capsule",
                "strength_value": Decimal("25"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "M01AB01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888889號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888889號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "消炎藥品",
                "product_name_en": "INDOMETHACIN CAPSULE",
                "dosage_form": "capsule",
                "packaging": "box",
                "ingredient_text_tfda": "INDOMETHACIN (eq to Indometacin)",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_ignores_stereochemistry_marker_position_differences() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0009",
                "name_zh": "甲基麻黃鹼藥品",
                "name_en": "METHYLEPHEDRINE TABLET",
                "ingredient_text": "METHYLEPHEDRINE DL- HCL 25 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("25"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "R05DA",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888890號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888890號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "甲基麻黃鹼藥品",
                "product_name_en": "METHYLEPHEDRINE TABLET",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "DL-METHYLEPHEDRINE HCL",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_ignores_hcl_in_parentheses_vs_flat_salt_token() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0010",
                "name_zh": "氯丙嗪藥品",
                "name_en": "CHLORPROMAZINE TABLET",
                "ingredient_text": "CHLORPROMAZINE (HCL) 100 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("100"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "N05AA01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888891號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888891號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "氯丙嗪藥品",
                "product_name_en": "CHLORPROMAZINE TABLET",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "CHLORPROMAZINE HCL",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_ignores_sodium_in_parentheses_vs_flat_salt_token() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0011",
                "name_zh": "胺芐青黴素藥品",
                "name_en": "AMPICILLIN INJECTION",
                "ingredient_text": "AMPICILLIN (SODIUM) 500 MG",
                "dose_form": "injectable",
                "strength_value": Decimal("500"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "J01CA01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888892號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888892號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "胺芐青黴素藥品",
                "product_name_en": "AMPICILLIN INJECTION",
                "dosage_form": "injectable",
                "packaging": "box",
                "ingredient_text_tfda": "AMPICILLIN SODIUM",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_ignores_estolate_in_parentheses_vs_flat_salt_token() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0012",
                "name_zh": "紅黴素藥品",
                "name_en": "ERYTHROMYCIN TABLET",
                "ingredient_text": "ERYTHROMYCIN (ESTOLATE) 250 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("250"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "J01FA01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888893號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888893號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "紅黴素藥品",
                "product_name_en": "ERYTHROMYCIN TABLET",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "ERYTHROMYCIN ESTOLATE",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_ignores_2hcl_monohydrate_vs_2hcl() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0013",
                "name_zh": "胃復安藥品",
                "name_en": "METOCLOPRAMIDE TABLET",
                "ingredient_text": "METOCLOPRAMIDE (2HCL MONOHYDRATE) 5 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("5"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "A03FA01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888894號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888894號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "胃復安藥品",
                "product_name_en": "METOCLOPRAMIDE TABLET",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "METOCLOPRAMIDE 2HCL",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_compare_tokens_for_parenthetical_salts_include_root_and_flattened_form() -> None:
    from etl.curated_build import _compare_tokens_for_ingredient

    assert _compare_tokens_for_ingredient("CHLORPROMAZINE (HCL) 100 MG") == {
        "CHLORPROMAZINE",
        "CHLORPROMAZINE HCL",
    }
    assert _compare_tokens_for_ingredient("METOCLOPRAMIDE (2HCL MONOHYDRATE) 5 MG") == {
        "METOCLOPRAMIDE",
        "METOCLOPRAMIDE 2HCL",
    }


def test_build_curated_payload_ignores_etilefrin_vs_ethylphenylephrine_alias() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0014",
                "name_zh": "升壓藥品",
                "name_en": "ETILEFRIN TABLET",
                "ingredient_text": "ETILEFRIN HCL 5 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("5"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "C01CA",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888895號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888895號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "升壓藥品",
                "product_name_en": "ETILEFRIN TABLET",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "Ethylphenylephrine HCl",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_build_curated_payload_ignores_dipyrone_vs_sulpyrine_alias() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0015",
                "name_zh": "止痛藥品",
                "name_en": "DIPYRONE INJECTION",
                "ingredient_text": "DIPYRONE (=SULPYRIN) 250 MG/ML",
                "dose_form": "injectable",
                "strength_value": Decimal("250"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "N02BB",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第888896號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第888896號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "止痛藥品",
                "product_name_en": "DIPYRONE INJECTION",
                "dosage_form": "injectable",
                "packaging": "box",
                "ingredient_text_tfda": "SULPYRINE (EQ TO DIPYRONE)",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_review_queue"] == []


def test_strip_strength_and_formulation_tokens_preserves_alphanumeric_ingredient_names() -> None:
    from etl.curated_build import strip_strength_and_formulation_tokens

    cleaned = strip_strength_and_formulation_tokens("VITAMIN B12 100 MCG + VITAMIN D3 400 IU")

    assert cleaned == "VITAMIN B12 + VITAMIN D3"


def test_build_curated_payload_does_not_suppress_when_nhi_is_strict_subset_of_tfda() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0006",
                "name_zh": "部分成分藥品",
                "name_en": "PARTIAL MATCH DRUG",
                "ingredient_text": "DIAZEPAM 5 MG",
                "dose_form": "tablet",
                "strength_value": Decimal("5"),
                "strength_unit": "MG",
                "combo_flag": "單方",
                "atc_code": "N05BA01",
                "tfda_link": "https://example.com/?permitNo=衛署藥製字第777777號",
                "price_nhi": Decimal("10"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第777777號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2027, 1, 1),
                "issue_date": date(2020, 1, 1),
                "controlled_substance_level": None,
                "product_name_zh": "部分成分藥品",
                "product_name_en": "PARTIAL MATCH DRUG",
                "dosage_form": "tablet",
                "packaging": "box",
                "ingredient_text_tfda": "DIAZEPAM ;; CAFFEINE",
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

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert len(payload["rx_review_queue"]) == 1
    assert payload["rx_review_queue"][0]["nhi_code"] == "A0006"


def test_build_curated_payload_resolves_licid_links_to_tfda_permits() -> None:
    from etl.curated_build import build_curated_payload

    raw_data = {
        "raw_nhi_items": [
            {
                "nhi_code": "A0015",
                "name_zh": "眼光眼藥水",
                "name_en": "YEN KUANG EYE DROPS",
                "ingredient_text": "SULFAMETHOXAZOLE SODIUM",
                "dose_form": "點眼液劑",
                "strength_value": None,
                "strength_unit": None,
                "combo_flag": "單方",
                "atc_code": "S01AA",
                "tfda_link": "https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01000015",
                "price_nhi": Decimal("8"),
                "effective_start": date(2024, 1, 1),
                "effective_end": None,
            }
        ],
        "raw_tfda_permits_active": [
            {
                "tfda_permit_no": "衛署藥製字第000015號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2029, 7, 24),
                "issue_date": date(1971, 7, 24),
                "controlled_substance_level": None,
                "product_name_zh": "眼光眼藥水",
                "product_name_en": "YEN KUANG EYE DROPS",
                "dosage_form": "點眼液劑",
                "packaging": "塑膠瓶裝",
                "ingredient_text_tfda": "SULFAMETHOXAZOLE SODIUM",
                "applicant_name": "A",
                "applicant_address": "B",
                "applicant_tax_id": "1",
                "manufacturer_name": "C",
                "manufacturer_site_address": "D",
                "manufacturer_company_address": "E",
                "manufacturer_country": "TW",
            },
            {
                "tfda_permit_no": "衛部罕菌疫輸字第000015號",
                "cancel_status": "未註銷",
                "cancel_date": None,
                "expiry_date": date(2028, 12, 27),
                "issue_date": date(2013, 12, 27),
                "controlled_substance_level": None,
                "product_name_zh": "雪瑞素 400U",
                "product_name_en": "Cerezyme 400U",
                "dosage_form": "注射劑",
                "packaging": "盒裝",
                "ingredient_text_tfda": "LEVOCARNITINE",
                "applicant_name": "X",
                "applicant_address": "Y",
                "applicant_tax_id": "2",
                "manufacturer_name": "Z",
                "manufacturer_site_address": "P",
                "manufacturer_company_address": "Q",
                "manufacturer_country": "TW",
            },
        ],
        "raw_tfda_permits_all": [],
        "raw_atc_ddd": [],
    }

    payload = build_curated_payload(raw_data, review_threshold=0.6)

    assert payload["rx_nhi_tfda_map"] == [
        {
            "nhi_code": "A0015",
            "tfda_permit_no": "衛署藥製字第000015號",
            "link_source": "nhi_tfda_link",
            "created_at": payload["rx_nhi_tfda_map"][0]["created_at"],
        }
    ]

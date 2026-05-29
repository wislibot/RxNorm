from __future__ import annotations

from typing import Any

COVERAGE_DISCLAIMER_EN = (
    "DDI screening coverage is limited to medicines in the Taiwan curated dictionary. "
    "If some medicines could not be checked, confirm with a clinician/pharmacist."
)


class DdiCaseRepository:
    def __init__(self, connection) -> None:
        self.connection = connection

    def fetch_ingredient_ids_by_nhi_codes(self, nhi_codes: list[str]) -> dict[str, list[str]]:
        if not nhi_codes:
            return {}
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select nhi_code, ingredient_id::text as ingredient_id
                from public.rx_product_ingredients
                where nhi_code = any(%s)
                """,
                (nhi_codes,),
            )
            rows = cursor.fetchall()

        results: dict[str, list[str]] = {nhi_code: [] for nhi_code in nhi_codes}
        for nhi_code, ingredient_id in rows:
            results[str(nhi_code)].append(str(ingredient_id))
        return results

    def fetch_ingredient_concepts(self, ingredient_ids: list[str]) -> dict[str, dict[str, str]]:
        if not ingredient_ids:
            return {}
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select ingredient_id::text as ingredient_id, canonical_name
                from public.rx_ingredient_concepts
                where ingredient_id::text = any(%s)
                """,
                (ingredient_ids,),
            )
            rows = cursor.fetchall()
            column_names = [column.name if hasattr(column, "name") else column[0] for column in cursor.description]

        return {
            str(row_dict["ingredient_id"]): {
                "ingredient_id": str(row_dict["ingredient_id"]),
                "canonical_name": str(row_dict["canonical_name"]),
            }
            for row_dict in (dict(zip(column_names, row, strict=False)) for row in rows)
        }

    def fetch_interactions_for_pairs(self, ingredient_pairs: list[tuple[str, str]]) -> list[dict[str, str]]:
        if not ingredient_pairs:
            return []
        pair_keys = [f"{ingredient_a_id}|{ingredient_b_id}" for ingredient_a_id, ingredient_b_id in ingredient_pairs]
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select
                    p.ingredient_a_id::text as ingredient_a_id,
                    p.ingredient_b_id::text as ingredient_b_id,
                    p.severity,
                    t.patient_title_en,
                    t.patient_message_en,
                    t.staff_title_en,
                    t.staff_message_en,
                    t.recommended_action,
                    t.disclaimer as disclaimer_en
                from public.rx_ddi_pairs as p
                join public.rx_ddi_severity_templates as t
                  on t.severity = p.severity
                where (p.ingredient_a_id::text || '|' || p.ingredient_b_id::text) = any(%s)
                order by p.ingredient_a_id::text, p.ingredient_b_id::text
                """,
                (pair_keys,),
            )
            rows = cursor.fetchall()
            column_names = [column.name if hasattr(column, "name") else column[0] for column in cursor.description]

        return [
            {
                "ingredient_a_id": str(row_dict["ingredient_a_id"]),
                "ingredient_b_id": str(row_dict["ingredient_b_id"]),
                "severity": str(row_dict["severity"]),
                "patient_title_en": str(row_dict["patient_title_en"]),
                "patient_message_en": str(row_dict["patient_message_en"]),
                "staff_title_en": str(row_dict["staff_title_en"]),
                "staff_message_en": str(row_dict["staff_message_en"]),
                "recommended_action": str(row_dict["recommended_action"]),
                "disclaimer_en": str(row_dict["disclaimer_en"]),
            }
            for row_dict in (dict(zip(column_names, row, strict=False)) for row in rows)
        ]


def _dedupe_preserve_order(values: list[str] | None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        candidate = str(value).strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        result.append(candidate)
    return result


def _sort_checked_ingredients(ingredient_concepts: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    return sorted(
        ingredient_concepts.values(),
        key=lambda row: (str(row["canonical_name"]).casefold(), str(row["ingredient_id"])),
    )


def _build_unordered_pairs(ingredient_ids: list[str]) -> list[tuple[str, str]]:
    sorted_ids = sorted(set(ingredient_ids))
    pairs: list[tuple[str, str]] = []
    for index, ingredient_a_id in enumerate(sorted_ids):
        for ingredient_b_id in sorted_ids[index + 1 :]:
            pairs.append((ingredient_a_id, ingredient_b_id))
    return pairs


def evaluate_case_ddi(
    repository,
    *,
    nhi_codes: list[str] | None = None,
    ingredient_ids: list[str] | None = None,
    raw_unchecked_texts: list[str] | None = None,
) -> dict[str, Any]:
    unresolved_items: list[dict[str, str | None]] = []
    requested_nhi_codes = _dedupe_preserve_order(nhi_codes)
    requested_ingredient_ids = _dedupe_preserve_order(ingredient_ids)
    requested_raw_texts = _dedupe_preserve_order(raw_unchecked_texts)

    ingredient_sources: dict[str, str | None] = {}
    candidate_ingredient_ids: set[str] = set()

    if requested_nhi_codes:
        ingredients_by_nhi_code = repository.fetch_ingredient_ids_by_nhi_codes(requested_nhi_codes)
        for nhi_code in requested_nhi_codes:
            mapped_ingredient_ids = sorted(set(ingredients_by_nhi_code.get(nhi_code, [])))
            if not mapped_ingredient_ids:
                unresolved_items.append(
                    {"reason": "unknown_product", "raw_text": None, "nhi_code": nhi_code}
                )
                continue
            for ingredient_id in mapped_ingredient_ids:
                candidate_ingredient_ids.add(ingredient_id)
                ingredient_sources.setdefault(ingredient_id, nhi_code)

    for ingredient_id in requested_ingredient_ids:
        candidate_ingredient_ids.add(ingredient_id)
        ingredient_sources.setdefault(ingredient_id, None)

    ingredient_concepts = repository.fetch_ingredient_concepts(sorted(candidate_ingredient_ids))
    for ingredient_id in sorted(candidate_ingredient_ids):
        if ingredient_id in ingredient_concepts:
            continue
        unresolved_items.append(
            {
                "reason": "missing_ingredient_concept",
                "raw_text": ingredient_id,
                "nhi_code": ingredient_sources.get(ingredient_id),
            }
        )

    for raw_text in requested_raw_texts:
        unresolved_items.append(
            {"reason": "unknown_product", "raw_text": raw_text, "nhi_code": None}
        )

    checked_ingredients = _sort_checked_ingredients(ingredient_concepts)
    checked_ingredient_ids = [str(row["ingredient_id"]) for row in checked_ingredients]
    interactions = repository.fetch_interactions_for_pairs(_build_unordered_pairs(checked_ingredient_ids))

    return {
        "checked_ingredient_count": len(checked_ingredients),
        "unchecked_ingredient_count": len(unresolved_items),
        "checked_ingredients": checked_ingredients,
        "unchecked_items": unresolved_items,
        "interactions_found_count": len(interactions),
        "interactions": interactions,
        "coverage_disclaimer_en": COVERAGE_DISCLAIMER_EN,
    }

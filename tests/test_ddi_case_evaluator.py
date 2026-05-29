from __future__ import annotations


class FakeDdiCaseRepository:
    def __init__(
        self,
        *,
        ingredients_by_nhi_code: dict[str, list[str]] | None = None,
        ingredient_concepts: dict[str, dict[str, str]] | None = None,
        interactions_by_pair: dict[tuple[str, str], dict[str, str]] | None = None,
    ) -> None:
        self.ingredients_by_nhi_code = ingredients_by_nhi_code or {}
        self.ingredient_concepts = ingredient_concepts or {}
        self.interactions_by_pair = interactions_by_pair or {}
        self.requested_pairs: list[tuple[str, str]] = []

    def fetch_ingredient_ids_by_nhi_codes(self, nhi_codes: list[str]) -> dict[str, list[str]]:
        return {
            nhi_code: list(self.ingredients_by_nhi_code.get(nhi_code, []))
            for nhi_code in nhi_codes
        }

    def fetch_ingredient_concepts(self, ingredient_ids: list[str]) -> dict[str, dict[str, str]]:
        return {
            ingredient_id: dict(self.ingredient_concepts[ingredient_id])
            for ingredient_id in ingredient_ids
            if ingredient_id in self.ingredient_concepts
        }

    def fetch_interactions_for_pairs(self, ingredient_pairs: list[tuple[str, str]]) -> list[dict[str, str]]:
        self.requested_pairs = list(ingredient_pairs)
        rows: list[dict[str, str]] = []
        for ingredient_pair in ingredient_pairs:
            if ingredient_pair in self.interactions_by_pair:
                rows.append(dict(self.interactions_by_pair[ingredient_pair]))
        return rows


def test_evaluate_case_ddi_counts_unresolved_nhi_codes_as_unchecked() -> None:
    from etl.ddi_case_evaluator import evaluate_case_ddi

    repository = FakeDdiCaseRepository(
        ingredients_by_nhi_code={
            "NHI002": ["ing-b", "ing-a"],
            "NHI001": ["ing-a"],
        },
        ingredient_concepts={
            "ing-a": {"ingredient_id": "ing-a", "canonical_name": "Alpha"},
            "ing-b": {"ingredient_id": "ing-b", "canonical_name": "Beta"},
        },
    )

    result = evaluate_case_ddi(repository, nhi_codes=["NHI999", "NHI002", "NHI001"])

    assert result["checked_ingredient_count"] == 2
    assert result["unchecked_ingredient_count"] == 1
    assert result["checked_ingredients"] == [
        {"ingredient_id": "ing-a", "canonical_name": "Alpha"},
        {"ingredient_id": "ing-b", "canonical_name": "Beta"},
    ]
    assert result["unchecked_items"] == [
        {"reason": "unknown_product", "raw_text": None, "nhi_code": "NHI999"}
    ]
    assert repository.requested_pairs == [("ing-a", "ing-b")]


def test_evaluate_case_ddi_returns_interactions_with_template_fields() -> None:
    from etl.ddi_case_evaluator import evaluate_case_ddi

    repository = FakeDdiCaseRepository(
        ingredient_concepts={
            "ing-a": {"ingredient_id": "ing-a", "canonical_name": "Alpha"},
            "ing-b": {"ingredient_id": "ing-b", "canonical_name": "Beta"},
        },
        interactions_by_pair={
            ("ing-a", "ing-b"): {
                "ingredient_a_id": "ing-a",
                "ingredient_b_id": "ing-b",
                "severity": "major",
                "patient_title_en": "High risk interaction",
                "patient_message_en": "Patient warning",
                "staff_title_en": "High risk DDI",
                "staff_message_en": "Staff warning",
                "recommended_action": "avoid_or_confirm",
                "disclaimer_en": "Clinical judgment required.",
            }
        },
    )

    result = evaluate_case_ddi(repository, ingredient_ids=["ing-b", "ing-a"])

    assert repository.requested_pairs == [("ing-a", "ing-b")]
    assert result["interactions_found_count"] == 1
    assert result["interactions"] == [
        {
            "ingredient_a_id": "ing-a",
            "ingredient_b_id": "ing-b",
            "severity": "major",
            "patient_title_en": "High risk interaction",
            "patient_message_en": "Patient warning",
            "staff_title_en": "High risk DDI",
            "staff_message_en": "Staff warning",
            "recommended_action": "avoid_or_confirm",
            "disclaimer_en": "Clinical judgment required.",
        }
    ]


def test_evaluate_case_ddi_returns_counts_and_disclaimer_when_no_interactions_exist() -> None:
    from etl.ddi_case_evaluator import COVERAGE_DISCLAIMER_EN, evaluate_case_ddi

    repository = FakeDdiCaseRepository(
        ingredient_concepts={
            "ing-a": {"ingredient_id": "ing-a", "canonical_name": "Alpha"},
            "ing-c": {"ingredient_id": "ing-c", "canonical_name": "Gamma"},
        }
    )

    result = evaluate_case_ddi(
        repository,
        ingredient_ids=["ing-c", "ing-a"],
        raw_unchecked_texts=["blurred OCR token"],
    )

    assert result["checked_ingredient_count"] == 2
    assert result["unchecked_ingredient_count"] == 1
    assert result["interactions_found_count"] == 0
    assert result["interactions"] == []
    assert result["unchecked_items"] == [
        {"reason": "unknown_product", "raw_text": "blurred OCR token", "nhi_code": None}
    ]
    assert result["coverage_disclaimer_en"] == COVERAGE_DISCLAIMER_EN

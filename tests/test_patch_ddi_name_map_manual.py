from __future__ import annotations


class FakeManualPatchRepository:
    def __init__(self, existing_rows: dict[str, dict[str, object]] | None = None) -> None:
        self.rows = {key: dict(value) for key, value in (existing_rows or {}).items()}

    def fetch_existing_name_map(self) -> dict[str, dict[str, object]]:
        return {key: dict(value) for key, value in self.rows.items()}

    def upsert_name_map_rows(self, rows: list[dict[str, object]]) -> None:
        for row in rows:
            current = dict(self.rows.get(str(row["ddinter_drug_name"]), {}))
            current.update(row)
            self.rows[str(row["ddinter_drug_name"])] = current


def test_apply_manual_ddi_name_map_patch_inserts_expected_manual_row() -> None:
    from etl.patch_ddi_name_map_manual import MANUAL_DDI_NAME_MAP_PATCHES, apply_manual_ddi_name_map_patch

    repository = FakeManualPatchRepository()

    result = apply_manual_ddi_name_map_patch(repository)

    assert result["patched_rows"] == len(MANUAL_DDI_NAME_MAP_PATCHES)
    promethazine = repository.rows["Promethazine"]
    assert promethazine["ingredient_id"] == "58a8dc7a-bef0-56e1-a837-4dadca9a7f51"
    assert promethazine["match_method"] == "manual"
    assert promethazine["notes"] == "manual map (base-name->salt/hydrate/form in TW concepts)"

    doxepin_topical = repository.rows["Doxepin (topical)"]
    assert doxepin_topical["ingredient_id"] == "30ce1b8d-9ee6-59a4-bb90-f194ffd4b8bb"
    assert doxepin_topical["match_method"] == "manual"


def test_apply_manual_ddi_name_map_patch_does_not_override_existing_mapping_without_force() -> None:
    from etl.patch_ddi_name_map_manual import MANUAL_DDI_NAME_MAP_PATCHES, apply_manual_ddi_name_map_patch

    repository = FakeManualPatchRepository(
        existing_rows={
            "Promethazine": {
                "ddinter_drug_name": "Promethazine",
                "ddinter_ids": "DDInter1533",
                "occurrences_in_pairs": 2088,
                "ingredient_id": "existing-ingredient-id",
                "match_method": "manual",
                "notes": "existing note",
            }
        }
    )

    result = apply_manual_ddi_name_map_patch(repository, force=False)

    assert result["total_rows"] == len(MANUAL_DDI_NAME_MAP_PATCHES)
    assert result["patched_rows"] == len(MANUAL_DDI_NAME_MAP_PATCHES) - 1
    assert result["skipped_rows"] == 1
    assert repository.rows["Promethazine"]["ingredient_id"] == "existing-ingredient-id"
    assert repository.rows["Promethazine"]["notes"] == "existing note"
    assert repository.rows["Warfarin"]["ingredient_id"] == "85f17a1f-ce4f-56b1-8e93-da323b8e9767"
    assert repository.rows["Pasireotide"]["ingredient_id"] == "fafa18d7-ec0a-5c9b-9514-1cab51e8caf7"


def test_apply_manual_ddi_name_map_patch_overrides_existing_mapping_with_force() -> None:
    from etl.patch_ddi_name_map_manual import MANUAL_DDI_NAME_MAP_PATCHES, apply_manual_ddi_name_map_patch

    repository = FakeManualPatchRepository(
        existing_rows={
            "Warfarin": {
                "ddinter_drug_name": "Warfarin",
                "ddinter_ids": "DDInter1951",
                "occurrences_in_pairs": 823,
                "ingredient_id": "old-warfarin-id",
                "match_method": "exact_canonical",
                "notes": "old note",
            }
        }
    )

    result = apply_manual_ddi_name_map_patch(repository, force=True)

    assert result["total_rows"] == len(MANUAL_DDI_NAME_MAP_PATCHES)
    assert result["patched_rows"] == len(MANUAL_DDI_NAME_MAP_PATCHES)
    assert result["skipped_rows"] == 0
    warfarin = repository.rows["Warfarin"]
    assert warfarin["ingredient_id"] == "85f17a1f-ce4f-56b1-8e93-da323b8e9767"
    assert warfarin["match_method"] == "manual"
    assert warfarin["notes"] == "manual map (base-name->salt/hydrate/form in TW concepts)"

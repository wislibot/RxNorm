# Option A Follow-Up: Flagged Hydrate/Salt Equivalence

This follow-up is intentionally **not implemented** in the current pass.

## Goal

Reduce remaining `tfda_mismatch` noise by allowing optional compare-time equivalence for:

- hydrates: `MONOHYDRATE`, `DIHYDRATE`, `TRIHYDRATE`, `HEMIHYDRATE`, `ANHYDROUS`, `xH2O`
- common salt forms: `HCL`, `HYDROCHLORIDE`, `SODIUM`, `POTASSIUM`, `CALCIUM`, `MESYLATE`, `BESYLATE`, `TARTRATE`

## Required Flags

- `STRICT_COMPARE=true` by default
- `EQUIV_HYDRATES=false` by default
- `EQUIV_SALTS=false` by default

## Scope

- Apply equivalence only in compare-token generation.
- Do not change canonical stored names in curated tables.
- Keep strict mode behavior unchanged unless flags are explicitly enabled.

## Acceptance Criteria

- Strict mode reproduces the current baseline mismatch count.
- Enabling flags lowers `tfda_mismatch` in an explainable way.
- QC output reports before/after queue deltas and example rows that stop mismatching.
- True multi-ingredient mismatches remain reviewable.

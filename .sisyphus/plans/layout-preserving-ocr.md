# Plan: Layout-Preserving OCR → qwen Field Extraction

## Context

The OCR server (`tools/ocr_server/`) runs PaddleOCR PP-StructureV3, which produces per-element bounding boxes, then **flattens everything to a 1-D string** before calling Groq qwen. The LLM never sees geometry, causing two unrecoverable failure classes:

1. **Column collapse/swap** — Two-column rows (physician left, pharmacist right) flatten to `林 王` with labels floating elsewhere. qwen pairs Pharmacist→王 (wrong).
2. **Over-capture** — Free-floating centered text (disclaimers) attaches to whatever field is textually nearest, landing in `warnings`.

Fields backed by drug/brand matching self-heal; pure free-text fields (physician, pharmacist, warnings) have no backstop. Prompt tuning has hit its ceiling because the distinguishing signal (x-position/column) is gone before qwen runs.

**Goal:** Feed qwen a layout-preserving serialization from bboxes already produced, so label↔value pairing keys off geometry. Add an `other` sink for ambiguous text.

---

## Change 1 — New module `tools/ocr_server/app/layout.py`

**File:** `tools/ocr_server/app/layout.py` (new, ~60 lines)

**Function:** `serialize_layout(elements: list[OcrElement], page_width: int) -> str`

### Algorithm

1. **Drop noise** — Skip QR/icon elements using the same heuristic as the mobile side (`apps/mobile/src/ocr/ocr.ts:73-84`):
   - `len(text.strip()) <= 2` AND
   - bbox roughly square (aspect 0.7–1.4) AND
   - large (w ≥ 40px, h ≥ 40px)

2. **Row clustering (resolution-independent)**
   - Compute `cy = (y1+y2)/2` and `h = y2-y1` for each element
   - Sort by `cy`
   - `row_tol = 0.6 * median(h)` — relative tolerance survives different photo resolutions
   - Walk sorted elements; an element joins the current row if `abs(cy - row_running_mean_cy) <= row_tol`, else start a new row

3. **Column breaks within a row**
   - Sort row's elements by `x1`
   - Insert column separator when `(e.x1 - prev.x2) > col_gap`, where `col_gap = 0.06 * page_width`

4. **Render**
   - One line per row
   - Cells joined by `" "`
   - Column break rendered as `" | "`

### Worked example (台南 bag)

Before (flat, broken):
```
處方医師
調劑藥師
林 王
Physiciam
Pharmacist
```

After (layout-preserving):
```
處方醫師 王○○ | 調劑藥師 林○○
Physiciam | Pharmacist
```

### Key imports
- `statistics.median` (stdlib, no new dependency)
- `app.schemas.OcrElement` (existing)

---

## Change 2 — `tools/ocr_server/app/paddle_parser.py`

**File:** `tools/ocr_server/app/paddle_parser.py` (modify, ~5 lines changed)

### Current code (lines 275-282)
```python
raw_text = "\n".join(el.text for el in elements)
...
case_fields = await extract_fields_with_groq(raw_text)
```

### New code
```python
from .layout import serialize_layout

raw_text = "\n".join(el.text for el in elements)         # keep for audit/frontend
layout_text = serialize_layout(elements, img_width)       # new
...
case_fields = await extract_fields_with_groq(layout_text) # was: raw_text
```

- `raw_text` stays in the response (elements + raw_text both survive to frontend)
- Only the string **sent to qwen** changes

---

## Change 3 — `tools/ocr_server/app/groq_extractor.py` prompt update

**File:** `tools/ocr_server/app/groq_extractor.py` (modify prompt + schema)

### New prompt rules (add after existing CRITICAL RULES, before field labels)

```
9. INPUT IS A SPATIAL LAYOUT. Each line is one visual row.
   Within a row, cells are separated by " | " and ordered left-to-right.
   A value is normally the cell to the RIGHT of its label, or the cell
   BELOW it on the next row.
10. A ROW MAY HOLD TWO INDEPENDENT PAIRS. When a row contains a left
    pair and a right pair (separated by " | "), pair each label with
    the value in the SAME COLUMN BAND. Never pair a left-column label
    with a right-column value.
11. PHYSICIAN vs PHARMACIST BY COLUMN. 處方醫師 / Physician is the
    LEFT pair; 調劑藥師 / Pharmacist is the RIGHT pair. Assign by
    column position, ignoring which name was emitted first.
12. UNSIGNED SINK. If text cannot be confidently attached to a labeled
    field — e.g. a centered standalone sentence with no adjacent label,
    footer/contact lines — put it in an "other" array. Do NOT force it
    into warnings or sideEffects. Leaving a field null is correct and
    preferred over a wrong value.
13. FIELD BOUNDARIES STOP AT THE NEXT LABEL. A field's value is only
    the text in the same row/column as its label, up to the next label
    or the next free-floating row.
```

### JSON schema update

Change from 16 keys to 17 — add `"other": string[]`:

```json
{
  "patientName": string | null,
  ...existing 16 fields...,
  "other": string[]
}
```

### schemas.py

`ParsedResult.case_fields` is `Optional[Dict[str, Any]]` — no type change needed. The dict simply gains an `other` key. But document this in a comment.

---

## Change 4 — Regression tests

**File:** `tools/ocr_server/tests/test_groq_extractor.py` (add tests)

### 4a. Unit test for `serialize_layout` (no LLM)

**New file:** `tools/ocr_server/tests/test_layout.py`

Test cases:
- **Two-column row with QR noise:** Synthetic elements for `處方醫師 王○○ | 調劑藥師 林○○` plus a QR box element. Assert QR is dropped, output is `處方醫師 王○○ | 調劑藥師 林○○`.
- **Single-column row:** Elements on one line, no column break. Assert no ` | ` in output.
- **Multiple rows:** Two separate rows at different y positions. Assert newline-separated.
- **Empty input:** Empty element list returns `""`.

### 4b. Integration test in `test_groq_extractor.py`

Test with layout-formatted signature region fixture. Assert:
- `physicianName == "王○○"` (left column)
- `pharmacistName == "林○○"` (right column)
- Disclaimer string lands in `other`, `warnings` contains only `開封後僅能存放3個月`

---

## Files to Create/Modify

| File | Action | Lines (est.) |
|------|--------|-------------|
| `tools/ocr_server/app/layout.py` | **Create** | ~60 |
| `tools/ocr_server/app/paddle_parser.py` | Modify | ~5 |
| `tools/ocr_server/app/groq_extractor.py` | Modify | ~30 (prompt + schema) |
| `tools/ocr_server/tests/test_layout.py` | **Create** | ~80 |
| `tools/ocr_server/tests/test_groq_extractor.py` | Modify | ~40 |

**No changes to:** mobile app, schemas.py (type is already Dict[str, Any]), main.py, security.py, requirements.txt (no new deps).

---

## Verification

1. Run existing tests: `pytest tools/ocr_server/tests/ -v` — all 18 existing tests must still pass
2. Run new layout tests: `pytest tools/ocr_server/tests/test_layout.py -v`
3. Run new integration test: `pytest tools/ocr_server/tests/test_groq_extractor.py -v -k "layout"`
4. Manual validation against all three known bag templates (台南醫院, 台北慈濟, 台東基督教):
   - Physician/Pharmacist no longer swap
   - Disclaimer no longer in `warnings`
   - 總量/Quantity no longer bleeds into drug name
5. Tune `row_tol` (0.6×median height) and `col_gap` (0.06×page_width) if rows merge incorrectly or columns split incorrectly

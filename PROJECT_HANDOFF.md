# RxNorm Taiwan — Project Handoff Document

> Generated 2026-05-29. All code pushed to `https://github.com/wislibot/RxNorm.git` (master).

---

## 1. Project Overview

**RxNorm Taiwan** is a mobile app (React Native / Expo SDK 54) that lets patients scan Taiwanese hospital medication bags (藥袋), extract structured medication data via OCR + LLM, match medications against a Taiwan RxNorm drug database (Supabase), and screen for drug-drug interactions (DDI).

**Architecture:**

```
Mobile App (Expo/React Native)
    │
    ├── POST /parse (multipart image) ──► FastAPI OCR Server (Windows 11, RTX 3050 Ti)
    │                                        ├── PaddleOCR PP-StructureV3 → OCR elements
    │                                        └── Groq LLM (qwen/qwen3-32b) → case_fields JSON
    │
    ├── Supabase RPCs ──► rx_match_medication_lines, rx_match_brand_lines, rx_get_ddi_for_ingredients
    │
    └── Supabase DB ──► rx_cases, rx_detected_items, rx_case_ddis, rx_medication_lines, rx_brand_lines
```

---

## 2. Key Files & Their Purposes

### 2.1 OCR Server (`tools/ocr_server/`)

| File | Purpose | Recent Changes |
|---|---|---|
| `app/main.py` | FastAPI entry point, `/parse` and `/health` endpoints | Handles multipart upload → OCR → Groq → JSON response |
| `app/paddle_parser.py` | PP-StructureV3 OCR pipeline | **Enabled `use_doc_unwarping=True`**; calls `extract_fields_with_groq()` after OCR; builds `raw_text` from elements, sets `extraction_engine`/`extraction_fallback` in `ParsedResult` |
| `app/groq_extractor.py` | Groq LLM field extraction | **Extensive prompt engineering** (see §4); `load_dotenv()` at import; <think> tag stripping; newline sanitization; `max_completion_tokens=2000`; no `response_format` |
| `app/schemas.py` | Pydantic models for `/parse` response | Added `case_fields`, `extraction_engine`, `extraction_fallback` to `ParsedResult` |
| `app/security.py` | API key authentication (optional) | `require_api_key` — skips if `OCR_API_KEY` env var is empty |
| `.env.example` | Template for environment variables | `GROQ_API_KEY`, `GROQ_MODEL`, `PORT` |
| `.env` | Actual secrets (git-ignored) | Created manually by user from `.env.example` |
| `.gitignore` | Excludes from git | `.env`, `*.env`, `.venv/`, `__pycache__/`, `*.pyc` |
| `tests/test_groq_extractor.py` | 18 tests for Groq extraction | Markdown fence stripping, JSON parsing, newline sanitization, think tag stripping (closed & unclosed), pharmacist/physician separation |

### 2.2 Mobile App (`apps/mobile/src/`)

| File | Purpose | Recent Changes |
|---|---|---|
| `api/case.ts` | `createCase()` — the main case creation pipeline | **Added LLM path**: `mapRemoteCaseFields()` from `modelData.case_fields`; `buildStoredOcrSections()` accepts optional `remoteCaseFields` param; falls back to `extractCaseFields()` (regex) if null |
| `ocr/ocr.ts` | OCR utilities, remote OCR call, `mergeAdjacentLines()` | **Added `mapRemoteCaseFields()`** — maps 16-field `RemoteCaseFields` to `CaseFields` shape; wraps `indications`/`warnings`/`sideEffects` in arrays |
| `ocr/types.ts` | OCR type definitions | **Added `RemoteCaseFields`** (16 string|null fields) + `case_fields`, `extraction_engine`, `extraction_fallback` to `RemoteOcrResult` |
| `types/caseFields.ts` | `CaseFields` type definition | **Added `prescriptionNo`** and **`useBefore`** optional fields |
| `ocr/structuredCaseExtractor.ts` | **UNTOCUHED** — regex-based field extraction | Kept as silent fallback; invoked only when `remoteCaseFields` is null |
| `ocr/sectionMapper.ts` | **UNTOUCHED** — maps OCR elements to semantic sections | |
| `ocr/groupMedicationLines.ts` | **UNTOUCHED** — groups OCR lines into medication items | |
| `ocr/sortReadingOrder.ts` | **UNTOUCHED** — reading-order sorting | |

---

## 3. Data Flow: `/parse` Request → Case Creation

```
1. User scans medication bag image
2. Mobile app POSTs image to FastAPI /parse
3. Server runs PP-StructureV3 OCR → elements[]
4. Server builds raw_text = "\n".join(el.text for el in elements)
5. Server calls extract_fields_with_groq(raw_text)
   ├── Groq LLM (qwen/qwen3-32b) returns 16-field JSON
   ├── Sanitization: strip ```fences → strip <think> tags → replace \r\n/\n/\r with space → json.loads
   └── Returns dict or None (never raises)
6. Server returns ParsedResult:
   {
     "engine": "paddleocr-ppstructurev3",
     "version": "v1",
     "pages": [{ "width": ..., "height": ..., "elements": [...] }],
     "case_fields": { "patientName": "王小花", ... } | null,
     "extraction_engine": "llm" | "none",
     "extraction_fallback": true | false
   }
7. Mobile app receives response → modelData stored in sectionedOcr
8. createCase() calls mapRemoteCaseFields(modelData.case_fields)
   ├── If not null → used directly (LLM path)
   └── If null → falls back to extractCaseFields() (regex path)
9. Medicine matching (rx_match_medication_lines, rx_match_brand_lines RPCs) — IDENTICAL for both paths
10. DDI screening — IDENTICAL
11. Photo upload — IDENTICAL
12. DB insert → rx_cases row
```

---

## 4. Groq Prompt Engineering (Evolution)

### v1 — Basic Prompt
- 25 lines, generic rules
- Single label per field
- Used `response_format: {type: "json_object"}`

### v2 — Issue Fixes
**Problems found with 3 real medication bags:**

| Issue | Bag | Symptom | Fix |
|---|---|---|---|
| **Field bleeding** | Bag 2 (台北慈濟醫院) | Dosage icon text (0.5, 1, 2, 3, Morning, Half, etc.) appeared in `sideEffects` | Added CRITICAL RULE #3: explicit list of dosage icon noise to IGNORE |
| **JSON malformed** | Intermittent | Multi-line warnings with literal newlines broke `json.loads` | Added `content.replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ')` before parsing |
| **Label variants** | Bag 3 (台東基督教醫院) | 藥名與含量, 臨床用途, 用法與途經, 藥品外觀描述, 總量(Quantity) | Added per-field sections with Standard + Variants labels (14 fields) |
| **Pharmacist/Physician confusion** | Bag 1 | Pharmacist name captured as Physician | Added Rules #7/#8: label-only extraction, "NEVER mix the two" |
| **JSON validate failed (400)** | All bags | `response_format: {type: "json_object"}` rejected output | **Removed `response_format`** — prompt instruction + sanitization sufficient |
| **Think tags** | All bags | Qwen wraps output in `<think>...</think>` reasoning blocks | **Regex stripping**: `_THINK_TAG_RE` for closed tags, `_THINK_PREFIX_RE` for unclosed, fallback `content.find('{')` |

### v3 — Current Prompt (~140 lines)
- CRITICAL RULES: 8 explicit rules covering field separation, dosage icon noise, pharmacist/physician distinction
- Per-field documentation: 14 fields with Standard + Variants labels
- Explicit instruction: "Do NOT use <think> tags or any reasoning"
- Output instruction: "join lines with a space — do NOT use newline characters"
- Model: `qwen/qwen3-32b` (configurable via `GROQ_MODEL` env var)
- Temperature: 0 (deterministic)

---

## 5. Environment Setup

### OCR Server (`tools/ocr_server/`)

```powershell
# 1. Create virtual environment
python -m venv .venv
.\.venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create .env from template
cp .env.example .env

# 4. Edit .env with your Groq API key
# GROQ_API_KEY=gsk_your_actual_key_here
# Get key at: https://console.groq.com/keys

# 5. Start server
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Mobile App (`apps/mobile/`)

```powershell
npm install
npx expo start
```

Required environment for mobile (in Expo config / `.env`):
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_OCR_SERVER_URL`
- `EXPO_PUBLIC_OCR_SERVER_API_KEY` (if server auth enabled)

---

## 6. Groq API Details

| Parameter | Value |
|---|---|
| Model | `qwen/qwen3-32b` (from Groq console) |
| Default in code | `os.environ.get("GROQ_MODEL", "qwen/qwen3-32b")` |
| Timeout | 15 seconds |
| Max tokens | 2000 (increased from 800; needed because Qwen uses tokens for thinking) |
| Temperature | 0 |
| `response_format` | **REMOVED** (caused 400 errors with long prompts) |

Note: Qwen3-8b is **NOT** available on Groq. Only `qwen/qwen3-32b` is listed.

---

## 7. The 16 Extracted Fields

| Field | Type | Source Label(s) |
|---|---|---|
| `patientName` | string\|null | 姓名, Name, 病患姓名 |
| `patientSex` | "M"\|"F"\|null | 性別 (男→M, 女→F) |
| `prescriptionNo` | string\|null | 領藥號, Prescription No., 處方號 |
| `medicationName` | string\|null | 藥名, 藥名與含量, Medication |
| `quantity` | string\|null | 總量, Quantity, 總量(Quantity) |
| `directions` | string\|null | 用法, 用法與途經, Instruction |
| `indications` | string\|null | 用途, 臨床用途, Indications |
| `warnings` | string\|null | 警語與注意事項, 警語, Warnings |
| `sideEffects` | string\|null | 副作用, Side effects |
| `appearance` | string\|null | 外觀, 藥品外觀描述, Appearance |
| `pharmacyName` | string\|null | From document header |
| `pharmacyAddress` | string\|null | 地址, Address |
| `pharmacistName` | string\|null | 調劑藥師, Pharmacist (DISPENSING) |
| `physicianName` | string\|null | 處方醫師, Physician (PRESCRIBING) |
| `dispensingDate` | string\|null | 調劑日期, Dispensing date (YYYY-MM-DD) |
| `useBefore` | string\|null | 處方期限, Use Before, Expiry date |

---

## 8. Sanitization Pipeline (groq_extractor.py)

The raw LLM response goes through this pipeline before `json.loads()`:

```
Raw response from Groq
    │
    ├── 1. _strip_markdown_fences()     — strips ```json ... ``` wrappers
    ├── 2. _THINK_TAG_RE.sub("", ...)     — strips <think>...</think> (closed)
    ├── 3. _THINK_PREFIX_RE.sub("{", ...) — strips <think>...{ (unclosed, keeps {)
    ├── 4. Fallback: if '<think>' still in content, find '{' and slice from there
    ├── 5. .replace('\r\n', ' ')         — CRLF → space
    ├── 6. .replace('\n', ' ')           — LF → space
    ├── 7. .replace('\r', ' ')           — CR → space
    │
    └── json.loads()
```

All errors return `None` — the pipeline never crashes.

---

## 9. Mobile Field Mapping (mapRemoteCaseFields)

`RemoteCaseFields` (LLM output) → `Partial<CaseFields>` (mobile app type):

| Remote Field | CaseFields Destination | Notes |
|---|---|---|
| `patientName` | `patientName` | Direct passthrough |
| `patientSex` | `patientSex` | "M"→"M", "F"→"F" |
| `prescriptionNo` | `prescriptionNo` | New field added to CaseFields |
| `medicationName` | *(skipped)* | Not in CaseFields; used for display elsewhere |
| `quantity` | `quantity` | Direct passthrough |
| `directions` | `directions` | Direct passthrough |
| `indications` | `indications` | **Wrapped in array:** `[value]` |
| `warnings` | `warnings` | **Wrapped in array:** `[value]` |
| `sideEffects` | `sideEffects` | **Wrapped in array:** `[value]` |
| `appearance` | *(skipped)* | Not in CaseFields |
| `pharmacyName` | `pharmacyName` | Direct passthrough |
| `pharmacyAddress` | `pharmacyAddress` | Direct passthrough |
| `pharmacistName` | `pharmacistName` | Direct passthrough |
| `physicianName` | `physicianName` | Direct passthrough |
| `dispensingDate` | `dispensingDate` | Direct passthrough |
| `useBefore` | `useBefore` | New field added to CaseFields |

---

## 10. Test Results

### Python (tools/ocr_server/tests/)
```
18 passed — test_groq_extractor.py
  - Markdown fence stripping: 4 tests
  - Groq field extraction: 4 tests
  - Error handling: 4 tests
  - Newline sanitization: 3 tests
  - Think tag stripping: 2 tests (closed + unclosed)
  - Pharmacist/physician separation: 1 test
```

### Mobile (apps/mobile/src/)
```
OCR tests:       54/54 passed  (ocr.test.ts — mergeAdjacentLines, mapRemoteCaseFields, etc.)
Case API tests:   4/4 passed  (case.test.ts — LLM path, regex fallback, same RPC calls)
Full suite:     162/166 passed (4 pre-existing React component render timeouts — unrelated)
```

---

## 11. Files NOT to Modify

These files are confirmed fully decoupled from the field extraction pipeline and must remain untouched:

- `apps/mobile/src/ocr/structuredCaseExtractor.ts` — regex fallback, kept as-is
- `apps/mobile/src/ocr/sectionMapper.ts` — OCR section mapping
- `apps/mobile/src/ocr/groupMedicationLines.ts` — medication line grouping
- `apps/mobile/src/ocr/sortReadingOrder.ts` — reading order sorting
- Medicine matching RPCs (`rx_match_medication_lines`, `rx_match_brand_lines`)
- DDI screening pipeline
- Photo upload logic

---

## 12. Known Quirks & Gotchas

1. **Qwen outputs `<think>` tags**: The model wraps responses in reasoning blocks. Our sanitization strips them, but the model sometimes doesn't close the tag. We handle both cases.

2. **`response_format` breaks long prompts**: Setting `response_format: {type: "json_object"}` with the 140-line prompt caused 400 errors (`json_validate_failed`). Removed — prompt instruction alone is sufficient.

3. **Server must be restarted for code changes**: FastAPI doesn't auto-reload `.py` changes in the `app/` package by default. Always Ctrl+C and restart.

4. **`load_dotenv()` runs at import time**: In `groq_extractor.py`, `load_dotenv()` is called at the top of the module (after `from __future__ import annotations`). This populates `os.environ` before `AsyncGroq` is imported. The `.env` file must exist at `tools/ocr_server/.env` (the CWD when uvicorn starts).

5. **CUDNN version mismatch warning**: PaddleOCR warns `CUDNN 9.9` compiled vs `9.5` installed. This is a non-fatal warning — OCR still works.

6. **Large CSV datasets excluded from git**: `Datasets/*.TXT` (198 MB each) and `outputs/exports/raw_all1_price_history.csv*` (568 MB) are in `.gitignore`. One CSV at 92 MB triggered a GitHub warning but was accepted under the 100 MB hard limit.

7. **`apps/mobile` was a nested git repo**: Its `.git` was removed so the entire project is a single repo.

---

## 13. Directory Structure (Key Paths)

```
RxNorm/
├── apps/mobile/                  # React Native / Expo app
│   └── src/
│       ├── api/case.ts           # createCase() — LLM + regex fallback
│       ├── ocr/
│       │   ├── ocr.ts            # mapRemoteCaseFields(), mergeAdjacentLines()
│       │   ├── types.ts          # RemoteCaseFields, RemoteOcrResult
│       │   ├── structuredCaseExtractor.ts  # UNTOUCHED regex fallback
│       │   ├── sectionMapper.ts            # UNTOUCHED
│       │   ├── groupMedicationLines.ts     # UNTOUCHED
│       │   └── sortReadingOrder.ts         # UNTOUCHED
│       └── types/
│           └── caseFields.ts     # CaseFields + BrandMatch types
├── tools/ocr_server/             # FastAPI OCR + Groq LLM server
│   ├── app/
│   │   ├── main.py               # FastAPI app
│   │   ├── paddle_parser.py      # PP-StructureV3 + Groq wiring
│   │   ├── groq_extractor.py     # Groq LLM extraction + sanitization
│   │   ├── schemas.py            # ParsedResult with case_fields
│   │   └── security.py           # Optional API key auth
│   ├── tests/
│   │   └── test_groq_extractor.py # 18 tests
│   ├── .env.example              # Template for secrets
│   ├── .env                      # Actual secrets (git-ignored)
│   └── requirements.txt          # groq, python-dotenv, paddleocr, etc.
├── etl/                          # Taiwan RxNorm ETL pipeline
├── supabase/migrations/          # DB schema + RPC migrations
├── tests/                        # Python ETL tests
└── .gitignore                    # Excludes .env, *.env, .venv, node_modules, large datasets
```

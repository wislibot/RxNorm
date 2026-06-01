# AGENTS.md — RxNorm Taiwan

> AI agent reference. Read `PROJECT_HANDOFF.md` for full architecture and rationale.

## What Is This?

RxNorm Taiwan is a mobile app (Expo SDK 54 / React Native 0.81) that scans Taiwanese hospital medication bags (藥袋), extracts structured data via OCR + Groq LLM, matches medications against a Taiwan RxNorm drug database (Supabase), and screens for drug-drug interactions (DDI).

**Three components:**
1. **Mobile App** — `apps/mobile/` (Expo/React Native, TypeScript)
2. **OCR Server** — `tools/ocr_server/` (FastAPI, PaddleOCR PP-StructureV3, Groq qwen3-32b)
3. **ETL Pipeline** — `etl/` (Python, psycopg → Supabase PostgreSQL)

## Quick Commands

### ETL (from repo root)
```bash
# Import raw CSV datasets → raw schema tables
uv run rxnorm-import-raw Datasets/*.TXT

# Rebuild curated tables from raw
uv run rxnorm-rebuild-curated

# Run QC report
uv run rxnorm-report-qc

# Run Python tests
uv run pytest tests/ -v
```

### Mobile App
```bash
cd apps/mobile
npm install
npx expo start              # dev server
npx expo start --clear      # clear cache
npx jest                    # run tests
npx tsc --noEmit            # type check
```

### OCR Server
```powershell
cd tools/ocr_server
python -m venv .venv; .\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# Tests:
pytest tests/ -v
```

### Supabase Migrations
```bash
npx supabase db push              # apply migrations
npx supabase db push --dry-run    # preview without applying
```

## Directory Map

```
RxNorm/
├── apps/mobile/              # Expo SDK 54 React Native app
│   └── src/
│       ├── api/case.ts       # createCase() — LLM + regex fallback
│       ├── ocr/
│       │   ├── ocr.ts        # mapRemoteCaseFields(), mergeAdjacentLines()
│       │   ├── types.ts      # RemoteCaseFields, RemoteOcrResult
│       │   ├── structuredCaseExtractor.ts  # UNTOUCHED regex fallback
│       │   ├── sectionMapper.ts            # UNTOUCHED
│       │   ├── groupMedicationLines.ts     # UNTOUCHED
│       │   └── sortReadingOrder.ts         # UNTOUCHED
│       └── types/
│           └── caseFields.ts # CaseFields + BrandMatch types
├── tools/ocr_server/         # FastAPI OCR + Groq LLM server
│   ├── app/
│   │   ├── main.py           # FastAPI app (/parse, /health)
│   │   ├── paddle_parser.py  # PP-StructureV3 + Groq wiring
│   │   ├── groq_extractor.py # Groq LLM extraction + sanitization
│   │   ├── schemas.py        # ParsedResult with case_fields
│   │   └── security.py       # Optional API key auth
│   └── tests/
│       └── test_groq_extractor.py  # 18 tests
├── etl/                      # Taiwan RxNorm ETL pipeline
│   ├── config.py             # load_settings() — env vars
│   ├── db.py                 # connect_database() — psycopg
│   ├── curated_build.py      # build_curated_payload() — main ETL
│   ├── import_raw.py         # CLI: import CSVs → raw schema
│   ├── rebuild_curated.py    # CLI: rebuild curated from raw
│   ├── report_qc.py          # CLI: QC report
│   ├── utils.py              # normalize_text(), split_tfda_ingredients()
│   ├── data/                 # ingredient_aliases.json
│   └── ...
├── supabase/migrations/      # DB schema + RPC migrations (run in order)
├── tests/                    # Python ETL tests (17 test files)
├── Datasets/*.TXT            # Raw CSV datasets (~198MB each, git-ignored)
└── .env.example              # Root env template
```

## Data Flow (OCR → Case)

```
Image → POST /parse → PaddleOCR → elements[]
  → Groq LLM (qwen3-32b) → case_fields JSON (16 fields)
  → Mobile app: mapRemoteCaseFields() → CaseFields
  → rx_match_medication_lines RPC → ingredient matching
  → rx_match_brand_lines RPC → brand matching (non-critical, try/catch)
  → rx_cases table insert
```

**Fallback:** If Groq returns null, `structuredCaseExtractor.ts` (regex) is used as silent fallback.

## Key Types

**RemoteCaseFields** (LLM output, 16 string|null fields):
patientName, patientSex, prescriptionNo, medicationName, quantity, directions,
indications, warnings, sideEffects, appearance, pharmacyName, pharmacyAddress,
pharmacistName, physicianName, dispensingDate, useBefore

**CaseFields** (mobile app):
All RemoteCaseFields except medicationName and appearance. Adds brandNames, brandMatches.
indications/warnings/sideEffects are wrapped in arrays.

## ETL Commands (pyproject.toml entry points)

| Command | Module | Purpose |
|---------|--------|---------|
| `rxnorm-import-raw` | `etl.import_raw:main` | Import CSV files → raw schema tables |
| `rxnorm-rebuild-curated` | `etl.rebuild_curated:main` | Rebuild curated tables from raw |
| `rxnorm-report-qc` | `etl.report_qc:main` | Generate QC report |

**Database:** Direct psycopg connection via `DATABASE_URL` env var (Supabase local dev: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

## Environment Variables

### Root `.env`
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

### Mobile `apps/mobile/.env`
```
EXPO_PUBLIC_SUPABASE_URL=https://guxkkiadnwxagcxggpyb.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
EXPO_PUBLIC_OCR_SERVER_URL=https://ocr.yourdomain.com
EXPO_PUBLIC_OCR_SERVER_API_KEY=your-ocr-api-key
```

### OCR Server `tools/ocr_server/.env`
```
GROQ_API_KEY=gsk_your_actual_key_here
GROQ_MODEL=qwen/qwen3-32b
PORT=8000
OCR_API_KEY=  # optional, skips auth if empty
```

## Testing

### Mobile (apps/mobile/)
```bash
npx jest                           # all tests
npx jest --testPathPattern=ocr     # OCR tests only
npx jest --testPathPattern=case    # case API tests only
```
**166 tests total.** OCR: 54/54, Case API: 4/4. 4 pre-existing React render timeouts (unrelated).

### Python ETL (tests/)
```bash
uv run pytest tests/ -v            # all tests
uv run pytest tests/test_curated_build.py -v   # curated build tests
uv run pytest tests/test_import_raw_cli.py -v  # import CLI tests
```
**17 test files.** Run after any ETL changes.

### OCR Server (tools/ocr_server/)
```bash
pytest tests/ -v                   # 18 tests for Groq extraction
```

## Known Gotchas

1. **Qwen outputs `<think>` tags** — sanitized by `_THINK_TAG_RE` + `_THINK_PREFIX_RE` + fallback `content.find('{')` in `groq_extractor.py`. Handle both closed and unclosed tags.
2. **`response_format` removed** — setting `response_format: {type: "json_object"}` caused 400 errors with the 140-line prompt. Prompt instruction alone is sufficient.
3. **Server restart required** — FastAPI doesn't auto-reload `.py` changes by default. Always restart uvicorn.
4. **`load_dotenv()` at import time** — in `groq_extractor.py`, env vars populated before `AsyncGroq` imports. `.env` must exist at CWD.
5. **CUDNN warning** — PaddleOCR warns `CUDNN 9.9 compiled vs 9.5 installed`. Non-fatal.
6. **Large CSV datasets** — `Datasets/*.TXT` (~198MB each) and `outputs/exports/raw_all1_price_history.csv*` (~568MB) are git-ignored.
7. **Expo SDK 54** — uses `expo-file-system/legacy` API, `react-native-safe-area-context`, `react-native-paper`.
8. **Supabase storage** — `rx-case-photos` bucket. Thumbnails stored as `{index}_thumb.jpg`.

## Files NOT to Modify (Unless Explicitly Asked)

These files are confirmed stable and decoupled from the extraction pipeline:

- `apps/mobile/src/ocr/structuredCaseExtractor.ts` — regex fallback, kept as-is
- `apps/mobile/src/ocr/sectionMapper.ts` — OCR section mapping
- `apps/mobile/src/ocr/groupMedicationLines.ts` — medication line grouping
- `apps/mobile/src/ocr/sortReadingOrder.ts` — reading order sorting
- Medicine matching RPCs (`rx_match_medication_lines`, `rx_match_brand_lines`)
- DDI screening pipeline
- Photo upload logic

## Migration Order (Supabase)

Migrations run sequentially by timestamp:
1. `202605130001` — raw schema
2. `202605130002` — curated schema
3. `202605210003` — DDI curated tables
4. `202605210004` — rx_cases
5. `202605210005` — detected_items on rx_cases
6. `202605220001` — rx_match_medication_lines RPC
7. `202605220002` — OCR sections on rx_cases
8. `202605250001` — rx_match_brand_lines RPC
9. `202605250002` — extend rx_match_brand_lines bilingual
10. `202605250003` — improve brand matching OCR spacing

## ECC Skills (ECC-Universal Integration)

This repo has ECC-Universal installed as an OpenCode plugin. Key skills:
- **ecc-tdd-workflow** — write tests before implementation
- **ecc-code-reviewer** — review code before commits
- **ecc-security-review** — security checklist for auth, API endpoints
- **ecc-verification-loop** — comprehensive verification after changes
- **ecc-refactor-cleaner** — dead code cleanup
- **ecc-coding-standards** — naming, readability, immutability

Use these skills proactively — they auto-trigger on relevant changes.

## Git

- Single repo (apps/mobile was formerly a nested git repo, `.git` removed)
- Branch: `master`
- Remote: `https://github.com/wislibot/RxNorm.git`
- Don't commit `.env`, `*.env`, `node_modules/`, `__pycache__/`, `Datasets/`

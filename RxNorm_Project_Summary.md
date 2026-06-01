# RxNorm Mobile App — OCR Pipeline Project Summary
> Conversation summary for continuity across Claude sessions  
> Last updated: June 2026  
> Project: Healthcare medication bag scanning app (Taiwan)

---

## 1. Project Overview

A **React Native mobile app** for scanning Taiwanese hospital medication bags (藥袋) and extracting structured patient/medication data. The app is currently in **demo stage** — not released.

### Core Features
- Photograph medication bag → extract structured fields via OCR
- Match detected medications against an ingredient database (Supabase RPC)
- Drug-drug interaction (DDI) screening
- Case management (create, view, list cases)
- Bilingual UI (English + Traditional Chinese)

### Tech Stack
| Layer | Technology |
|---|---|
| Mobile app | React Native (Expo) |
| Backend OCR server | Python FastAPI |
| OCR model | PaddleOCR PP-StructureV3 |
| LLM field extraction | Groq API (qwen/qwen3-32b) |
| Database | Supabase (PostgreSQL) |
| Public tunnel | Cloudflare Tunnel |
| Dev machine | Windows 11, RTX 3050 Ti (4GB VRAM), Ryzen 9 5900HS |

---

## 2. Architecture

### Full Pipeline

```
Mobile App (React Native)
        │
        │  HTTPS via Cloudflare Tunnel
        │  POST /parse
        │  Header: X-API-Key
        │  Body: multipart image upload
        ▼
FastAPI Server (localhost:8000, Windows 11)
        │
        ├── 1. PP-StructureV3 (RTX 3050 Ti GPU)
        │       → elements[] with text + bbox + confidence
        │       → raw_text (joined OCR lines)
        │
        ├── 2. Groq API (qwen/qwen3-32b)
        │       → structured CaseFields JSON from raw_text
        │       → fallback: returns null if Groq fails
        │
        └── Returns: { pages[], case_fields{}, extraction_engine, extraction_fallback }
                │
                ▼
        Mobile app receives response
                │
                ├── mapRemoteToOcrResult() → OcrResult
                ├── mapRemoteCaseFields() → CaseFields (from Groq)
                ├── mapOcrSections() → SectionedOcr (sectionMapper.ts)
                ├── getMedicationCandidateLines() → string[]
                ├── rx_match_medication_lines RPC → ingredient matches
                ├── rx_match_brand_lines RPC → brand matches
                ├── buildStoredOcrSections() → OcrSections (uses LLM fields)
                └── createCase() → INSERT into rx_cases (Supabase)
```

### Key Design Decisions
- **No Docker** — FastAPI runs directly on Windows 11 host OS
- **Images never stored on OCR server** — processed in memory/temp, deleted immediately
- **structuredCaseExtractor.ts kept as silent fallback** — regex extraction only used if Groq fails
- **Medicine matching pipeline fully decoupled** from field extraction — safe to change either independently

---

## 3. FastAPI OCR Server

### Location
```
tools/ocr_server/
├── app/
│   ├── main.py           # FastAPI app, /health + /parse endpoints
│   ├── paddle_parser.py  # PP-StructureV3 + Groq orchestration
│   ├── groq_extractor.py # Groq LLM field extraction
│   ├── schemas.py        # Pydantic response schemas
│   └── security.py       # X-API-Key auth
├── .env                  # GROQ_API_KEY, GROQ_MODEL (not in git)
├── .env.example          # Template for .env
├── requirements.txt      # Dependencies including groq>=0.9.0, python-dotenv
└── README.md
```

### Endpoints
- `GET /health` — no auth, returns `{ "status": "ok" }`
- `POST /parse` — auth required, accepts multipart image, returns structured JSON

### /parse Response Schema
```json
{
  "engine": "paddleocr-ppstructurev3",
  "version": "v1",
  "pages": [{
    "width": 877,
    "height": 1216,
    "elements": [
      {
        "type": "text",
        "text": "藥名",
        "bbox": [x1, y1, x2, y2],
        "confidence": 0.98
      }
    ]
  }],
  "case_fields": {
    "patientName": "王小花",
    "patientSex": "F",
    "prescriptionNo": "15432",
    "medicationName": "Trajenta DUO 2.5 & 850mg/膜衣錠",
    "quantity": "28粒",
    "directions": "每天兩次，早晚飯後使用",
    "indications": "治療第二型糖尿病",
    "warnings": "腎功能不全者服用前請告知醫師...",
    "sideEffects": "可能發生：腹瀉、鼻咽炎...",
    "appearance": "淡橘色、橢圓形",
    "pharmacyName": "台北慈濟醫院",
    "pharmacyAddress": "新北市新店區建國路289號",
    "pharmacistName": "胡慈慈",
    "physicianName": "黃華陀",
    "dispensingDate": "2024-04-25",
    "useBefore": null
  },
  "extraction_engine": "llm",
  "extraction_fallback": false
}
```

### Environment Variables
```
GROQ_API_KEY=your_key_here         # required
GROQ_MODEL=qwen/qwen3-32b          # optional, this is the default
```

### Running the Server
```powershell
cd E:\TRAE\Projects\RxNorm\tools\ocr_server
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## 4. OCR Pipeline Fixes (Implemented)

### Fix 1 — Confidence Filter (paddle_parser.py)
Filter out noise elements below confidence threshold:
```python
clean_elements = [el for el in elements if el["confidence"] >= 0.75]
```
**Why:** Garbage elements (screen glare, watermarks, icon noise) consistently score below 0.75. Real fields score 0.75–1.00.

### Fix 2 — Adjacent Line Merging (ocr.ts)
Added `mergeAdjacentLines()` in `mapRemoteToOcrResult()`:
- Same-row threshold: `|centerY difference| <= 10px`
- Horizontal adjacency: `x gap <= 80px`
- Runs BEFORE `sortLinesReadingOrder()`

**Why:** PP-StructureV3 sometimes splits label+value into separate elements. Merging fixes downstream regex extraction.

### Fix 3 — QR Code Exclusion (ocr.ts)
Added `isQrCodeElement()` — identifies QR codes by:
- `text.trim().length <= 2`
- `frame.width >= 40` and `frame.height >= 40`
- Aspect ratio between 0.7–1.4 (roughly square)

QR elements excluded from merge gap calculation. When a QR sits between label+value, gap threshold expands from 80px → 300px for that specific row.

**Why:** Bag 1 (台南醫院) has QR code between `處方醫師` label and `王〇〇` value, causing 240px gap that exceeded 80px threshold.

### Fix 4 — Label+NextLine Fallback (structuredCaseExtractor.ts)
Extended `extractPharmacistName()` and added new `extractPhysicianName()`:
- Try same-line regex first
- If empty, scan next 1-4 lines for name token
- Skip lines matching 22 known label keywords
- Regex fix: `\s*` → `[^\S\n\r]*` to prevent newline consumption

### Fix 5 — Groq LLM Field Extraction (groq_extractor.py)
Replaced frontend regex with Groq API call:
- Model: `qwen/qwen3-32b` (native Traditional Chinese support)
- Temperature: 0 (deterministic)
- Max tokens: 800
- Timeout: 15 seconds
- Sanitization: strip markdown fences, replace literal `\n` with space before JSON parse
- Full error handling: returns `None` on any failure

### Fix 6 — Document Unwarping (paddle_parser.py) ⏳ JUST ENABLED
```python
ocr = PaddleOCR(
    use_doc_orientation_classify=True,
    use_doc_unwarping=True,  # ← fixes perspective distortion from hand-held photos
    lang="ch"
)
```
**Why:** Hand-held photos cause perspective/curve distortion that scrambles Y coordinates, misassigning lines to wrong sections.

---

## 5. Mobile App Pipeline (Key Files)

### OCR Processing
| File | Purpose |
|---|---|
| `ocr/types.ts` | `OcrRect`, `OcrLine`, `OcrBlock`, `RemoteOcrResult`, `RemoteCaseFields` |
| `ocr/ocr.ts` | Remote OCR client, `mapRemoteToOcrResult()`, `mergeAdjacentLines()`, `isQrCodeElement()`, `mapRemoteCaseFields()` |
| `ocr/sortReadingOrder.ts` | Y-then-X sort with 10px row tolerance |
| `ocr/sectionMapper.ts` | Anchor-based section detection → `SectionedOcr` |
| `ocr/groupMedicationLines.ts` | Merge medication continuation lines → `GroupedItem[]` |
| `ocr/structuredCaseExtractor.ts` | Regex fallback field extraction (kept, not primary) |
| `ocr/normalizeOcrEnglish.ts` | Repair English OCR spacing artifacts |

### Medicine Matching (DO NOT TOUCH)
| File | Purpose |
|---|---|
| `detectedItems/extractDetectedItems.ts` | Fallback medication candidate extraction |
| `api/case.ts` | `createCase()` orchestrator — medicine matching + DB |

### Supabase RPCs
| RPC | Purpose |
|---|---|
| `rx_match_medication_lines(text[])` | 3-pass ingredient matching |
| `rx_match_brand_lines(text[])` | 2-pass brand matching |
| `rx_get_ddi_for_ingredients(uuid[])` | DDI screening |

### Data Flow in createCase()
```
1. getMedicationCandidateLines()    uses sectionMapper output
2. buildStoredOcrSections()         uses LLM caseFields (or regex fallback)
3. rx_match_medication_lines RPC    ingredient matching
4. rx_match_brand_lines RPC         brand matching
5. mapMedicationMatchesToDetectedItems()
6. INSERT INTO rx_cases
7. Upload photos to Supabase Storage
```

---

## 6. Groq Prompt (Current Version)

The prompt in `groq_extractor.py` handles:
- Standard Taiwanese bag labels (藥名, 用法, 用途, etc.)
- Variant labels from different hospitals:
  - `藥名與含量` (台東基督教醫院)
  - `用法與途經` (台東基督教醫院)
  - `臨床用途` (台東基督教醫院)
  - `用藥指示、副作用及警語` (combined field)
- Explicit rules to ignore dosage icon text
- Newline sanitization in values
- Physician/pharmacist separation
- Date formatting to YYYY-MM-DD

---

## 7. Test Results (3 Hospital Templates)

| Bag | Hospital | Layout | Score | Key Issues |
|---|---|---|---|---|
| Bag 1 | 台南○○醫院 | Standard grid | 8/10 ✅ | `〇〇` placeholders undetectable (expected) |
| Bag 2 | 台北慈濟醫院 | Standard grid + bold borders | 5/10 ⚠️ | Perspective distortion (doc_unwarping just enabled) |
| Bag 3 | 台東基督教醫院 | Continuous form | 4/10 ⚠️ | Non-standard layout, different field labels |

### Known Remaining Issues
1. **Bag 2 — perspective distortion** → `use_doc_unwarping=True` just enabled, not yet tested
2. **Bag 2 — 用法/用途 missing** → caused by distortion scrambling Y coords → should be fixed by unwarping
3. **Bag 3 — non-standard layout** → OCR reading order scrambled, fields labeled differently
4. **All bags — `〇〇` placeholder names** → U+3007 circles not recognized by model (expected, won't appear on real bags)
5. **Pharmacist showing wrong field** → Groq prompt now has stricter physician/pharmacist separation rules

---

## 8. Cloudflare Tunnel Setup

```powershell
# Install cloudflared
winget install --id Cloudflare.cloudflared

# Login
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create rxnorm-ocr

# Route DNS
cloudflared tunnel route dns rxnorm-ocr ocr.yourdomain.com

# Config file: %USERPROFILE%\.cloudflared\config.yml
tunnel: rxnorm-ocr
credentials-file: C:\Users\User\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: ocr.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404

# Run tunnel
cloudflared tunnel run rxnorm-ocr
```

---

## 9. Case Page UI (Pending Implementation)

### Planned 6-Section Paginated Layout
The Case Page currently uses a flat ScrollView with hardcoded cards. Planned refactor to paginated view:

| Page | Content |
|---|---|
| 1 — Patient Info | Name, sex, prescription no., photo thumbnails |
| 2 — Medication | Drug name, quantity, directions, brand names |
| 3 — Indications | Indications text |
| 4 — Warnings | Warnings + side effects |
| 5 — Pharmacy Info | Pharmacy name, address, pharmacist, physician |
| 6 — Other Info | Dispensing date, OCR raw text (collapsible), DDI |

### New Files to Create
```
apps/mobile/src/case/components/PatientInfoPage.tsx
apps/mobile/src/case/components/MedicationPage.tsx
apps/mobile/src/case/components/IndicationsPage.tsx
apps/mobile/src/case/components/WarningsSideEffectsPage.tsx
apps/mobile/src/case/components/PharmacyInfoPage.tsx
apps/mobile/src/case/components/DatesOtherPage.tsx
```

### Missing i18n Keys to Add
```
caseSummaryDirections     EN: "Directions"      zh-TW: "用法"
caseSummaryPhysicianName  EN: "Physician"       zh-TW: "處方醫師"
casePageSection1Title     EN: "Patient Info"    zh-TW: "病患資訊"
casePageSection2Title     EN: "Medication"      zh-TW: "藥物資訊"
casePageSection3Title     EN: "Indications"     zh-TW: "用途"
casePageSection4Title     EN: "Warnings"        zh-TW: "警語與副作用"
casePageSection5Title     EN: "Pharmacy Info"   zh-TW: "藥局資訊"
casePageSection6Title     EN: "Other Info"      zh-TW: "其他資訊"
```

**This TRAE task has NOT been sent yet** — pending after OCR quality is satisfactory.

---

## 10. What NOT to Touch

These files are working correctly and must not be modified:
- `ocr/sectionMapper.ts`
- `ocr/groupMedicationLines.ts`
- `ocr/sortReadingOrder.ts`
- `api/case.ts` medicine matching RPCs
- `api/ddi.ts`
- Photo upload logic

---

## 11. Immediate Next Steps

In priority order:

1. **Test `use_doc_unwarping=True`** with Bag 2 hand-held photo
   - Check if `用法` and `用途` now appear correctly in raw OCR
   - Check if reading order is fixed

2. **Verify Groq field extraction** after unwarping fix
   - Run curl test on Bag 2 flat image
   - Confirm `case_fields` populated correctly

3. **Implement Case Page 6-section paginated layout**
   - Send TRAE prompt (written, ready to send — see Section 9)

4. **Tackle Bag 3 (台東基督教醫院)** as stretch goal
   - Non-standard layout needs special handling
   - Low priority for demo

---

## 12. Test Commands

### Test OCR Server
```powershell
# Start server
cd E:\TRAE\Projects\RxNorm\tools\ocr_server
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Test with flat image
curl.exe -X POST http://localhost:8000/parse `
  -H "X-API-Key: YOUR_KEY" `
  -F "file=@path\to\MedicalBagEx2.png" `
  -o response.json
Get-Content response.json
```

### Run Mobile Tests
```bash
cd E:\TRAE\Projects\RxNorm\apps\mobile
npm test -- --runInBand
```

### Test Suite Status
- 22 suites, 156 tests passing ✅
- 4 pre-existing timeouts (unrelated to OCR pipeline)

---

## 13. Sample Medication Bags Used for Testing

| File | Hospital | Medication | Notes |
|---|---|---|---|
| `MedicalBagEx1.png` | 台南○○醫院 | Spiriva Respimat 2.5mcg | Standard grid layout, QR between physician+name |
| `MedicalBagEx2.png` | 台北慈濟醫院 | Trajenta DUO 2.5 & 850mg | Standard grid, bold borders, complex warnings |
| `medicine_bag_sample.jpg` | 台東基督教醫院 | Sennosides 12mg | Continuous form, non-standard labels |

Both PNG files are at:
`apps/mobile/assets/ocr_samples/`

---

## 14. Key Decisions Log

| Decision | Reason |
|---|---|
| PP-StructureV3 over PP-OCRv5 | Better structured document parsing, field-level extraction |
| Self-hosted over Azure Document Intelligence | HIPAA/patient data privacy |
| Groq (qwen/qwen3-32b) over local Ollama | Demo convenience, VRAM constraints (4GB shared with PP-StructureV3) |
| Host OS over Docker | Faster setup, GPU access simpler on Windows |
| Cloudflare Tunnel over ngrok | Free, stable URL, no time limits |
| Static API Key auth | Sufficient for demo, upgrade to Supabase JWT for production |
| .env file over setx | setx unreliable across PowerShell sessions on Windows 11 |
| Keep regex as fallback | Groq outage resilience during demo |
| No QR code priority system | QR codes link to generic drug info, not patient-specific data |

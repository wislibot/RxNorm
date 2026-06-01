# RxNorm (Mobile) OCR + Case Page Worklog Summary
*(Conversation handoff summary for another AI. Dates in logs: 2026-05-25 to 2026-05-27.)*

## 1) High-level goal
Build a reliable “after OCR” workflow for Taiwan prescription labels/medicine bags:
- Extract and display key case fields (patient, medication, instructions, indications, warnings/side effects, pharmacy info, dispensing date).
- Detect medications and match **ingredients** for DDI, while also showing **brand/product names**.
- Improve UX to avoid messy OCR splits (columns/line breaks, spacing typos).
- Later pivot: disable on-device ML Kit OCR and move OCR to a self-hosted server using **PaddleOCR (PP-StructureV3)** exposed via tunnel.

---

## 2) Core product decisions
### Ingredient vs Brand/Product
- **Ingredient matching** stays conservative and is used for DDI (e.g., `(tiotropium)`).
- **Brand/product matching** is separate (e.g., “Spiriva Respimat”, “適喘樂舒噴吸入劑”).

### Reprocessing UX
- Users shouldn’t have to re-run processing manually.
- Best UX: auto reprocess/version gating (optional), but manual “re-run processing” can exist as a fallback for support.

---

## 3) Case Page required fields (agreed)
1. Patient name, sex  
2. Drug name, strength/dose, quantity, directions for use  
3. Indication(s)  
4. Warnings or side effects  
5. Pharmacy location, pharmacy name, dispenser/pharmacist name  
6. Dispensing date (YYYY/MM/DD)

---

## 4) Major mobile-side improvements (before server OCR pivot)
### A) Medication “Re-run processing” concept
- Recommended to re-run downstream matching from stored `ocr_sections` instead of re-running OCR.

### B) Detected items UI grouping (avoid risky hard merges)
- Keep raw `detected_items` unchanged in storage.
- Display grouped medication cards in UI:
  - Group by ingredient_id
  - If exactly one matched med exists: attach only **medication-like** unmatched lines (not meta noise).
  - If 0 or 2+ matched meds: keep unmatched separate (“Other extracted text”).

### C) Quantity tail stripping improvements
- Improved stripping of `總量` with OCR typos (e.g., `總量1会`, `總量1金`) without harming dosage like `2.5mcg/puff`.

### D) “Other extracted text” bucket
- Prevent lines like `藥品資訊連結` from being merged into medication.
- Later improvement suggestion: show quantity as a dedicated field instead of an unmatched item.

### E) Normalize OCR English spacing (display-only)
- Added `normalizeOcrEnglishSpacing()` with safety guards:
  - Merge split tokens like `Medi cation` → `Medication`, `Respi mat` → `Respimat`
  - Avoid merging units/abbreviations (MG/mcg/ml/iu…)
  - Domain replacements like `Physiciam` → `Physician`
- Initially display-only; later used for detection/classification in sectionMapper.

### F) Structured Case Fields extraction + UI
- Added a deterministic extractor `structuredCaseExtractor` and expanded `ocr_sections` keys.
- Persisted parsed fields into `ocr_sections.case_fields`.
- Case Page renders “Case Summary” card:
  - Patient name, sex (with conservative rules), quantity, dispensing date
  - Indications, warnings, side effects
  - Pharmacy name/address, pharmacist name

### G) Fix missing fields due to OCR typos / ordering
- Sex: scan first N lines (e.g., 40), remove weird whitespace, ambiguity guard (男+女 => null).
- Pharmacist: typo-tolerant anchors (調→詞, 藥→樂) and “skip non-name lines” (分機/連結/地址/電話/24小時/digits-heavy).
- Dispensing date: parse same-line or next-line within a small window.

### H) Medication split across columns: cross-column merge
- “Medication 60puff/bot(tiotropium)” often sits in left column while brand is right column.
- Added a deterministic second-pass merge:
  - If line came from inline Medication header and is in left column (x<80), attach to nearest right-column med group by center-Y distance with guardrails.

### I) Brand/product matching RPC + bilingual output
- Added new RPC `rx_match_brand_lines(text[])` (conservative exact/alias only).
- Added `rx_strip_dosage_tail()` and later `rx_normalize_ocr_spacing()` to handle OCR spacing typos (e.g., `Respi mat`, `2. 5`).
- RPC returns both `product_name_zh` and `product_name_en`.
- Case Page Brand Name desired format:
  - `中文商品名 (English brand name)`

---

## 5) Pivot: remote-only OCR via FastAPI + PaddleOCR PP-StructureV3
### Decision
- Drop hybrid. **Disable on-device ML Kit OCR entirely** (remote-only).

### Backend architecture
- Windows 11 laptop host, RTX 3050 Ti CUDA.
- FastAPI server port 8000.
- PaddleOCR (v3.x) + PaddlePaddle GPU.
- Tunnel: Cloudflare “quick tunnel” (`trycloudflare.com`) because no domain.
- Auth: `X-API-Key` header.
- Upload method: multipart file upload.

### Tunnel notes
- `trycloudflare.com` URL changes on restart; app env must match.
- Cloudflared can fail to reach origin if FastAPI isn’t running; prefer:
  - `cloudflared tunnel --url http://127.0.0.1:8000` to avoid IPv6 `::1` issues.

---

## 6) Major integration/debug fixes (remote OCR)
### A) Expo env issues
- Variable name mismatch (API_URL vs URL) caused “OCR server not configured.”
- Backticks/quotes in `.env` values broke requests. Fix: store plain URL.

### B) FastAPI 422 due to misuse of dependency
Server signature had:
- `_: None = require_api_key` (treated as a query param named `_`)
Fix:
- Use `Depends(require_api_key)` or `dependencies=[Depends(require_api_key)]` in decorator.

### C) Client 422 multipart issues
1) `fetch + FormData` on Android often fails for `content://` URIs.
2) Switched to `expo-file-system` upload.
3) Expo SDK 54 specifics:
   - Default `expo-file-system` surface did not provide `FileSystemUploadType.MULTIPART`.
   - `createUploadTask` from `expo-file-system` was deprecated/throwing.
   - Fix: import legacy API: `expo-file-system/legacy` and use `uploadAsync` with multipart.

### D) Uvicorn using wrong Python
Global uvicorn was used; venv packages (paddleocr) not visible.
Fix:
- Run via venv python:
  - `.\.venv\Scripts\python.exe -m uvicorn ...`
- Install uvicorn in venv if missing.

### E) Paddle versions compatibility
Error: `AnalysisConfig.set_optimization_level` missing → PaddleOCR/PaddleX vs PaddlePaddle mismatch.
Fix:
- Install PaddlePaddle GPU 3.2.0 from cu126 index (driver >= 550):
  - `paddlepaddle-gpu==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/`

### F) PaddleOCR v3 API changes
- `ocr.ocr(img, cls=False)` invalid → remove `cls`.

### G) PaddleOCR v3 result parsing
- v3 returns PaddleX `OCRResult` object with keys:
  - `rec_boxes`, `rec_texts`, `rec_scores`, `dt_polys`, `rec_polys`, etc.
- Parsing required converting result object to dict (`to_dict()`) and supporting numpy arrays.
- Fixed numpy “truth value ambiguous” errors; counts confirmed e.g. `rec_texts=50`.

---

## 7) DEV: OCR Debug screen replaced with model bbox visualization
Goal: visualize **remote model bounding boxes**.
- Persisted `ocr_sections.remote_model` for each case.
- DEV OCR Debug screen overlays boxes on the photo using **react-native-svg**.
- Added confidence filters (All / ≥0.5 / ≥0.8), search, tap-to-highlight.

Notes:
- If crash: missing `RNSVGSvgViewAndroid` => install `react-native-svg` and rebuild dev client.

---

## 8) Gallery upload (Upload from Photos)
To use a laptop image, added “Upload from Photos” button under camera capture (localized):
- EN: “Upload from Photos”
- zh-TW: “從相簿上傳”
Uses `expo-image-picker` and feeds the selected URI into the same remote OCR flow.

Important:
- Adding `expo-image-picker` requires dev client rebuild (native module).

---

## 9) Remaining known issues / TODOs
1) **Prevent OCR double-run**: in-flight guard added; verify all entry points (camera + gallery) are single-call.
2) **Medication lines cleanup**:
   - remove label-only `總量` / `Quantity` tokens from medication candidates.
3) **Debug log noise / crashes**:
   - RN inspector crash (CxxInspectorPackagerConnection NPE) likely due to dev tooling/log volume; reduce large JSON logs and avoid inspector during heavy runs.
4) **cuDNN mismatch warning**:
   - Paddle compiled with cuDNN 9.9, machine has 9.5; may cause instability. Align cuDNN later.
5) **trycloudflare URL volatility**:
   - long-term: buy a domain and configure Cloudflare Tunnel with stable hostname, or switch tunnel provider.

---

## 10) Handy commands (Windows)
### Start server (venv)
```powershell
cd e:\TRAE\Projects\RxNorm\tools\ocr_server
$env:OCR_API_KEY="YOUR_KEY"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Start quick tunnel (no domain)
```powershell
cloudflared tunnel --url http://127.0.0.1:8000
```

### Test health
```powershell
curl.exe -i "https://<trycloudflare>.trycloudflare.com/health"
```

### Test parse
```powershell
curl.exe -i -X POST "https://<trycloudflare>.trycloudflare.com/parse?lang=ch" -H "X-API-Key: YOUR_KEY" -F "file=@C:/Users/<YOU>/Downloads/test.jpg;type=image/jpeg"
```


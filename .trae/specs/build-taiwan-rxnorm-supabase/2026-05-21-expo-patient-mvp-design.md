# RxNorm Taiwan (Expo Mobile) — Patient MVP Design

**Goal:** Build an elderly-friendly React Native (Expo) patient app that can identify medicines via photo/OCR workflows, maintain a medication list, link to care teams via clinic code/QR, auto-share cases to all linked clinics, and show DDI results with coverage-aware messaging.

## Modes & access control

- **Patient is the default mode** for every user after login.
- **No mode/tab switcher for Staff/Admin** in the mobile app. Staff/Admin entry points are not discoverable unless the user has privileges in the database.
- Staff/Admin UI is planned **as web later** (Expo web or separate React web), not part of this build.

## Login + “login once”

- Auth method: **Email + password** (Supabase Auth).
- MVP includes **open patient self-signup** (email + password). Role defaults to **Patient**; Staff/Admin are granted later by an Admin.
- Session should persist; user should not have to log in again unless they explicitly sign out.
- On app start: restore session from Supabase + secure storage.

### Signup (MVP)

- Login screen must include **Create account / 註冊**.
- Signup screen fields:
  - email
  - password
  - confirm password
- After successful signup:
  - sign the user in (or prompt them to verify email first, depending on Supabase Auth settings)
  - then follow the first-login language picker flow (if no language preference saved)
- Recommended: enable **email verification** in Supabase Auth to reduce fake accounts.

## Language behavior

- The app supports **English** and **Traditional Chinese (繁體中文)**.
- **After the user’s first successful login only**, show a one-time **Language Picker** screen.
- Once a language is chosen:
  - Persist locally (SecureStore) so it survives app restarts.
  - Persist to server profile (so it follows the user across devices).
- Keep “Change language” available in **Settings**.

## Navigation (Patient)

Use a bottom tab navigator with 5 tabs (elderly-friendly). **Home (Scan) must be the center tab**:

1. Search
2. My Meds
3. **Home (Scan)** (center)
4. Care Teams
5. Settings

## Home (Scan) requirements

Immediately after login (and language selection on first login), the user lands on **Home (Scan)**.

Home offers two large scan buttons:

1. **MedicineBag**
   - Multi-item scan (bag + multiple packages).
   - Creates a standardized “Medication Case Page” (universal format).
2. **MedicineBrandPackage**
   - Single package quick check (“what drug is this?”).
   - Used to query the database and show ingredient/permit summary.

## Universal “Medication Case Page”

This page is the standardized output format for MedicineBag scans, designed so doctors/staff can view and interpret cases consistently.

Sections:
- Case header + status
- Photos (1–4)
- OCR extracted raw text (audit + reprocessing)
- Detected medicine items list:
  - each item has matched product (or unmatched), confidence, and **per-item doctor notes**
  - doctors/staff can **edit the match** (but edits are **case-only**, not global dictionary)
- DDI section (coverage-aware):
  - shows interactions found
  - shows checked vs unchecked counts
  - shows a coverage disclaimer

## Care Teams (clinic linking + auto-share)

- Patient can link to **multiple** clinics/care teams.
- Linking methods:
  - enter **Clinic Code**
  - scan **Clinic QR** (encodes clinic code)
- **New cases auto-share to all linked clinics by default.**

## DDI (Drug–Drug Interactions)

- DDI is ingredient-rooted (ingredient concept ↔ ingredient concept).
- DDI dataset: DDInter imported into Supabase (`rx_ddi_pairs` etc.).
- Policy choice: **Option A (safer)** — DDI coverage is limited to ingredients in the Taiwan curated dictionary. Missing DDInter drugs remain unmapped.
- Frontend must display **coverage-aware messaging**:
  - “No interactions found among checked medicines” is only valid when nothing was unchecked
  - If any items were unchecked, show a warning banner and always show a disclaimer

## UI/UX principles (elderly-friendly)

- Large font sizes and touch targets
- High contrast
- Minimal steps; clear next action
- Avoid dense tables in mobile; use cards + short labels

## Non-goals for this MVP

- Full Staff/Admin mobile experience
- Perfect OCR accuracy (we will stub/iterate on OCR pipeline)
- Adding “DDI-only” ingredients not present in Taiwan curated dictionary

## OCR approach (MVP decision)

- **On-device OCR** (no cloud cost) using **`@react-native-ml-kit/text-recognition`**.
  - Use **Chinese script recognition** (`TextRecognitionScript.CHINESE`) to reliably detect **Traditional Chinese**.
  - Optional: also run Latin recognition and merge/deduplicate text for mixed-language packaging.
- Because this is a native module:
  - It will not run in **Expo Go**; use an **Expo Development Build (EAS dev client)** for device testing.
- Web OCR is not supported; keep the existing **DEV-only demo image + demo OCR text** path for web preview/testing.
- OCR output is treated as an input to our matching pipeline; we still show the raw OCR text in the universal Case Page for audit and reprocessing.

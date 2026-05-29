# RxNorm Taiwan (Expo Mobile Patient MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an elderly-friendly Expo mobile app (Patient mode) with persistent login, first-login language picker (EN/zh-TW), center “Home (Scan)” tab, Care Team linking via clinic code/QR, and placeholder Scan flows wired to Supabase/back-end integration points.

**Architecture:** Expo app with a patient-only tab navigator. Supabase Auth for login/persistent session. i18n stored locally and in a server profile. Scan flows capture images and create “cases”; DDI display uses the new backend coverage-aware evaluator response shape.

**Tech Stack:** Expo, React Native, React Navigation (bottom tabs + stack), Supabase JS, expo-secure-store, i18n (i18next/react-i18next), expo-camera (photo + QR scan), TypeScript.

---

## File structure (proposed)

Create a new Expo app folder in the repo:

- Create: `apps/mobile/` (Expo app)
  - `apps/mobile/app/` (screens)
  - `apps/mobile/src/lib/supabase.ts`
  - `apps/mobile/src/lib/i18n.ts`
  - `apps/mobile/src/lib/storage.ts`
  - `apps/mobile/src/components/`
  - `apps/mobile/src/theme/` (colors/typography)
  - `apps/mobile/src/types/`
  - `apps/mobile/src/api/` (typed API helpers; can start as Supabase direct queries)

If the repo already has a preferred frontend location, follow it instead.

---

## Task 1: Scaffold Expo app + baseline tooling

**Files:**
- Create: `apps/mobile/*`

- [ ] **Step 1: Create Expo app (TypeScript)**

Run (non-interactive if possible):
```bash
cd e:/TRAE/Projects/RxNorm
mkdir -p apps
cd apps
npx create-expo-app@latest mobile --template
```

Choose a TypeScript template if prompted (or rerun with the correct flag supported by the current create-expo-app).

- [ ] **Step 2: Install core deps**

Run:
```bash
cd e:/TRAE/Projects/RxNorm/apps/mobile
npm install @supabase/supabase-js
npm install react-i18next i18next
npm install expo-secure-store
npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack react-native-screens react-native-safe-area-context
npx expo install expo-camera
```

- [ ] **Step 3: Add lint/test baseline (minimal)**

If the repo already has a JS/TS test standard, follow it. Otherwise:
```bash
cd e:/TRAE/Projects/RxNorm/apps/mobile
npm install -D jest @types/jest ts-jest
```

- [ ] **Step 4: Verify dev start**

Run:
```bash
cd e:/TRAE/Projects/RxNorm/apps/mobile
npx expo start
```

- [ ] **Step 5: Commit**
```bash
git add apps/mobile
git commit -m "feat(mobile): scaffold expo patient app"
```

---

## Task 2: Supabase client + session persistence (“login once”)

**Files:**
- Create: `apps/mobile/src/lib/supabase.ts`
- Create: `apps/mobile/src/lib/storage.ts`
- Create: `apps/mobile/src/auth/AuthProvider.tsx`
- Create: `apps/mobile/src/auth/LoginScreen.tsx`
- Create: `apps/mobile/src/auth/SignupScreen.tsx`
- Test: `apps/mobile/src/auth/__tests__/authProvider.test.ts`

- [ ] **Step 1: Add env config**

Decide where you store public keys (Expo config):
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Add to `apps/mobile/app.config.*` or `.env` (follow Expo conventions used in your setup).

- [ ] **Step 2: Implement supabase client**

`src/lib/supabase.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
```

- [ ] **Step 3: Implement secure storage wrapper**

`src/lib/storage.ts` (minimal API used by language + optional tokens):
```ts
import * as SecureStore from 'expo-secure-store'

export async function setItem(key: string, value: string) {
  await SecureStore.setItemAsync(key, value)
}
export async function getItem(key: string) {
  return SecureStore.getItemAsync(key)
}
export async function deleteItem(key: string) {
  await SecureStore.deleteItemAsync(key)
}
```

- [ ] **Step 4: AuthProvider + Login screen**

Implement:
- `AuthProvider`: manages current session/user, exposes `signIn(email,password)`, `signOut()`
- `LoginScreen`: big, elderly-friendly inputs + button
- `LoginScreen` includes a **Create account / 註冊** link that navigates to `SignupScreen`

Implement:
- `SignupScreen`: Email, Password, Confirm Password, Create Account button
- `AuthProvider` exposes `signUp(email,password)` using `supabase.auth.signUp`

Notes:
- If email verification is enabled in Supabase Auth, show a “Check your email to verify” message after signup.
- If email verification is disabled for MVP, sign in immediately after successful signup.

Login success should route into the main app flow.

- [ ] **Step 5: Minimal test**

Write a unit test for:
- provider initializes with no session
- provider updates user on mock sign-in success
- provider calls signUp and handles success/error

- [ ] **Step 6: Commit**
```bash
git add apps/mobile/src/auth apps/mobile/src/lib
git commit -m "feat(mobile): add supabase auth and persistent session"
```

---

## Task 3: One-time Language Picker after first login

**Files:**
- Create: `apps/mobile/src/i18n/translations/en.json`
- Create: `apps/mobile/src/i18n/translations/zh-TW.json`
- Create: `apps/mobile/src/lib/i18n.ts`
- Create: `apps/mobile/src/settings/LanguagePickerScreen.tsx`
- Modify: `apps/mobile/src/auth/AuthProvider.tsx`
- Modify: `apps/mobile/src/settings/SettingsScreen.tsx`
- Test: `apps/mobile/src/settings/__tests__/languageFlow.test.ts`

- [ ] **Step 1: Add i18n setup**

`src/lib/i18n.ts` initializes i18next and exports `setLanguage(lang)`.

Language keys: `en`, `zh-TW`.

- [ ] **Step 2: Add translations**

Start with only strings needed for:
- login
- language picker
- bottom tabs
- scan buttons
- settings

- [ ] **Step 3: Language persistence logic**

Rules:
- On first successful login, if no `preferred_language` exists:
  - show LanguagePicker
  - save to SecureStore (e.g., key `preferred_language`)
  - upsert to server profile (see next step)
- Later: always load from SecureStore first; fallback to server profile.

- [ ] **Step 4: Add server profile field**

If the DB already has `profiles`:
- add/ensure `preferred_language` (text) exists.

If this requires a DB migration, do it in the backend repo (not in mobile).

- [ ] **Step 5: Settings → change language**

Settings screen has a “Language” row that opens LanguagePicker screen.

- [ ] **Step 6: Tests**

Test that:
- first-login with no stored preference shows LanguagePicker
- selecting a language persists and no longer shows picker next login

- [ ] **Step 7: Commit**
```bash
git add apps/mobile/src/i18n apps/mobile/src/lib/i18n.ts apps/mobile/src/settings
git commit -m "feat(mobile): add first-login language picker and i18n"
```

---

## Task 4: Patient navigation (5 tabs) with centered Home (Scan)

**Files:**
- Create: `apps/mobile/src/navigation/PatientTabs.tsx`
- Create: `apps/mobile/src/screens/HomeScanScreen.tsx`
- Create: `apps/mobile/src/screens/SearchScreen.tsx`
- Create: `apps/mobile/src/screens/MyMedsScreen.tsx`
- Create: `apps/mobile/src/screens/CareTeamsScreen.tsx`
- Create: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/App.tsx` (or entry file)

- [ ] **Step 1: Implement tab order**

Order must be:
1) Search
2) My Meds
3) **Home (Scan)** (center)
4) Care Teams
5) Settings

- [ ] **Step 2: Center tab styling**

Make Home visually prominent:
- larger icon
- larger hit area
- label “Scan”

- [ ] **Step 3: Home (Scan) screen content**

Two big buttons:
- MedicineBag
- MedicineBrandPackage

Route to placeholder flows in Task 5.

- [ ] **Step 4: Commit**
```bash
git add apps/mobile/src/navigation apps/mobile/src/screens
git commit -m "feat(mobile): add patient tab navigation with centered scan home"
```

---

## Task 5: Scan flows (UI + camera) — MedicineBag and BrandPackage

**Files:**
- Create: `apps/mobile/src/scan/ScanEntryScreen.tsx` (optional; Home can route directly)
- Create: `apps/mobile/src/scan/MedicineBagCaptureScreen.tsx`
- Create: `apps/mobile/src/scan/BrandPackageCaptureScreen.tsx`
- Create: `apps/mobile/src/scan/CameraCapture.tsx`
- Create: `apps/mobile/src/case/CasePageScreen.tsx`
- Create: `apps/mobile/src/ocr/ocr.ts`
- Modify: `apps/mobile/package.json`

- [ ] **Step 1: Camera component**

Use `expo-camera`:
- request permission
- capture photo
- return file URI

- [ ] **Step 2: MedicineBag capture**

Allow 1–4 photos, show thumbnails, “Next” button.

- [ ] **Step 3: BrandPackage capture**

Single photo, “Scan” button.

- [ ] **Step 4: OCR placeholder integration point**

For MVP (no cloud cost + Traditional Chinese support):
- Use **`@react-native-ml-kit/text-recognition`** for on-device OCR.
- Run **Chinese script recognition** to support Traditional Chinese:
  - `TextRecognitionScript.CHINESE`
- Keep a single wrapper function `runOcrOnImages(uris) -> rawText` so we can swap engines later.
- Web fallback: keep DEV-only demo image + demo OCR text so the flow is testable on web.
- Because this is a native module, it requires an **Expo Development Build (EAS dev client)**; it will not run inside Expo Go.

Install:
```bash
cd e:/TRAE/Projects/RxNorm/apps/mobile
npm install @react-native-ml-kit/text-recognition
```

Implement wrapper (example shape; keep lazy import so Expo Go doesn't crash):
```ts
import { Platform } from 'react-native'

export async function runOcrOnImages(uris: string[]): Promise<string> {
  if (Platform.OS === 'web') return 'DEMO OCR\\n...'
  const mod = await import('@react-native-ml-kit/text-recognition')
  const TextRecognition = (mod as any).default
  const { TextRecognitionScript } = mod as any

  const texts: string[] = []
  for (const uri of uris) {
    const res = await TextRecognition.recognize(uri, TextRecognitionScript.CHINESE)
    texts.push(res?.text || '')
  }
  return texts.filter(Boolean).join('\\n\\n')
}
```

After installing/removing native deps, rebuild the Android dev client:
```bash
eas build --profile development --platform android
npx expo start --dev-client
```

- [ ] **Step 5: Create Case Page (universal format)**

CasePage shows:
- photos
- raw OCR text
- detected items (mock list for now)
- per-item doctor note placeholder (read-only in patient mode)
- DDI section placeholder (wired in Task 6)

- [ ] **Step 6: Commit**
```bash
git add apps/mobile/src/scan apps/mobile/src/case
git commit -m "feat(mobile): add scan capture flows and universal case page UI"
```

---

## Task 6: DDI display (coverage-aware)

**Files:**
- Create: `apps/mobile/src/api/ddi.ts`
- Modify: `apps/mobile/src/case/CasePageScreen.tsx`

- [ ] **Step 1: Define TypeScript types matching backend contract**

Use the response shape documented in `docs/ddi.md` (backend).

- [ ] **Step 2: Implement API helper**

If you already have an HTTP API endpoint, call it.

If not, create a temporary Supabase RPC/edge function plan, but keep the mobile code calling a single helper `getCaseDdi(...)`.

- [ ] **Step 3: Render messaging rules**

Implement:
- If `unchecked_ingredient_count > 0`: show warning banner
- If `interactions_found_count == 0`:
  - show “No interactions found among the checked medicines.” only when unchecked count is 0
- Always show disclaimer text

- [ ] **Step 4: Commit**
```bash
git add apps/mobile/src/api apps/mobile/src/case/CasePageScreen.tsx
git commit -m "feat(mobile): add coverage-aware ddi rendering on case page"
```

---

## Task 7: Care Teams — link via clinic code or clinic QR

**Files:**
- Modify: `apps/mobile/src/screens/CareTeamsScreen.tsx`
- Create: `apps/mobile/src/careTeams/LinkClinicCodeScreen.tsx`
- Create: `apps/mobile/src/careTeams/LinkClinicQrScreen.tsx`
- Create: `apps/mobile/src/api/careTeams.ts`

- [ ] **Step 1: UI**

CareTeams screen:
- list linked clinics (placeholder or real if API exists)
- “Link clinic” button

Link methods:
- enter clinic code
- scan clinic QR (camera in QR scan mode)

- [ ] **Step 2: Backend integration points**

Define API calls:
- validate clinic code
- link clinic to patient
- list patient clinics
- unlink clinic

For MVP, implement UI + stubs if backend tables aren’t ready yet.

- [ ] **Step 3: Commit**
```bash
git add apps/mobile/src/careTeams apps/mobile/src/screens/CareTeamsScreen.tsx apps/mobile/src/api/careTeams.ts
git commit -m "feat(mobile): add care team linking via clinic code/qr"
```

---

## Task 8: Polish (elderly accessibility) + smoke tests

**Files:**
- Modify: `apps/mobile/src/theme/*`
- Modify: screens for consistent typography and spacing

- [ ] **Step 1: Theme tokens**

Define:
- base font sizes (16–18 default, 20–24 headers)
- button height (>= 56)
- spacing scale

- [ ] **Step 2: Contrast + readability**

Ensure:
- text contrast meets basic accessibility
- avoid small touch targets

- [ ] **Step 3: Smoke test checklist**

Manual:
- sign in
- first-login language picker shown once
- relaunch app keeps session + language
- home scan buttons reachable immediately
- navigation tabs stable

- [ ] **Step 4: Commit**
```bash
git add apps/mobile/src
git commit -m "chore(mobile): improve accessibility and polish patient mvp"
```

---

## Spec coverage self-check

- Persistent login: Task 2
- First-login language picker + settings language: Task 3
- 5 tabs with centered scan: Task 4
- MedicineBag + BrandPackage flows + universal case page: Task 5
- DDI coverage-aware messaging: Task 6
- Clinic code + clinic QR + multi-care-team: Task 7
- Elderly-friendly UI polish: Task 8

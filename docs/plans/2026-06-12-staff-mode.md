# Staff Mode Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a staff-facing mobile layout that shows all patient records shared with the staff member's assigned hospital(s), including patient identity.

**Architecture:** SECURITY DEFINER RPCs join `rx_shared_records` → `rx_cases`/`rx_playlists` → `auth.users` to return shared data with patient info. Mobile app detects staff role on login and renders a separate `StaffTabs` layout.

**Tech Stack:** Supabase RPCs (PostgreSQL), React Native + Expo, React Navigation, Supabase Auth

---

## Decisions
- Staff sees **all** shared records across all assigned hospitals (no hospital selector)
- Staff sees **patient name/email** who shared each record
- Approach A: SECURITY DEFINER RPCs (not RLS chains)
- Separate `StaffTabs.tsx` layout (not conditional tabs in one navigator)
- Role detection via `rx_staff_hospitals` query on login

---

## Phase 1: Database

### Task 1.1 — `is_staff()` RPC

**Objective:** Check if current user has any staff assignment.

**Migration:** `create_staff_rpcs`

```sql
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM rx_staff_hospitals WHERE user_id = auth.uid());
$function$;
```

### Task 1.2 — `get_staff_hospitals()` RPC

**Objective:** Return all hospitals where the current user is staff.

```sql
CREATE OR REPLACE FUNCTION public.get_staff_hospitals()
RETURNS TABLE(hospital_id uuid, name_zh text, name_en text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  SELECT h.id, h.name_zh, h.name_en, sh.role
  FROM rx_staff_hospitals sh
  JOIN rx_hospitals h ON h.id = sh.hospital_id
  WHERE sh.user_id = auth.uid();
$function$;
```

### Task 1.3 — `get_hospital_shared_cases(p_hospital_id)` RPC

**Objective:** Return all cases shared with a hospital, including patient email and medication summaries.

```sql
CREATE OR REPLACE FUNCTION public.get_hospital_shared_cases(p_hospital_id uuid)
RETURNS TABLE(
  case_id uuid,
  case_name text,
  created_at timestamptz,
  patient_email text,
  medication_count bigint,
  medication_names text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Verify caller is staff at this hospital
  IF NOT EXISTS (SELECT 1 FROM rx_staff_hospitals WHERE user_id = auth.uid() AND hospital_id = p_hospital_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    sr.record_id,
    c.case_name,
    c.created_at,
    u.email,
    COUNT(cm.id),
    ARRAY_AGG(cm.brand_name ORDER BY cm.created_at) FILTER (WHERE cm.brand_name IS NOT NULL)
  FROM rx_shared_records sr
  JOIN rx_cases c ON c.id = sr.record_id
  JOIN auth.users u ON u.id = sr.user_id
  LEFT JOIN rx_case_medications cm ON cm.case_id = c.id
  WHERE sr.hospital_id = p_hospital_id
    AND sr.record_type = 'case'
  GROUP BY sr.record_id, c.case_name, c.created_at, u.email
  ORDER BY c.created_at DESC;
END;
$function$;
```

### Task 1.4 — `get_hospital_shared_druglists(p_hospital_id)` RPC

**Objective:** Return all druglists shared with a hospital, including patient email and drug names.

```sql
CREATE OR REPLACE FUNCTION public.get_hospital_shared_druglists(p_hospital_id uuid)
RETURNS TABLE(
  playlist_id uuid,
  playlist_name text,
  created_at timestamptz,
  patient_email text,
  drug_count bigint,
  drug_names text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rx_staff_hospitals WHERE user_id = auth.uid() AND hospital_id = p_hospital_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    sr.record_id,
    p.name,
    p.created_at,
    u.email,
    COUNT(pi.id),
    ARRAY_AGG(pi.drug_name ORDER BY pi.created_at) FILTER (WHERE pi.drug_name IS NOT NULL)
  FROM rx_shared_records sr
  JOIN rx_playlists p ON p.id = sr.record_id
  JOIN auth.users u ON u.id = sr.user_id
  LEFT JOIN rx_playlist_items pi ON pi.playlist_id = p.id
  WHERE sr.hospital_id = p_hospital_id
    AND sr.record_type = 'druglist'
  GROUP BY sr.record_id, p.name, p.created_at, u.email
  ORDER BY p.created_at DESC;
END;
$function$;
```

### Task 1.5 — `get_hospital_shared_case_detail(p_case_id)` RPC

**Objective:** Return full case detail (medications with all fields) for staff read-only view.

```sql
CREATE OR REPLACE FUNCTION public.get_hospital_shared_case_detail(p_case_id uuid)
RETURNS TABLE(
  case_id uuid,
  case_name text,
  created_at timestamptz,
  patient_email text,
  medication_id uuid,
  brand_name text,
  generic_name text,
  atc_code text,
  strength text,
  frequency text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Verify caller is staff at a hospital that has this case shared
  IF NOT EXISTS (
    SELECT 1 FROM rx_shared_records sr
    JOIN rx_staff_hospitals sh ON sh.hospital_id = sr.hospital_id
    WHERE sr.record_id = p_case_id
      AND sr.record_type = 'case'
      AND sh.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.case_name,
    c.created_at,
    u.email,
    cm.id,
    cm.brand_name,
    cm.generic_name,
    cm.atc_code,
    cm.strength,
    cm.frequency
  FROM rx_cases c
  JOIN auth.users u ON u.id = c.user_id
  LEFT JOIN rx_case_medications cm ON cm.case_id = c.id
  WHERE c.id = p_case_id
  ORDER BY cm.created_at;
END;
$function$;
```

---

## Phase 2: Mobile API Layer

### Task 2.1 — Create `src/api/staff.ts`

**Objective:** API functions for staff-specific data fetching.

**File:** `apps/mobile/src/api/staff.ts`

```typescript
import { supabase } from '../lib/supabase';

export async function isStaff(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_staff');
  if (error) return false;
  return data === true;
}

export async function getStaffHospitals() {
  const { data, error } = await supabase.rpc('get_staff_hospitals');
  if (error) throw error;
  return data ?? [];
}

export async function getHospitalSharedCases(hospitalId: string) {
  const { data, error } = await supabase.rpc('get_hospital_shared_cases', { p_hospital_id: hospitalId });
  if (error) throw error;
  return data ?? [];
}

export async function getHospitalSharedDruglists(hospitalId: string) {
  const { data, error } = await supabase.rpc('get_hospital_shared_druglists', { p_hospital_id: hospitalId });
  if (error) throw error;
  return data ?? [];
}

export async function getHospitalSharedCaseDetail(caseId: string) {
  const { data, error } = await supabase.rpc('get_hospital_shared_case_detail', { p_case_id: caseId });
  if (error) throw error;
  return data ?? [];
}
```

---

## Phase 3: Auth & Navigation

### Task 3.1 — Update `AuthProvider.tsx`

**Objective:** Detect staff role on login and expose in context.

**Changes:**
- Import `isStaff`, `getStaffHospitals` from `../api/staff`
- After session loads, call both
- Add `isStaff: boolean` and `staffHospitals: StaffHospital[]` to context type

### Task 3.2 — Create `StaffTabs.tsx`

**Objective:** Staff bottom tab layout with 3 tabs.

**File:** `apps/mobile/src/navigation/StaffTabs.tsx`

**Tabs:**
1. **Patient Records** — all shared cases + druglists across all staff hospitals
2. **My Hospitals** — list of assigned hospitals
3. **Settings** — reuse existing SettingsScreen

### Task 3.3 — Update `App.tsx` branching

**Objective:** Render StaffTabs or PatientTabs based on role.

**Changes:**
- After auth + language check, check `isStaff` from context
- If true → `<StaffTabs />`
- If false → `<PatientTabs />`

---

## Phase 4: Staff Screens

### Task 4.1 — `StaffRecordsScreen.tsx`

**Objective:** Main staff view — shows all shared records with patient info.

**File:** `apps/mobile/src/staff/StaffRecordsScreen.tsx`

**UI:**
- Tab toggle: Cases | Druglists
- Case card: case_name, date, patient email, medication count
- Druglist card: name, date, patient email, drug count
- Pull-to-refresh
- Tap → navigate to detail

### Task 4.2 — `StaffCaseDetailScreen.tsx`

**Objective:** Read-only case detail with medication list.

**File:** `apps/mobile/src/staff/StaffCaseDetailScreen.tsx`

**UI:**
- Header: case_name, patient email, date
- Medication list: brand_name, generic_name, strength, frequency
- No edit/delete/share buttons

### Task 4.3 — `StaffMyHospitalsScreen.tsx`

**Objective:** Show assigned hospitals with shared record counts.

**File:** `apps/mobile/src/staff/StaffMyHospitalsScreen.tsx`

**UI:**
- Hospital card: name_zh, name_en, role
- Record count badge (total shared cases + druglists)

---

## Phase 5: i18n

### Task 5.1 — Add staff strings

**Files:** `i18n/translations/en.json`, `i18n/translations/zh-TW.json`

**Keys:**
- `staff.tabs.records` → "Patient Records" / "病患紀錄"
- `staff.tabs.hospitals` → "My Hospitals" / "我的醫院"
- `staff.records.cases` → "Cases" / "用藥紀錄"
- `staff.records.druglists` → "Drug Lists" / "藥品清單"
- `staff.records.noCases` → "No cases shared yet" / "尚無分享的用藥紀錄"
- `staff.records.noDruglists` → "No drug lists shared yet" / "尚無分享的藥品清單"
- `staff.records.patient` → "Patient" / "病患"
- `staff.records.medications` → "Medications" / "藥物"
- `staff.records.drugs` → "Drugs" / "藥品"

---

## Verification

After all tasks:
1. Create a test staff assignment via Admin Panel (assign your user to a hospital)
2. Share a case + druglist from patient account to that hospital
3. Log into mobile app → should see StaffTabs layout
4. Patient Records tab → should show shared records with patient email
5. Tap case → should show full medication list
6. Sign out → should return to login

# Staff Search + ATC Browser Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add an enhanced staff-only search with ingredient-grouped results and an ATC classification browser with hierarchical drill-down.

**Architecture:** New Supabase RPCs query `rx_drug_products` + `rx_atc_reference_latest` for grouped search and ATC browsing. Mobile app gets two new screens: StaffSearchScreen (concept groups) and ATCBrowserScreen (hierarchical tree). Staff-only feature.

**Tech Stack:** Supabase RPCs, React Native + Expo, React Navigation

---

## Decisions
- ATC browser is staff-only
- No Bulk Search for now
- Reuse existing DrugDetailScreen for brand detail
- Ingredient-centric search (concept groups) replaces flat card list for staff
- ATC codes shown as clickable chips that open ATCBrowserScreen
- Breadcrumb navigation in ATC browser

---

## Phase 1: Database

### Task 1.1 — `search_drugs_grouped(p_query)` RPC

**Objective:** Search drugs grouped by ingredient with ATC name resolution.

Returns: ingredient, atc_code, atc_name, brand_count, top brands.

### Task 1.2 — `browse_atc_level(p_prefix)` RPC

**Objective:** Return children at any ATC level for hierarchical browsing.

- Empty prefix → L1 (14 categories, length=1)
- 1-char → L2 (length=3)
- 3-char → L3 (length=4)
- 4-char → L4 (length=5)
Returns: atc_code, atc_name, drug_count.

### Task 1.3 — `browse_atc_drugs(p_atc_prefix)` RPC

**Objective:** Return drugs grouped by ingredient for a given ATC prefix.

Returns: ingredient, atc_code, brand_count, brands[].

---

## Phase 2: Mobile API

### Task 2.1 — Create `src/api/staffSearch.ts`

API functions: `searchDrugsGrouped(query)`, `browseATCLevel(prefix)`, `browseATCDrugs(atcPrefix)`.

---

## Phase 3: Staff Search Screen

### Task 3.1 — `StaffSearchScreen.tsx`

Two modes: Text Search (concept groups) and Browse ATC (hierarchical).

### Task 3.2 — Update StaffTabs navigation

Add StaffSearch tab + ATCBrowserScreen to navigation stack.

---

## Phase 4: ATC Browser

### Task 4.1 — `ATCBrowserScreen.tsx`

Breadcrumb nav, grid cards at each level, ingredient-grouped view at L4, tap → brands → DrugDetail.

---

## Phase 5: i18n

### Task 5.1 — Add staff search strings

en.json + zh-TW.json keys for search, ATC browser, concept groups.

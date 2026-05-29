# RxNorm Tasks 1-4 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the initial Python ETL scaffold, environment and dataset documentation, reusable parsing and normalization helpers, and idempotent Supabase migrations for the raw and curated Taiwan RxNorm schema.

**Architecture:** Use a small Python package under `etl/` for pure ETL helpers and future import entry points, with utility behavior locked by `pytest` tests. Create two ordered SQL migration files under `supabase/migrations/` so raw ingestion objects are provisioned before curated tables, helper functions, and the enriched application view.

**Tech Stack:** Python 3.11+, pytest, PostgreSQL/Supabase SQL

---

### Task 1: Scaffold Python package and test layout

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\pyproject.toml`
- Create: `e:\TRAE\Projects\RxNorm\etl\__init__.py`
- Create: `e:\TRAE\Projects\RxNorm\etl\config.py`
- Create: `e:\TRAE\Projects\RxNorm\etl\paths.py`
- Create: `e:\TRAE\Projects\RxNorm\tests\test_paths.py`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path

from etl.paths import REQUIRED_DATASETS, discover_dataset_paths


def test_discover_dataset_paths_reports_presence(tmp_path: Path) -> None:
    datasets_dir = tmp_path / "Datasets"
    datasets_dir.mkdir()
    (datasets_dir / "A21030000I-E41001-001.csv").write_text("x", encoding="utf-8")

    result = discover_dataset_paths(datasets_dir)

    assert result["A21030000I-E41001-001.csv"].exists is True
    assert result["A21030000I-E41002-002.csv"].required is False
    assert set(result) == {item.file_name for item in REQUIRED_DATASETS}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_paths.py::test_discover_dataset_paths_reports_presence -v`
Expected: FAIL with `ModuleNotFoundError` or import failure for `etl.paths`

- [ ] **Step 3: Write minimal implementation**

```python
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DatasetSpec:
    file_name: str
    required: bool


@dataclass(frozen=True)
class DatasetLocation:
    spec: DatasetSpec
    path: Path
    exists: bool

    @property
    def required(self) -> bool:
        return self.spec.required


REQUIRED_DATASETS = (
    DatasetSpec("A21030000I-E41001-001.csv", True),
    DatasetSpec("A21030000I-E41002-002.csv", False),
)


def discover_dataset_paths(datasets_dir: Path) -> dict[str, DatasetLocation]:
    return {
        spec.file_name: DatasetLocation(spec=spec, path=datasets_dir / spec.file_name, exists=(datasets_dir / spec.file_name).exists())
        for spec in REQUIRED_DATASETS
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_paths.py::test_discover_dataset_paths_reports_presence -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml etl/__init__.py etl/config.py etl/paths.py tests/test_paths.py
git commit -m "feat: scaffold etl package and dataset discovery"
```

### Task 2: Add tests-first ETL normalization and parsing helpers

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\etl\utils.py`
- Create: `e:\TRAE\Projects\RxNorm\tests\test_utils.py`

- [ ] **Step 1: Write the failing tests**

```python
from decimal import Decimal

from etl.utils import normalize_text, parse_decimal, split_tfda_ingredients


def test_normalize_text_strips_punctuation_and_collapses_whitespace() -> None:
    assert normalize_text("  Acetaminophen (500mg)  ") == "ACETAMINOPHEN 500MG"


def test_parse_decimal_returns_decimal_for_numeric_text() -> None:
    assert parse_decimal("1,234.50") == Decimal("1234.50")


def test_split_tfda_ingredients_preserves_original_segments() -> None:
    assert split_tfda_ingredients("Aspirin ;; Caffeine ;;") == ["Aspirin", "Caffeine"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_utils.py -v`
Expected: FAIL with import failure for `etl.utils`

- [ ] **Step 3: Write minimal implementation**

```python
import re
from decimal import Decimal


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    collapsed = re.sub(r"\s+", " ", value.strip().upper())
    return re.sub(r"[^\w\s]", " ", collapsed).strip()


def parse_decimal(value: str | None) -> Decimal | None:
    if value is None or not value.strip():
        return None
    return Decimal(value.replace(",", "").strip())


def split_tfda_ingredients(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(";;") if part.strip()]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_utils.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add etl/utils.py tests/test_utils.py
git commit -m "feat: add etl normalization utilities"
```

### Task 3: Add env example and operator documentation

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\.env.example`
- Create: `e:\TRAE\Projects\RxNorm\README.md`

- [ ] **Step 1: Write the documentation**

```dotenv
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

```markdown
# RxNorm Taiwan Foundation

## Datasets
- Store source files under `Datasets/` using the exact published filenames.
- Scripts discover them by joining the repository root with `Datasets/<filename>`.
- `A21030000I-E41002-002.csv` is optional.
```

- [ ] **Step 2: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add environment example and dataset guide"
```

### Task 4: Create idempotent raw and curated Supabase migrations

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\supabase\migrations\202605130001_raw_schema.sql`
- Create: `e:\TRAE\Projects\RxNorm\supabase\migrations\202605130002_curated_schema.sql`

- [ ] **Step 1: Write migration assertions as file-content checks**

```python
from pathlib import Path


def test_raw_migration_contains_required_tables() -> None:
    sql = Path("supabase/migrations/202605130001_raw_schema.sql").read_text(encoding="utf-8")
    assert "create table if not exists public.rx_import_batches" in sql.lower()
    assert "create table if not exists public.raw_nhi_items" in sql.lower()


def test_curated_migration_contains_view_and_tables() -> None:
    sql = Path("supabase/migrations/202605130002_curated_schema.sql").read_text(encoding="utf-8")
    assert "create table if not exists public.rx_drug_products" in sql.lower()
    assert "create or replace view public.rx_product_enriched_v" in sql.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_migrations.py -v`
Expected: FAIL with missing file assertions

- [ ] **Step 3: Write minimal SQL implementation**

```sql
create extension if not exists pgcrypto;
create table if not exists public.rx_import_batches (...);
create table if not exists public.raw_nhi_items (...);
create table if not exists public.rx_drug_products (...);
create or replace view public.rx_product_enriched_v as ...;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_migrations.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202605130001_raw_schema.sql supabase/migrations/202605130002_curated_schema.sql tests/test_migrations.py
git commit -m "feat: add raw and curated schema migrations"
```

### Task 5: Verify and lint

**Files:**
- Verify: `e:\TRAE\Projects\RxNorm\tests\test_paths.py`
- Verify: `e:\TRAE\Projects\RxNorm\tests\test_utils.py`
- Verify: `e:\TRAE\Projects\RxNorm\tests\test_migrations.py`

- [ ] **Step 1: Run focused test suite**

Run: `python -m pytest tests -v`
Expected: PASS

- [ ] **Step 2: Run diagnostics**

Run: editor diagnostics on changed files
Expected: no new syntax or import errors

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test: verify tasks 1 through 4 foundation"
```

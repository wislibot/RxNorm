# Taiwan RxNorm Runbook

This repository contains the Taiwan-first RxNorm build pipeline through Tasks 1-10:

- raw Postgres imports for NHI, TFDA, ATC/DDD, and all1 history
- curated rebuild logic for product, ingredient, TFDA bridge, ATC latest, and review queue tables
- QC reporting that generates both Markdown and CSV outputs by default
- operator documentation for local execution, Supabase deployment, and verification SQL

## Prerequisites

- Python 3.11+
- PostgreSQL or a Supabase project
- `DATABASE_URL` that points to the target Postgres database
- Supabase CLI if you want to deploy via Supabase commands

Install the package and script entry points:

```bash
pip install -e .
```

## Dataset Locations

Place source files in `Datasets/` with these exact names:

- `A21030000I-E41001-001.csv`
- `A21030000I-E41002-002.csv` (optional)
- `36_2.csv`
- `37_2.csv`
- `ATC_DDD_fabkury_merged.csv`
- `all1_11505_1.TXT`
- `all1_11505_2.TXT`

The ETL code discovers datasets by resolving the repository root and then joining `Datasets/<filename>`. The optional component mapping file is reported in discovery output and skipped when absent.

## Environment Setup

Copy `.env.example` to `.env` and set:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`

## Local Workflow

Run tests first:

```bash
python -m pytest tests -v
```

Apply database migrations locally:

```bash
psql "$DATABASE_URL" -f supabase/migrations/202605130001_raw_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/202605130002_curated_schema.sql
```

Import raw datasets:

```bash
python -m etl.import_raw --dataset all
```

or

```bash
rxnorm-import-raw --dataset all
```

Supported raw dataset keys are:

- `nhi_items`
- `nhi_component_map`
- `tfda_36`
- `tfda_37`
- `atc_ddd`
- `all1`

Rebuild curated tables transactionally:

```bash
python -m etl.rebuild_curated --database-url <DATABASE_URL>
```

or

```bash
rxnorm-rebuild-curated --database-url <DATABASE_URL>
```

Adjust mismatch handling if needed:

```bash
rxnorm-rebuild-curated --database-url <DATABASE_URL> --review-threshold 0.7
```

Generate QC outputs in both Markdown and CSV by default:

```bash
python -m etl.report_qc --database-url <DATABASE_URL> --output-dir outputs/qc
```

or

```bash
rxnorm-report-qc --database-url <DATABASE_URL> --output-dir outputs/qc
```

## Supabase Workflow

Initialize or link a Supabase project, then push the SQL migrations:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
```

If you prefer direct SQL execution against Supabase Postgres, use the same `psql` commands shown in the local workflow with the Supabase connection string in `DATABASE_URL`.

Use the service role only for ETL and back-office commands. Do not ship it to any client application.

## Verification SQL

The repository includes [verification_queries.sql](file:///e:/TRAE/Projects/RxNorm/docs/verification_queries.sql) with ready-to-run checks for raw tables, curated tables, the enriched view, and review records.

Common examples:

```sql
select count(*) as raw_nhi_items_count from public.raw_nhi_items;
select count(*) as rx_drug_products_count from public.rx_drug_products;
select * from public.rx_product_enriched_v order by nhi_code limit 20;
select * from public.rx_review_queue order by created_at desc limit 20;
```

## Outputs

- Raw imports write into `raw_*` tables and record provenance in `rx_import_batches`
- Curated rebuild writes into `rx_*` tables inside one transaction using truncate plus insert
- QC generation writes `qc_report.md` and `qc_mismatch_examples.csv` under the selected output directory

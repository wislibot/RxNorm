from pathlib import Path


README_PATH = Path("README.md")
VERIFICATION_SQL_PATH = Path("docs/verification_queries.sql")


def test_readme_includes_local_supabase_and_qc_commands() -> None:
    text = README_PATH.read_text(encoding="utf-8")

    assert "rxnorm-import-raw --dataset all" in text
    assert "rxnorm-rebuild-curated --database-url <DATABASE_URL>" in text
    assert "python -m etl.report_qc" in text
    assert "supabase db push" in text
    assert "verification_queries.sql" in text


def test_verification_sql_contains_expected_checks() -> None:
    text = VERIFICATION_SQL_PATH.read_text(encoding="utf-8")

    assert "select count(*) as raw_nhi_items_count from public.raw_nhi_items;" in text.lower()
    assert "select count(*) as rx_drug_products_count from public.rx_drug_products;" in text.lower()
    assert "select * from public.rx_product_enriched_v" in text.lower()
    assert "select * from public.rx_review_queue" in text.lower()

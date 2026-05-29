from __future__ import annotations

from pathlib import Path


def test_report_qc_cli_uses_repository_factory_and_writes_outputs(tmp_path: Path) -> None:
    from etl.report_qc import run_cli

    captured: dict[str, object] = {}

    class FakeRepository:
        def fetch_qc_inputs(self):
            captured["fetch_called"] = True
            return {"rx_drug_products": []}

    def fake_repository_factory(database_url: str):
        captured["database_url"] = database_url
        return FakeRepository()

    def fake_build_report(dataset, mismatch_limit: int):
        captured["dataset"] = dataset
        captured["mismatch_limit"] = mismatch_limit
        return {"summary": {}, "top_tfda_mismatches": []}

    def fake_write_outputs(report, output_dir: Path):
        captured["report"] = report
        captured["output_dir"] = output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        markdown = output_dir / "qc_report.md"
        csv_file = output_dir / "qc_mismatch_examples.csv"
        markdown.write_text("# QC Report\n", encoding="utf-8")
        csv_file.write_text("nhi_code\n", encoding="utf-8")
        return {"markdown": markdown, "csv": csv_file}

    exit_code = run_cli(
        [
            "--database-url",
            "postgresql://example",
            "--output-dir",
            str(tmp_path),
            "--mismatch-limit",
            "7",
        ],
        repository_factory=fake_repository_factory,
        report_builder=fake_build_report,
        output_writer=fake_write_outputs,
    )

    assert exit_code == 0
    assert captured["database_url"] == "postgresql://example"
    assert captured["mismatch_limit"] == 7
    assert captured["output_dir"] == tmp_path
    assert captured["fetch_called"] is True

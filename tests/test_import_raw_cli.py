from __future__ import annotations

from pathlib import Path


def test_run_cli_imports_all_and_skips_missing_optional_component(tmp_path: Path) -> None:
    from etl.import_raw import run_cli

    datasets_dir = tmp_path / "Datasets"
    datasets_dir.mkdir()
    (datasets_dir / "A21030000I-E41001-001.csv").write_text(
        "異動,藥品代號,藥品英文名稱,藥品中文名稱,成分,規格量,規格單位,單複方,支付價,有效起日,有效迄日,藥商,製造廠名稱,劑型,藥品分類,分類分組名稱,ATC代碼,給付規定章節,藥品代碼超連結,給付規定章節連結\n"
        "N,A0001,TEST,測試,Acetaminophen,500,MG,單方,10.5,1130101,,Vendor,Maker,錠劑,Class,Group,N02BE01,2.1,https://example.com,https://example.com\n",
        encoding="utf-8",
    )
    for file_name in ("36_2.csv", "37_2.csv"):
        (datasets_dir / file_name).write_text(
            "許可證字號,註銷狀態,註銷日期,註銷理由,有效日期,發證日期,許可證種類,舊證字號,通關簽審文件編號,中文品名,英文品名,適應症,劑型,包裝,藥品類別,管制藥品分類級別,主成分略述,申請商名稱,申請商地址,申請商統一編號,製造商名稱,製造廠廠址,製造廠公司地址,製造廠國別,製程,異動日期,用法用量,包裝與國際條碼\n"
            "衛署藥製字第012345號,未註銷,,,2026-12-31,2020-01-01,製劑,,,測試,TEST,Pain,錠劑,盒裝,處方,,Acetaminophen,Applicant,Address,12345678,Manufacturer,Plant,Company,TW,Process,2024/01/01,Use,Barcode\n",
            encoding="utf-8",
        )
    (datasets_dir / "ATC_DDD_fabkury_merged.csv").write_text(
        "snapshot_date,record_type,atc_code,atc_name,ddd,uom,adm_r,note,brand_name,dosage_form,ingredients,ddd_comb\n"
        "2026-01-01,atc,N02BE01,PARACETAMOL,3.0,g,O,,,tablet,Acetaminophen,\n",
        encoding="utf-8",
    )
    for index, file_name in enumerate(("all1_11505_1.TXT", "all1_11505_2.TXT"), start=1):
        (datasets_dir / file_name).write_text(
            "              N  A000133209     99.00 0840301 0890331 PROLUTON DEPOT INJECTION 250 MG"
            "                                                                                             1.00 ML"
            "                                                   HYDROXYPROGESTERONE CAPROATE"
            "                                  250.000 MG/ML"
            "                                               注射劑"
            "                                                                                                                                                                                                                                                臺灣赫美龍股份有限公"
            "                                                                                                                                               1   持續性保路通注射液２５０公絲"
            "                                                                                                     HYDROXYPROGESTERONE , 注射劑 , 250.00 MG"
            "                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  臺灣赫美龍股份有限公司"
            "                     G03DA03   \n",
            encoding="cp950",
        )

    captured: list[tuple[str, str | None, int]] = []

    class FakeRepository:
        def start_batch(self, source_name: str, source_version: str | None = None, notes: str | None = None) -> str:
            return f"batch-{source_name}"

        def insert_rows(self, table_name: str, columns: tuple[str, ...], rows, import_batch_id: str) -> int:
            row_list = list(rows)
            captured.append((table_name, import_batch_id, len(row_list)))
            return len(row_list)

        def replace_simple_rows(self, table_name: str, columns: tuple[str, ...], rows) -> int:
            row_list = list(rows)
            captured.append((table_name, "replace", len(row_list)))
            return len(row_list)

        def complete_batch(self, import_batch_id: str, row_count: int) -> None:
            return None

    exit_code = run_cli(
        [
            "--dataset",
            "all",
            "--datasets-dir",
            str(datasets_dir),
            "--database-url",
            "postgresql://example",
        ],
        repository_factory=lambda _database_url: FakeRepository(),
    )

    assert exit_code == 0
    assert captured == [
        ("raw_nhi_items", "batch-nhi_items", 1),
        ("raw_tfda_permits_all", "batch-tfda_36", 1),
        ("raw_tfda_permits_active", "batch-tfda_37", 1),
        ("raw_atc_ddd", "batch-atc_ddd", 1),
        ("rx_qc_all1_code_set", "replace", 1),
    ]

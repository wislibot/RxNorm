from decimal import Decimal
from pathlib import Path


def test_map_nhi_item_row_coerces_core_fields() -> None:
    from etl.raw_import import map_nhi_item_row

    row = {
        "異動": "N",
        "藥品代號": "A000123456",
        "藥品英文名稱": "TEST DRUG",
        "藥品中文名稱": "測試藥品",
        "成分": "Acetaminophen",
        "規格量": "500",
        "規格單位": "MG",
        "單複方": "單方",
        "支付價": "12.34",
        "有效起日": "1130101",
        "有效迄日": "",
        "藥商": "Vendor",
        "製造廠名稱": "Maker",
        "劑型": "錠劑",
        "藥品分類": "Class",
        "分類分組名稱": "Group",
        "ATC代碼": "N02BE01",
        "給付規定章節": "2.1",
        "藥品代碼超連結": "https://example.com/?permitNo=衛署藥製字第012345號",
        "給付規定章節連結": "https://example.com/rule",
    }

    mapped = map_nhi_item_row(row)

    assert mapped["nhi_code"] == "A000123456"
    assert mapped["strength_value"] == Decimal("500")
    assert mapped["price_nhi"] == Decimal("12.34")
    assert mapped["effective_start"].isoformat() == "2024-01-01"
    assert mapped["effective_end"] is None


def test_map_tfda_permit_row_preserves_text_and_dates() -> None:
    from etl.raw_import import map_tfda_permit_row

    row = {
        "許可證字號": "衛署藥製字第012345號",
        "註銷狀態": "未註銷",
        "註銷日期": "",
        "註銷理由": "",
        "有效日期": "2026-12-31",
        "發證日期": "2020-01-01",
        "許可證種類": "製劑",
        "舊證字號": "",
        "通關簽審文件編號": "",
        "中文品名": "測試藥品",
        "英文品名": "TEST DRUG",
        "適應症": "Pain",
        "劑型": "錠劑",
        "包裝": "盒裝",
        "藥品類別": "處方",
        "管制藥品分類級別": "",
        "主成分略述": "Acetaminophen ;; Caffeine",
        "申請商名稱": "Applicant",
        "申請商地址": "Address",
        "申請商統一編號": "12345678",
        "製造商名稱": "Manufacturer",
        "製造廠廠址": "Plant",
        "製造廠公司地址": "Company",
        "製造廠國別": "TW",
        "製程": "Process",
        "異動日期": "2024/01/01",
        "用法用量": "Use",
        "包裝與國際條碼": "Barcode",
    }

    mapped = map_tfda_permit_row(row)

    assert mapped["tfda_permit_no"] == "衛署藥製字第012345號"
    assert mapped["expiry_date"].isoformat() == "2026-12-31"
    assert mapped["change_date"].isoformat() == "2024-01-01"
    assert mapped["ingredient_text_tfda"] == "Acetaminophen ;; Caffeine"


def test_map_atc_row_parses_snapshot_and_numeric_ddd() -> None:
    from etl.raw_import import map_atc_row

    row = {
        "snapshot_date": "2026-01-01",
        "record_type": "atc",
        "atc_code": "N02BE01",
        "atc_name": "PARACETAMOL",
        "ddd": "3.0",
        "uom": "g",
        "adm_r": "O",
        "note": "",
        "brand_name": "",
        "dosage_form": "tablet",
        "ingredients": "Acetaminophen",
        "ddd_comb": "",
    }

    mapped = map_atc_row(row)

    assert mapped["snapshot_date"].isoformat() == "2026-01-01"
    assert mapped["ddd"] == Decimal("3.0")
    assert mapped["atc_code"] == "N02BE01"


def test_parse_all1_line_extracts_history_fields() -> None:
    from etl.raw_import import parse_all1_line

    line = (
        "              N  A000133209     99.00 0840301 0890331 PROLUTON DEPOT INJECTION 250 MG"
        "                                                                                             1.00 ML"
        "                                                   HYDROXYPROGESTERONE CAPROATE"
        "                                  250.000 MG/ML"
        "                                               注射劑"
        "                                                                                                                                                                                                                                                臺灣赫美龍股份有限公"
        "                                                                                                                                               1   持續性保路通注射液２５０公絲"
        "                                                                                                     HYDROXYPROGESTERONE , 注射劑 , 250.00 MG"
        "                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  臺灣赫美龍股份有限公司"
        "                     G03DA03   "
    )

    mapped = parse_all1_line(line)

    assert mapped["validation_status"] == "N"
    assert mapped["nhi_code"] == "A000133209"
    assert mapped["price_nhi"] == Decimal("99.00")
    assert mapped["effective_start"].isoformat() == "1995-03-01"
    assert mapped["effective_end"].isoformat() == "2000-03-31"
    assert mapped["name_en"] == "PROLUTON DEPOT INJECTION 250 MG"
    assert mapped["package_quantity"] == Decimal("1.00")
    assert mapped["package_unit"] == "ML"
    assert mapped["ingredient_text"] == "HYDROXYPROGESTERONE CAPROATE"
    assert mapped["dose_form"] == "注射劑"
    assert mapped["name_zh"] == "持續性保路通注射液２５０公絲"
    assert mapped["manufacturer_name"] == "臺灣赫美龍股份有限公司"
    assert mapped["atc_code"] == "G03DA03"


def test_parse_all1_line_handles_long_name_and_literal_unit_text() -> None:
    from etl.raw_import import parse_all1_line

    line = Path("Datasets/all1_11505_1.TXT").read_text(encoding="cp950", errors="replace").splitlines()[947]

    mapped = parse_all1_line(line)

    assert mapped["name_en"] == 'DEXTROSE 2.5％ AND SODIUM CHLORIDE 0.45％ INJECTION "Y.F."'
    assert mapped["package_quantity"] == Decimal("1.00")
    assert mapped["package_unit"] == "L (LITER)"
    assert mapped["ingredient_text"] == "SODIUM CHLORIDE"
    assert mapped["strength_text"] == "4.500 G/L"
    assert mapped["dose_form"] == "注射劑"
    assert mapped["atc_code"] == "B05BB02"


def test_parse_all1_line_handles_missing_dose_form() -> None:
    from etl.raw_import import parse_all1_line

    line = Path("Datasets/all1_11505_1.TXT").read_text(encoding="cp950", errors="replace").splitlines()[7826]

    mapped = parse_all1_line(line)

    assert mapped["strength_text"] == "5.000 MG"
    assert mapped["dose_form"] is None

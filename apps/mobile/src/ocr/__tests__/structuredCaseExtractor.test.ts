import { extractCaseFields } from '../structuredCaseExtractor';

describe('extractCaseFields', () => {
  test('extracts patient name, sex, quantity, pharmacy, and dispensing date from Taiwan label OCR', () => {
    const ocrRawText = [
      '內湖 總院',
      '地址：台北市內湖區成功路二段325號',
      '姓名：陳小明 男',
      'Medication 60puff/bot(tiotropium)',
      'Spiriva Respimat 2.5mcg/puff,總量1盒',
      '適喘樂舒噴吸入劑',
      '用法 Take after meals, once daily',
      '用途 COPD maintenance',
      '警語 Avoid alcohol while taking',
      '副作用 Dry mouth, dizziness',
      '調劑藥師：王大明',
      '調劑日期：2026/05/25',
      '領藥號 123456789',
    ].join('\n');

    const result = extractCaseFields(ocrRawText);

    expect(result.patientName).toBe('陳小明');
    expect(result.patientSex).toBe('M');
    expect(result.quantity).toBe('1盒');
    expect(result.directions).toBe('Take after meals, once daily');
    expect(result.indications).toEqual(['COPD maintenance']);
    expect(result.warnings).toEqual(['Avoid alcohol while taking']);
    expect(result.sideEffects).toEqual(['Dry mouth, dizziness']);
    expect(result.pharmacyAddress).toBe('台北市內湖區成功路二段325號');
    expect(result.pharmacistName).toBe('王大明');
    expect(result.dispensingDate).toBe('2026-05-25');
  });

  test('extracts quantity from total amount field when present', () => {
    const result = extractCaseFields('Spiriva Respimat 2.5mcg/puff,總量3瓶');
    expect(result.quantity).toBe('3瓶');
  });

  test('returns null for sex when not present', () => {
    const result = extractCaseFields('姓名：陳小明\nMedication 60puff/bot(tiotropium)');
    expect(result.patientSex).toBeNull();
    expect(result.patientName).toBe('陳小明');
  });

  test('parses dispensing date in YYYY/MM/DD format', () => {
    const result = extractCaseFields('調劑日期：2026/05/25');
    expect(result.dispensingDate).toBe('2026-05-25');
  });

  test('detects pharmacy name from hospital/clinic line', () => {
    const result = extractCaseFields('台南仁愛醫院\n地址：台南市東區');
    expect(result.pharmacyName).toBe('台南仁愛醫院');
    expect(result.pharmacyAddress).toBe('台南市東區');
  });

  test('extracts sex from standalone 男 token before section headers', () => {
    const result = extractCaseFields([
      '地址：台北市內湖區',
      '姓名：陳小明',
      '男',
      'Spiriva Respimat 2.5mcg/puff',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.patientName).toBe('陳小明');
    expect(result.patientSex).toBe('M');
  });

  test('extracts sex from standalone 女 token before section headers', () => {
    const result = extractCaseFields([
      '姓名：林小美',
      '女',
      'Medication 60puff/bot(tiotropium)',
      '適喘樂舒噴吸入劑',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.patientSex).toBe('F');
  });

  test('returns null when both 男 and 女 appear before section headers', () => {
    const result = extractCaseFields([
      '姓名：陳小明',
      '男',
      '女',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.patientSex).toBeNull();
  });

  test('extracts pharmacist name from OCR typo variant 詞劑樂師', () => {
    const result = extractCaseFields('詞劑樂師林OO\n調劑日期：2026/05/25');
    expect(result.pharmacistName).toBe('林OO');
  });

  test('extracts pharmacist name from OCR variant 調劑樂師', () => {
    const result = extractCaseFields('調劑樂師：王大明\nMedication 60puff/bot');
    expect(result.pharmacistName).toBe('王大明');
  });

  test('extracts pharmacist name from OCR variant 詞劑藥師', () => {
    const result = extractCaseFields('詞劑藥師張小明\n用法 Take after meals');
    expect(result.pharmacistName).toBe('張小明');
  });

  test('extracts pharmacist name from English "Pharmacist" label with next-line name', () => {
    const result = extractCaseFields([
      'Spiriva Respimat 2.5mcg/puff',
      'Pharmacist',
      '林OO',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.pharmacistName).toBe('林OO');
  });

  test('extracts pharmacist name from English "Pharmacist" label with masked name', () => {
    const result = extractCaseFields([
      'Medication 60puff/bot',
      'Pharmacist',
      'LinOO',
      '調劑日期：2026/05/25',
    ].join('\n'));
    expect(result.pharmacistName).toBe('LinOO');
  });

  test('extracts dispensing date from next line when anchor has no same-line value', () => {
    const result = extractCaseFields([
      '姓名：陳小明',
      '調劑日期',
      '2026/05/25',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.dispensingDate).toBe('2026-05-25');
  });

  test('extracts dispensing date in YYYY.MM.DD format', () => {
    const result = extractCaseFields('調劑日期：2026.05.25');
    expect(result.dispensingDate).toBe('2026-05-25');
  });

  test('returns null for dispensing date when anchor exists but no date nearby', () => {
    const result = extractCaseFields('調劑日期\n用法 Take after meals');
    expect(result.dispensingDate).toBeNull();
  });

  test('extracts physician name from same line as label', () => {
    const result = extractCaseFields([
      '處方醫師：王小明',
      '調劑藥師：林大明',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.physicianName).toBe('王小明');
  });

  test('extracts physician name from next line when same-line empty', () => {
    const result = extractCaseFields([
      '處方醫師',
      '王小明',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.physicianName).toBe('王小明');
  });

  test('does not capture another label keyword as physician name', () => {
    const result = extractCaseFields([
      '處方醫師',
      '用法',
      '調劑日期',
    ].join('\n'));
    expect(result.physicianName).toBeNull();
  });

  test('extracts physician name from English "Physician" label next line', () => {
    const result = extractCaseFields([
      'Physician',
      '陳OO',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.physicianName).toBe('陳OO');
  });

  test('extracts pharmacist name from next line when Chinese label has no same-line value', () => {
    const result = extractCaseFields([
      '處方醫師：王小明',
      '調劑藥師',
      '林大明',
      '用法 Take after meals',
    ].join('\n'));
    expect(result.pharmacistName).toBe('林大明');
  });

  test('does not capture another label as pharmacist name in fallback', () => {
    const result = extractCaseFields([
      '調劑藥師',
      '用法',
      '調劑日期',
    ].join('\n'));
    expect(result.pharmacistName).toBeNull();
  });
});

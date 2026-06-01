import { createCase } from '../case';

jest.mock('../../photos/processPhoto', () => ({
  createUploadImage: jest.fn().mockResolvedValue({ uri: 'processed://upload.jpg', mimeType: 'image/jpeg' }),
  createThumbnailImage: jest.fn().mockResolvedValue({ uri: 'processed://thumb.jpg', mimeType: 'image/jpeg' }),
}));

import { createUploadImage, createThumbnailImage } from '../../photos/processPhoto';

const mockCreateUploadImage = createUploadImage as jest.Mock;
const mockCreateThumbnailImage = createThumbnailImage as jest.Mock;

describe('createCase', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('uploads processed images and thumbnails while keeping original URIs for OCR', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: {
        get: jest.fn().mockReturnValue('image/jpeg'),
      },
    }) as unknown as typeof fetch;

    mockCreateUploadImage.mockResolvedValue({ uri: 'processed://upload.jpg', mimeType: 'image/jpeg' });
    mockCreateThumbnailImage.mockResolvedValue({ uri: 'processed://thumb.jpg', mimeType: 'image/jpeg' });

    const single = jest.fn().mockResolvedValue({
      data: { case_id: 'case-123' },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockImplementation((table: string) => {
      if (table !== 'rx_cases') {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        insert,
        update,
      };
    });

    const upload = jest.fn().mockResolvedValue({ data: null, error: null });
    const storageFrom = jest.fn().mockReturnValue({ upload });
    const rpc = jest.fn().mockImplementation((fnName: string) => {
      if (fnName === 'rx_match_medication_lines') {
        return Promise.resolve({
          data: [
            {
              confidence: 0.9,
              ingredient_canonical_name: 'TIOTROPIUM',
              ingredient_id: 'ingredient-tiotropium',
              input_index: 0,
              input_text: 'Spiriva Respimat 2 puff (tiotropium)',
              match_method: 'paren_alias_exact',
              match_status: 'matched',
              normalized_text: 'SPIRIVA RESPIMAT 2 PUFF TIOTROPIUM',
            },
            {
              confidence: 0.95,
              ingredient_canonical_name: 'TIOTROPIUM',
              ingredient_id: 'ingredient-tiotropium',
              input_index: 1,
              input_text: 'Tiotropium',
              match_method: 'canonical_exact',
              match_status: 'matched',
              normalized_text: 'TIOTROPIUM',
            },
          ],
          error: null,
        });
      }
      if (fnName === 'rx_match_brand_lines') {
        return Promise.resolve({
          data: [
            {
              confidence: 0.95,
              input_index: 0,
              input_text: 'Spiriva Respimat 2 puff (tiotropium)',
              match_method: 'product_exact',
              match_status: 'matched',
              nhi_code: 'B025033161',
              normalized_text: 'SPIRIVA RESPIMAT',
              product_display_name: 'Spiriva Respimat 2.5mcg, Solution for Inhalation',
              product_id: 'B025033161',
              product_name_zh: '適喘樂舒沛噴吸入劑 2.5 微公克',
              product_name_en: 'Spiriva Respimat 2.5mcg, Solution for Inhalation',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const client = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from,
      rpc,
      storage: {
        from: storageFrom,
      },
    } as never;

    const result = await createCase(
      {
        caseType: 'medicine_bag',
        ingredientIds: [],
        ocrRawText: 'Spiriva Respimat\n2 paff (tiotropium)\nTiotropium',
        photoUris: ['file://photo-1.jpg', 'file://photo-2.jpg'],
        sectionedOcr: {
          sections: {
            medication: {
              lines: [
                { text: 'Spiriva Respimat', frame: { x: 120, y: 42, width: 180, height: 16 } },
                { text: '2 paff (tiotropium)', frame: { x: 120, y: 64, width: 160, height: 16 } },
                { text: 'Tiotropium', frame: { x: 120, y: 86, width: 100, height: 16 } },
              ],
              texts: ['Spiriva Respimat', '2 paff (tiotropium)', 'Tiotropium'],
            },
            instruction: {
              lines: [{ text: 'Take after meals', frame: { x: 120, y: 122, width: 80, height: 16 } }],
              texts: ['Take after meals'],
            },
            indications: { lines: [], texts: [] },
            warnings: { lines: [], texts: [] },
            side_effects: { lines: [], texts: [] },
            prescription_no: {
              lines: [{ text: '123456789', frame: { x: 120, y: 150, width: 80, height: 16 } }],
              texts: ['123456789'],
            },
            dispensing_date: { lines: [], texts: [] },
            quantity: { lines: [], texts: [] },
            pharmacist: { lines: [], texts: [] },
            unassigned: {
              lines: [{ text: '(06)2677282', frame: { x: 18, y: 250, width: 90, height: 16 } }],
              texts: ['(06)2677282'],
            },
          },
        },
      },
      client,
    );

    expect(result).toEqual({ caseId: 'case-123' });
    expect(rpc).toHaveBeenCalledWith('rx_match_medication_lines', {
      medication_lines: ['Spiriva Respimat 2 puff (tiotropium)', 'Tiotropium'],
    });
    expect(rpc).toHaveBeenCalledWith('rx_match_brand_lines', {
      brand_lines: ['Spiriva Respimat 2 puff (tiotropium)', 'Tiotropium'],
    });
    expect(insert).toHaveBeenCalledWith({
      case_type: 'medicine_bag',
      detected_items: [
        {
          confidence: 0.9,
          display_name: 'TIOTROPIUM',
          ingredient_id: 'ingredient-tiotropium',
          match_method: 'paren_alias_exact',
          match_status: 'matched',
          nhi_code: null,
          note: null,
          raw_text: 'Spiriva Respimat 2 puff (tiotropium)',
          source: 'ocr_line',
        },
        {
          confidence: 0.95,
          display_name: 'TIOTROPIUM',
          ingredient_id: 'ingredient-tiotropium',
          match_method: 'canonical_exact',
          match_status: 'matched',
          nhi_code: null,
          note: null,
          raw_text: 'Tiotropium',
          source: 'ocr_line',
        },
      ],
      ingredient_ids: ['ingredient-tiotropium'],
      ocr_raw_text: 'Spiriva Respimat\n2 paff (tiotropium)\nTiotropium',
      ocr_sections: {
        medication_lines: ['Spiriva Respimat', '2 paff (tiotropium)', 'Tiotropium'],
        instruction_lines: ['Take after meals'],
        indications_lines: [],
        warnings_lines: [],
        side_effects_lines: [],
        dispensing_date_lines: [],
        quantity_lines: [],
        pharmacist_lines: [],
        remote_model: null,
        case_fields: {
          brandMatches: [
            {
              confidence: 0.95,
              displayName: 'Spiriva Respimat 2.5mcg, Solution for Inhalation',
              nameEn: 'Spiriva Respimat 2.5mcg, Solution for Inhalation',
              nameZh: '適喘樂舒沛噴吸入劑 2.5 微公克',
              nhiCode: 'B025033161',
              productId: 'B025033161',
            },
          ],
          brandNames: ['適喘樂舒沛噴吸入劑 2.5 微公克 (Spiriva Respimat 2.5mcg, Solution for Inhalation)'],
          directions: 'Take after meals',
          dispensingDate: null,
          indications: [],
          patientName: null,
          patientSex: null,
          pharmacistName: null,
          physicianName: null,
          pharmacyAddress: null,
          pharmacyName: null,
          quantity: null,
          sideEffects: [],
          warnings: [],
        },
      },
      photo_paths: [],
      share_to_all_care_teams: true,
      user_id: 'user-123',
    });
    expect(upload).toHaveBeenCalledTimes(4);
    expect(upload).toHaveBeenNthCalledWith(
      1,
      'user-123/case-123/0.jpg',
      expect.any(ArrayBuffer),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    );
    expect(upload).toHaveBeenNthCalledWith(
      2,
      'user-123/case-123/0_thumb.jpg',
      expect.any(ArrayBuffer),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    );
    expect(upload).toHaveBeenNthCalledWith(
      3,
      'user-123/case-123/1.jpg',
      expect.any(ArrayBuffer),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    );
    expect(upload).toHaveBeenNthCalledWith(
      4,
      'user-123/case-123/1_thumb.jpg',
      expect.any(ArrayBuffer),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    );
    expect(mockCreateUploadImage).toHaveBeenCalledTimes(2);
    expect(mockCreateUploadImage).toHaveBeenCalledWith('file://photo-1.jpg');
    expect(mockCreateUploadImage).toHaveBeenCalledWith('file://photo-2.jpg');
    expect(mockCreateThumbnailImage).toHaveBeenCalledTimes(2);
    expect(mockCreateThumbnailImage).toHaveBeenCalledWith('file://photo-1.jpg');
    expect(mockCreateThumbnailImage).toHaveBeenCalledWith('file://photo-2.jpg');
    expect(update).toHaveBeenCalledWith({
      photo_paths: ['user-123/case-123/0.jpg', 'user-123/case-123/1.jpg'],
    });
    expect(eq).toHaveBeenCalledWith('case_id', 'case-123');
  });

  test('createCase uses LLM caseFields when available', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: {
        get: jest.fn().mockReturnValue('image/jpeg'),
      },
    }) as unknown as typeof fetch;

    mockCreateUploadImage.mockResolvedValue({ uri: 'processed://upload.jpg', mimeType: 'image/jpeg' });
    mockCreateThumbnailImage.mockResolvedValue({ uri: 'processed://thumb.jpg', mimeType: 'image/jpeg' });

    const single = jest.fn().mockResolvedValue({
      data: { case_id: 'case-llm' },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockImplementation((table: string) => {
      if (table !== 'rx_cases') {
        throw new Error(`Unexpected table ${table}`);
      }
      return { insert, update };
    });

    const upload = jest.fn().mockResolvedValue({ data: null, error: null });
    const storageFrom = jest.fn().mockReturnValue({ upload });
    const rpc = jest.fn().mockImplementation((fnName: string) => {
      if (fnName === 'rx_match_medication_lines') {
        return Promise.resolve({
          data: [
            {
              confidence: 0.9,
              ingredient_canonical_name: 'TIOTROPIUM',
              ingredient_id: 'ingredient-tiotropium',
              input_index: 0,
              input_text: 'Spiriva Respimat 2 puff (tiotropium)',
              match_method: 'paren_alias_exact',
              match_status: 'matched',
              normalized_text: 'SPIRIVA RESPIMAT 2 PUFF TIOTROPIUM',
            },
          ],
          error: null,
        });
      }
      if (fnName === 'rx_match_brand_lines') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const client = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from,
      rpc,
      storage: { from: storageFrom },
    } as never;

    const result = await createCase(
      {
        caseType: 'medicine_bag',
        ingredientIds: [],
        ocrRawText: 'Spiriva Respimat\n2 paff (tiotropium)',
        photoUris: ['file://photo-1.jpg'],
        sectionedOcr: {
          sections: {
            medication: {
              lines: [{ text: 'Spiriva Respimat', frame: { x: 120, y: 42, width: 180, height: 16 } }],
              texts: ['Spiriva Respimat'],
            },
            instruction: {
              lines: [{ text: '每天兩次', frame: { x: 120, y: 122, width: 80, height: 16 } }],
              texts: ['每天兩次'],
            },
            indications: { lines: [], texts: [] },
            warnings: { lines: [], texts: [] },
            side_effects: { lines: [], texts: [] },
            prescription_no: { lines: [], texts: [] },
            dispensing_date: { lines: [], texts: [] },
            quantity: { lines: [], texts: [] },
            pharmacist: { lines: [], texts: [] },
            unassigned: { lines: [], texts: [] },
          },
          modelData: {
            engine: 'paddleocr-ppstructurev3',
            version: 'v1',
            pages: [],
            case_fields: {
              patientName: '王小花',
              patientSex: 'F',
              prescriptionNo: '15432',
              medicationName: 'Trajenta DUO',
              quantity: '28粒',
              directions: '每天兩次，早晚飯後使用',
              indications: '治療第二型糖尿病',
              warnings: null,
              sideEffects: null,
              appearance: null,
              pharmacyName: '台北慈濟醫院',
              pharmacyAddress: null,
              pharmacistName: null,
              physicianName: null,
              dispensingDate: '2024-04-25',
              useBefore: null,
            },
            extraction_engine: 'llm',
            extraction_fallback: false,
          },
        },
      },
      client,
    );

    expect(result).toEqual({ caseId: 'case-llm' });

    const insertArg = insert.mock.calls[0][0];
    expect(insertArg.ocr_sections.case_fields.patientName).toBe('王小花');
    expect(insertArg.ocr_sections.case_fields.patientSex).toBe('F');
    expect(insertArg.ocr_sections.case_fields.indications).toEqual(['治療第二型糖尿病']);
    expect(insertArg.ocr_sections.case_fields.pharmacyName).toBe('台北慈濟醫院');
  });

  test('createCase falls back to regex when case_fields is null in modelData', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: {
        get: jest.fn().mockReturnValue('image/jpeg'),
      },
    }) as unknown as typeof fetch;

    mockCreateUploadImage.mockResolvedValue({ uri: 'processed://upload.jpg', mimeType: 'image/jpeg' });
    mockCreateThumbnailImage.mockResolvedValue({ uri: 'processed://thumb.jpg', mimeType: 'image/jpeg' });

    const single = jest.fn().mockResolvedValue({
      data: { case_id: 'case-fallback' },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockImplementation((table: string) => {
      if (table !== 'rx_cases') {
        throw new Error(`Unexpected table ${table}`);
      }
      return { insert, update };
    });

    const upload = jest.fn().mockResolvedValue({ data: null, error: null });
    const storageFrom = jest.fn().mockReturnValue({ upload });
    const rpc = jest.fn().mockImplementation((fnName: string) => {
      if (fnName === 'rx_match_medication_lines') {
        return Promise.resolve({
          data: [
            {
              confidence: 0.9,
              ingredient_canonical_name: 'TIOTROPIUM',
              ingredient_id: 'ingredient-tiotropium',
              input_index: 0,
              input_text: 'Spiriva Respimat 2 puff (tiotropium)',
              match_method: 'paren_alias_exact',
              match_status: 'matched',
              normalized_text: 'SPIRIVA RESPIMAT 2 PUFF TIOTROPIUM',
            },
          ],
          error: null,
        });
      }
      if (fnName === 'rx_match_brand_lines') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const client = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from,
      rpc,
      storage: { from: storageFrom },
    } as never;

    const result = await createCase(
      {
        caseType: 'medicine_bag',
        ingredientIds: [],
        ocrRawText: 'Spiriva Respimat\n2 paff (tiotropium)',
        photoUris: ['file://photo-1.jpg'],
        sectionedOcr: {
          sections: {
            medication: {
              lines: [{ text: 'Spiriva Respimat', frame: { x: 120, y: 42, width: 180, height: 16 } }],
              texts: ['Spiriva Respimat'],
            },
            instruction: {
              lines: [{ text: '每天兩次', frame: { x: 120, y: 122, width: 80, height: 16 } }],
              texts: ['每天兩次'],
            },
            indications: { lines: [], texts: [] },
            warnings: { lines: [], texts: [] },
            side_effects: { lines: [], texts: [] },
            prescription_no: { lines: [], texts: [] },
            dispensing_date: { lines: [], texts: [] },
            quantity: { lines: [], texts: [] },
            pharmacist: { lines: [], texts: [] },
            unassigned: { lines: [], texts: [] },
          },
          modelData: {
            engine: 'paddleocr-ppstructurev3',
            version: 'v1',
            pages: [],
            case_fields: null,
            extraction_engine: 'none',
            extraction_fallback: true,
          },
        },
      },
      client,
    );

    expect(result).toEqual({ caseId: 'case-fallback' });

    expect(rpc).toHaveBeenCalledWith('rx_match_medication_lines', expect.objectContaining({
      medication_lines: expect.any(Array),
    }));
    expect(rpc).toHaveBeenCalledWith('rx_match_brand_lines', expect.objectContaining({
      brand_lines: expect.any(Array),
    }));
  });

  test('medicine matching steps unchanged in both paths (same RPC calls)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: {
        get: jest.fn().mockReturnValue('image/jpeg'),
      },
    }) as unknown as typeof fetch;

    mockCreateUploadImage.mockResolvedValue({ uri: 'processed://upload.jpg', mimeType: 'image/jpeg' });
    mockCreateThumbnailImage.mockResolvedValue({ uri: 'processed://thumb.jpg', mimeType: 'image/jpeg' });

    const single = jest.fn().mockResolvedValue({
      data: { case_id: 'case-rpc' },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockImplementation((table: string) => {
      if (table !== 'rx_cases') {
        throw new Error(`Unexpected table ${table}`);
      }
      return { insert, update };
    });

    const upload = jest.fn().mockResolvedValue({ data: null, error: null });
    const storageFrom = jest.fn().mockReturnValue({ upload });
    const rpc = jest.fn().mockImplementation((fnName: string) => {
      if (fnName === 'rx_match_medication_lines') {
        return Promise.resolve({
          data: [
            {
              confidence: 0.9,
              ingredient_canonical_name: 'TIOTROPIUM',
              ingredient_id: 'ingredient-tiotropium',
              input_index: 0,
              input_text: 'Spiriva Respimat 2 puff (tiotropium)',
              match_method: 'paren_alias_exact',
              match_status: 'matched',
              normalized_text: 'SPIRIVA RESPIMAT 2 PUFF TIOTROPIUM',
            },
          ],
          error: null,
        });
      }
      if (fnName === 'rx_match_brand_lines') {
        return Promise.resolve({
          data: [],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const client = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from,
      rpc,
      storage: { from: storageFrom },
    } as never;

    await createCase(
      {
        caseType: 'medicine_bag',
        ingredientIds: [],
        ocrRawText: 'Spiriva Respimat\n2 paff (tiotropium)',
        photoUris: ['file://photo-1.jpg'],
        sectionedOcr: {
          sections: {
            medication: {
              lines: [{ text: 'Spiriva Respimat', frame: { x: 120, y: 42, width: 180, height: 16 } }],
              texts: ['Spiriva Respimat'],
            },
            instruction: {
              lines: [{ text: 'Take after meals', frame: { x: 120, y: 122, width: 80, height: 16 } }],
              texts: ['Take after meals'],
            },
            indications: { lines: [], texts: [] },
            warnings: { lines: [], texts: [] },
            side_effects: { lines: [], texts: [] },
            prescription_no: { lines: [], texts: [] },
            dispensing_date: { lines: [], texts: [] },
            quantity: { lines: [], texts: [] },
            pharmacist: { lines: [], texts: [] },
            unassigned: { lines: [], texts: [] },
          },
          modelData: {
            engine: 'paddleocr-ppstructurev3',
            version: 'v1',
            pages: [],
            case_fields: {
              patientName: '王小花',
              patientSex: 'F',
              prescriptionNo: null,
              medicationName: null,
              quantity: null,
              directions: '每天兩次',
              indications: null,
              warnings: null,
              sideEffects: null,
              appearance: null,
              pharmacyName: null,
              pharmacyAddress: null,
              pharmacistName: null,
              physicianName: null,
              dispensingDate: null,
              useBefore: null,
            },
            extraction_engine: 'llm',
            extraction_fallback: false,
          },
        },
      },
      client,
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('rx_match_medication_lines', expect.objectContaining({
      medication_lines: expect.any(Array),
    }));
    expect(rpc).toHaveBeenCalledWith('rx_match_brand_lines', expect.objectContaining({
      brand_lines: expect.any(Array),
    }));
  });
});

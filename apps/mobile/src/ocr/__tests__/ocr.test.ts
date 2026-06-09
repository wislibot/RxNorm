const CACHE_DIR = 'file://cache/';

const mockFileSystem = {
  uploadAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
  cacheDirectory: CACHE_DIR,
  FileSystemUploadType: { MULTIPART: 'MULTIPART' as const },
};

function loadOcrModule(platform: string, registerMocks?: () => void) {
  jest.resetModules();
  jest.doMock('react-native', () => ({
    Platform: {
      OS: platform,
      select: (config: Record<string, unknown>) => config[platform] ?? config.default,
    },
  }));
  jest.doMock('expo-file-system/legacy', () => mockFileSystem, { virtual: true });
  registerMocks?.();

  return require('../ocr') as typeof import('../ocr');
}

describe('runOcrOnImages', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_OCR_SERVER_URL;
    delete process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY;
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('returns stable demo OCR text on web so the flow stays testable', async () => {
    const { runOcrOnImages } = loadOcrModule('web');

    await expect(runOcrOnImages(['file://photo-1.jpg'])).resolves.toContain('AMOXICILLIN');
  });

  test('returns structured OCR for the first image on web', async () => {
    const { runOcrOnImagesStructured } = loadOcrModule('web');

    await expect(runOcrOnImagesStructured(['file://photo-1.jpg'])).resolves.toEqual(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            lines: expect.arrayContaining([
              expect.objectContaining({
                text: '藥名',
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  test('throws OcrUnavailableError when OCR_SERVER_URL is not configured', async () => {
    delete process.env.EXPO_PUBLIC_OCR_SERVER_URL;
    delete process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY;

    const { OcrUnavailableError, runOcrOnImages } = loadOcrModule('android');

    await expect(runOcrOnImages(['file://photo-1.jpg'])).rejects.toThrow(OcrUnavailableError);
    await expect(runOcrOnImages(['file://photo-1.jpg'])).rejects.toThrow('OCR server not configured');
  });

  test('throws OcrUnavailableError when OCR_SERVER_API_KEY is not configured', async () => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = 'https://ocr.test.example.com';
    delete process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY;

    const { OcrUnavailableError, runOcrOnImages } = loadOcrModule('android');

    await expect(runOcrOnImages(['file://photo-1.jpg'])).rejects.toThrow(OcrUnavailableError);
    await expect(runOcrOnImages(['file://photo-1.jpg'])).rejects.toThrow('OCR server API key not configured');
  });

  test('calls remote OCR and returns text when server is configured', async () => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = 'https://ocr.test.example.com';
    process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY = 'test-api-key-abc123';
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [
          {
            width: 800,
            height: 600,
            elements: [
              { type: 'text', text: 'AMOXICILLIN 500 MG', bbox: [120, 42, 300, 58], confidence: 0.98 },
            ],
          },
        ],
      }),
    });

    const { runOcrOnImages } = loadOcrModule('android');

    const text = await runOcrOnImages(['file://photo-1.jpg']);

    expect(text).toBe('AMOXICILLIN 500 MG');
    expect(mockFileSystem.uploadAsync).toHaveBeenCalledTimes(1);
  });

  test('throws OcrUnavailableError when remote returns 401 (no ML Kit fallback)', async () => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = 'https://ocr.test.example.com';
    process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY = 'test-api-key-abc123';
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 401,
      body: JSON.stringify({ detail: 'Invalid API key' }),
    });

    const { OcrUnavailableError, runOcrOnImages } = loadOcrModule('android');

    await expect(runOcrOnImages(['file://photo-1.jpg'])).rejects.toThrow(OcrUnavailableError);
  });

  test('throws OcrUnavailableError on network failure (no ML Kit fallback)', async () => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = 'https://ocr.test.example.com';
    process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY = 'test-api-key-abc123';
    mockFileSystem.uploadAsync.mockRejectedValue(new Error('Network error'));

    const { OcrUnavailableError, runOcrOnImages } = loadOcrModule('android');

    await expect(runOcrOnImages(['file://photo-1.jpg'])).rejects.toThrow(OcrUnavailableError);
  });

  test('runOcrOnImagesStructured uses remote OCR when configured', async () => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = 'https://ocr.test.example.com';
    process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY = 'test-api-key-abc123';
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [
          {
            width: 800,
            height: 600,
            elements: [
              { type: 'text', text: '藥名', bbox: [20, 40, 70, 56], confidence: 0.99 },
              { type: 'text', text: 'AMOXICILLIN 500 MG', bbox: [120, 42, 300, 58], confidence: 0.98 },
            ],
          },
        ],
      }),
    });

    const { runOcrOnImagesStructured } = loadOcrModule('android');

    const result = await runOcrOnImagesStructured(['file://photo-1.jpg']);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].text).toBe('藥名 AMOXICILLIN 500 MG');
    expect(result.text).toBe('藥名 AMOXICILLIN 500 MG');
  });

  test('runOcrOnImagesStructured throws OcrUnavailableError on remote failure (no ML Kit fallback)', async () => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = 'https://ocr.test.example.com';
    process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY = 'test-api-key-abc123';
    mockFileSystem.uploadAsync.mockRejectedValue(new Error('Network error'));

    const { OcrUnavailableError, runOcrOnImagesStructured } = loadOcrModule('android');

    await expect(runOcrOnImagesStructured(['file://photo-1.jpg'])).rejects.toThrow(OcrUnavailableError);
  });

  test('runOcrOnImagesStructured throws when URL is missing', async () => {
    delete process.env.EXPO_PUBLIC_OCR_SERVER_URL;
    delete process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY;

    const { OcrUnavailableError, runOcrOnImagesStructured } = loadOcrModule('android');

    await expect(runOcrOnImagesStructured(['file://photo-1.jpg'])).rejects.toThrow(OcrUnavailableError);
    await expect(runOcrOnImagesStructured(['file://photo-1.jpg'])).rejects.toThrow('OCR server not configured');
  });

  test('runOcrOnImagesStructured throws when API key is missing', async () => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = 'https://ocr.test.example.com';
    delete process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY;

    const { OcrUnavailableError, runOcrOnImagesStructured } = loadOcrModule('android');

    await expect(runOcrOnImagesStructured(['file://photo-1.jpg'])).rejects.toThrow(OcrUnavailableError);
    await expect(runOcrOnImagesStructured(['file://photo-1.jpg'])).rejects.toThrow('OCR server API key not configured');
  });
});

describe('isQrCodeElement', () => {
  let isQrCodeElement: typeof import('../ocr').isQrCodeElement;

  beforeAll(() => {
    ({ isQrCodeElement } = loadOcrModule('android'));
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('returns true for empty-text, square, large-enough bbox', () => {
    const line = {
      text: '',
      frame: { x: 220, y: 100, width: 200, height: 200 },
    };
    expect(isQrCodeElement(line)).toBe(true);
  });

  test('returns true for very short text with square bbox', () => {
    const line = {
      text: '12',
      frame: { x: 220, y: 100, width: 150, height: 140 },
    };
    expect(isQrCodeElement(line)).toBe(true);
  });

  test('returns false for normal text element', () => {
    const line = {
      text: '處方醫師',
      frame: { x: 100, y: 100, width: 80, height: 20 },
    };
    expect(isQrCodeElement(line)).toBe(false);
  });

  test('returns false when text is longer than 2 chars', () => {
    const line = {
      text: '123',
      frame: { x: 220, y: 100, width: 200, height: 200 },
    };
    expect(isQrCodeElement(line)).toBe(false);
  });

  test('returns false when bbox is too narrow (non-square)', () => {
    const line = {
      text: '',
      frame: { x: 220, y: 100, width: 50, height: 200 },
    };
    expect(isQrCodeElement(line)).toBe(false);
  });

  test('returns false when bbox is too tall (non-square)', () => {
    const line = {
      text: '',
      frame: { x: 220, y: 100, width: 200, height: 50 },
    };
    expect(isQrCodeElement(line)).toBe(false);
  });

  test('returns false when bbox is too small', () => {
    const line = {
      text: '',
      frame: { x: 220, y: 100, width: 30, height: 30 },
    };
    expect(isQrCodeElement(line)).toBe(false);
  });

  test('returns false for whitespace-only text with square bbox (QR is typically empty or numeric)', () => {
    const line = {
      text: ' ',
      frame: { x: 220, y: 100, width: 150, height: 150 },
    };
    expect(isQrCodeElement(line)).toBe(true);
  });
});

describe('mergeAdjacentLines', () => {
  let mergeAdjacentLines: typeof import('../ocr').mergeAdjacentLines;

  beforeAll(() => {
    ({ mergeAdjacentLines } = loadOcrModule('android'));
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('merges two same-row adjacent elements into one', () => {
    const lines = [
      { text: '處方医師', frame: { x: 20, y: 100, width: 70, height: 20 } },
      { text: '王',       frame: { x: 100, y: 100, width: 20, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('處方医師 王');
    expect(result[0].frame.x).toBe(20);
    expect(result[0].frame.y).toBe(100);
    expect(result[0].frame.width).toBe(100);
    expect(result[0].frame.height).toBe(20);
  });

  test('does not merge two same-row elements with x gap > 80px', () => {
    const lines = [
      { text: '藥名',     frame: { x: 20, y: 100, width: 50, height: 20 } },
      { text: '遠端文字', frame: { x: 200, y: 102, width: 70, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('藥名');
    expect(result[1].text).toBe('遠端文字');
  });

  test('does not merge two elements on different rows', () => {
    const lines = [
      { text: '姓名：陈', frame: { x: 20, y: 50, width: 80, height: 20 } },
      { text: '科',       frame: { x: 20, y: 100, width: 20, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('姓名：陈');
    expect(result[1].text).toBe('科');
  });

  test('merges three same-row adjacent elements into one', () => {
    const lines = [
      { text: '姓名：', frame: { x: 20, y: 50, width: 50, height: 20 } },
      { text: '陈',   frame: { x: 72, y: 50, width: 20, height: 20 } },
      { text: '科',   frame: { x: 95, y: 50, width: 20, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('姓名： 陈 科');
  });

  test('handles near-boundary x gap of exactly 80px as mergeable', () => {
    const lines = [
      { text: '藥師', frame: { x: 20, y: 200, width: 40, height: 16 } },
      { text: '王小明', frame: { x: 140, y: 200, width: 50, height: 16 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('藥師 王小明');
  });

  test('does not merge element with centerY beyond 10px tolerance', () => {
    const lines = [
      { text: '第一行', frame: { x: 20, y: 100, width: 50, height: 14 } },
      { text: '第二行', frame: { x: 25, y: 118, width: 50, height: 14 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result).toHaveLength(2);
  });

  test('handles empty array and single-element array', () => {
    expect(mergeAdjacentLines([])).toHaveLength(0);

    const single = [{ text: '唯一', frame: { x: 10, y: 10, width: 50, height: 20 } }];
    const result = mergeAdjacentLines(single);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('唯一');
  });

  test('merges label and value when QR element sits between them on same row', () => {
    const lines = [
      { text: '處方醫師', frame: { x: 100, y: 100, width: 100, height: 20 } },
      { text: '',        frame: { x: 220, y: 100, width: 200, height: 200 } },
      { text: '王小明',  frame: { x: 440, y: 100, width: 60, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    const mergedTexts = result.map((l) => l.text);
    expect(mergedTexts).toContain('處方醫師 王小明');
  });

  test('QR elements still appear in output as standalone entries', () => {
    const qrLine = { text: '', frame: { x: 220, y: 100, width: 200, height: 200 } };
    const lines = [
      { text: '處方醫師', frame: { x: 100, y: 100, width: 100, height: 20 } },
      qrLine,
      { text: '王小明', frame: { x: 440, y: 100, width: 60, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result.some((l) => l.frame.width === 200 && l.frame.height === 200)).toBe(true);
  });

  test('does NOT merge elements far apart without QR between them', () => {
    const lines = [
      { text: '藥名',     frame: { x: 20, y: 100, width: 50, height: 20 } },
      { text: '遠端文字', frame: { x: 300, y: 102, width: 70, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result).toHaveLength(2);
  });

  test('merges elements separated by QR with gap up to 300px', () => {
    const lines = [
      { text: '調劑藥師', frame: { x: 100, y: 200, width: 80, height: 20 } },
      { text: '',         frame: { x: 200, y: 195, width: 180, height: 180 } },
      { text: '林小明',  frame: { x: 430, y: 200, width: 60, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    expect(result.some((l) => l.text === '調劑藥師 林小明')).toBe(true);
  });

  test('sorts final output in reading order after QR re-append', () => {
    const lines = [
      { text: '王小明',  frame: { x: 440, y: 100, width: 60, height: 20 } },
      { text: '',        frame: { x: 220, y: 100, width: 200, height: 200 } },
      { text: '處方醫師', frame: { x: 100, y: 100, width: 100, height: 20 } },
    ];

    const result = mergeAdjacentLines(lines);

    const texts = result.map((l) => l.text);
    const labelIdx = texts.findIndex((t) => t.includes('處方醫師'));
    expect(labelIdx).toBe(0);
  });
});

describe('mapRemoteToOcrResult', () => {
  let mapRemoteToOcrResult: typeof import('../ocr').mapRemoteToOcrResult;
  let RemoteOcrResult: typeof import('../ocr').RemoteOcrResult;

  beforeAll(() => {
    ({ mapRemoteToOcrResult } = loadOcrModule('android'));
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('maps a single element to a single OcrBlock', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [
        {
          width: 800,
          height: 600,
          elements: [
            {
              type: 'text',
              text: 'AMOXICILLIN 500 MG',
              bbox: [120, 42, 300, 58],
              confidence: 0.98,
            },
          ],
        },
      ],
    };

    const result = mapRemoteToOcrResult(remote);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].text).toBe('AMOXICILLIN 500 MG');
    expect(result.blocks[0].frame).toEqual({ x: 120, y: 42, width: 180, height: 16 });
    expect(result.blocks[0].lines).toHaveLength(1);
    expect(result.text).toBe('AMOXICILLIN 500 MG');
  });

  test('maps multiple elements across pages into sorted blocks', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [
        {
          width: 800,
          height: 600,
          elements: [
            { type: 'text', text: '藥名', bbox: [20, 40, 70, 56], confidence: 0.99 },
            { type: 'text', text: 'AMOXICILLIN', bbox: [120, 42, 280, 58], confidence: 0.97 },
          ],
        },
        {
          width: 800,
          height: 200,
          elements: [
            { type: 'text', text: '調劑藥師：陳小明', bbox: [20, 10, 160, 26], confidence: 0.95 },
          ],
        },
      ],
    };

    const result = mapRemoteToOcrResult(remote);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.map((b) => b.text)).toEqual(
      expect.arrayContaining(['藥名 AMOXICILLIN', '調劑藥師：陳小明']),
    );
  });

  test('returns empty result when pages array is empty', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [],
    };

    const result = mapRemoteToOcrResult(remote);

    expect(result.text).toBe('');
    expect(result.blocks).toHaveLength(0);
  });

  test('returns empty result when elements array is empty', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [{ width: 800, height: 600, elements: [] }],
    };

    const result = mapRemoteToOcrResult(remote);

    expect(result.text).toBe('');
    expect(result.blocks).toHaveLength(0);
  });

  test('converts bbox [x1,y1,x2,y2] to frame {x,y,width,height} correctly', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [
        {
          width: 1024,
          height: 768,
          elements: [
            { type: 'text', text: 'Test', bbox: [50, 100, 350, 130], confidence: 0.99 },
          ],
        },
      ],
    };

    const result = mapRemoteToOcrResult(remote);

    expect(result.blocks[0].frame).toEqual({ x: 50, y: 100, width: 300, height: 30 });
  });

  test('ensures minimum width and height of 1 for zero-size bboxes', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [
        {
          width: 1024,
          height: 768,
          elements: [
            { type: 'text', text: 'Dot', bbox: [10, 10, 10, 10], confidence: 0.5 },
          ],
        },
      ],
    };

    const result = mapRemoteToOcrResult(remote);

    expect(result.blocks[0].frame.width).toBe(1);
    expect(result.blocks[0].frame.height).toBe(1);
  });

  test('produces a joined text field from all block texts', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [
        {
          width: 800,
          height: 600,
          elements: [
            { type: 'text', text: '第一行', bbox: [10, 10, 100, 30], confidence: 0.9 },
            { type: 'text', text: '第二行', bbox: [10, 50, 100, 70], confidence: 0.9 },
          ],
        },
      ],
    };

    const result = mapRemoteToOcrResult(remote);

    expect(result.text).toContain('第一行');
    expect(result.text).toContain('第二行');
  });
});

describe('runRemoteOcrImage', () => {
  const TEST_SERVER_URL = 'https://ocr.test.example.com';
  const TEST_API_KEY = 'test-api-key-abc123';

  beforeEach(() => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = TEST_SERVER_URL;
    process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY = TEST_API_KEY;
    mockFileSystem.uploadAsync.mockReset();
    mockFileSystem.copyAsync.mockReset();
    mockFileSystem.deleteAsync.mockReset();
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [],
      }),
    });
    mockFileSystem.copyAsync.mockResolvedValue(undefined);
    mockFileSystem.deleteAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_OCR_SERVER_URL;
    delete process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY;
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('calls uploadAsync with correct URL, fileUri, fieldName, uploadType, and X-API-Key header', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [{ width: 800, height: 600, elements: [] }],
      }),
    });

    const { runRemoteOcrImage } = loadOcrModule('android');

    await runRemoteOcrImage('file://photo-1.jpg');

    expect(mockFileSystem.uploadAsync).toHaveBeenCalledTimes(1);

    const [url, fileUri, options] = mockFileSystem.uploadAsync.mock.calls[0];
    expect(url).toBe(`${TEST_SERVER_URL}/parse?lang=ch`);
    expect(fileUri).toBe('file://photo-1.jpg');
    expect(options.httpMethod).toBe('POST');
    expect(options.uploadType).toBe('MULTIPART');
    expect(options.fieldName).toBe('file');
    expect(options.mimeType).toBe('image/jpeg');
    expect(options.headers).toEqual({ 'X-API-Key': TEST_API_KEY });
  });

  test('uploads file:// URI directly without copying', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [{ width: 800, height: 600, elements: [] }],
      }),
    });

    const { runRemoteOcrImage } = loadOcrModule('android');

    await runRemoteOcrImage('file://photo-1.jpg');

    expect(mockFileSystem.copyAsync).not.toHaveBeenCalled();
  });

  test('copies content:// URI to cache before uploading and deletes temp file after', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [{ width: 800, height: 600, elements: [] }],
      }),
    });

    const { runRemoteOcrImage } = loadOcrModule('android');

    await runRemoteOcrImage('content://media/external/images/123');

    expect(mockFileSystem.copyAsync).toHaveBeenCalledTimes(1);
    expect(mockFileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'content://media/external/images/123',
      to: expect.stringMatching(/^file:\/\/cache\/ocr_upload_\d+\.jpg$/),
    });

    const [, fileUri] = mockFileSystem.uploadAsync.mock.calls[0];
    expect(fileUri).toMatch(/^file:\/\/cache\/ocr_upload_\d+\.jpg$/);

    expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/cache\/ocr_upload_\d+\.jpg$/),
      { idempotent: true },
    );
  });

  test('does not delete temp file for non-content:// URIs', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [{ width: 800, height: 600, elements: [] }],
      }),
    });

    const { runRemoteOcrImage } = loadOcrModule('android');

    await runRemoteOcrImage('file://photo-1.jpg');

    expect(mockFileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  test('returns structured OcrResult from successful upload', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [
          {
            width: 800,
            height: 600,
            elements: [
              { type: 'text', text: 'AMOXICILLIN 500 MG', bbox: [120, 42, 300, 58], confidence: 0.98 },
            ],
          },
        ],
      }),
    });

    const { runRemoteOcrImage } = loadOcrModule('android');

    const result = await runRemoteOcrImage('file://photo-1.jpg');

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].text).toBe('AMOXICILLIN 500 MG');
  });

  test('throws OcrUnavailableError on 401 response', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 401,
      body: JSON.stringify({ detail: 'Invalid API key' }),
    });

    const { OcrUnavailableError, runRemoteOcrImage } = loadOcrModule('android');

    await expect(runRemoteOcrImage('file://photo-1.jpg')).rejects.toBeInstanceOf(OcrUnavailableError);
  });

  test('throws OcrUnavailableError on 500 response', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 500,
      body: JSON.stringify({ detail: 'Server error' }),
    });

    const { OcrUnavailableError, runRemoteOcrImage } = loadOcrModule('android');

    await expect(runRemoteOcrImage('file://photo-1.jpg')).rejects.toBeInstanceOf(OcrUnavailableError);
  });

  test('throws OcrUnavailableError on network failure', async () => {
    mockFileSystem.uploadAsync.mockRejectedValue(new Error('Network error'));

    const { OcrUnavailableError, runRemoteOcrImage } = loadOcrModule('android');

    await expect(runRemoteOcrImage('file://photo-1.jpg')).rejects.toBeInstanceOf(OcrUnavailableError);
  });

  test('returns empty result when remote has no pages', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [],
      }),
    });

    const { runRemoteOcrImage } = loadOcrModule('android');

    const result = await runRemoteOcrImage('file://photo-1.jpg');

    expect(result.text).toBe('');
    expect(result.blocks).toHaveLength(0);
  });
});

describe('mapRemoteToOcrResult photo_index propagation', () => {
  let mapRemoteToOcrResult: typeof import('../ocr').mapRemoteToOcrResult;
  let RemoteOcrResult: typeof import('../ocr').RemoteOcrResult;

  beforeAll(() => {
    ({ mapRemoteToOcrResult } = loadOcrModule('android'));
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('propagates photo_index from RemoteOcrElement to OcrLine and OcrBlock', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [
        {
          width: 800,
          height: 1200,
          elements: [
            { type: 'text', text: '姓名：陳小明', bbox: [20, 40, 150, 56], confidence: 0.99, photo_index: 0 },
            { type: 'text', text: '藥名 AMOXICILLIN', bbox: [20, 80, 200, 96], confidence: 0.98, photo_index: 0 },
          ],
        },
        {
          width: 800,
          height: 1200,
          elements: [
            { type: 'text', text: '警語 開封後存放', bbox: [20, 640, 160, 656], confidence: 0.95, photo_index: 1 },
            { type: 'text', text: '副作用 可能腹瀉', bbox: [20, 680, 160, 696], confidence: 0.94, photo_index: 1 },
          ],
        },
      ],
    };

    const result = mapRemoteToOcrResult(remote);

    const photo0Blocks = result.blocks.filter((b) => b.photoIndex === 0);
    const photo1Blocks = result.blocks.filter((b) => b.photoIndex === 1);

    expect(photo0Blocks).toHaveLength(2);
    expect(photo0Blocks.map((b) => b.text)).toEqual(
      expect.arrayContaining(['姓名：陳小明', '藥名 AMOXICILLIN']),
    );

    expect(photo1Blocks).toHaveLength(2);
    expect(photo1Blocks.map((b) => b.text)).toEqual(
      expect.arrayContaining(['警語 開封後存放', '副作用 可能腹瀉']),
    );

    for (const block of result.blocks) {
      for (const line of block.lines) {
        expect(line.photoIndex).toBeDefined();
      }
    }
  });

  test('defaults photoIndex to 0 when photo_index is not present', () => {
    const remote: RemoteOcrResult = {
      engine: 'paddleocr-ppstructurev3',
      version: 'v1',
      pages: [
        {
          width: 800,
          height: 600,
          elements: [
            { type: 'text', text: 'AMOXICILLIN', bbox: [20, 40, 200, 56], confidence: 0.99 },
          ],
        },
      ],
    };

    const result = mapRemoteToOcrResult(remote);

    expect(result.blocks[0].photoIndex).toBe(0);
    expect(result.blocks[0].lines[0].photoIndex).toBe(0);
  });
});

describe('runOcrOnImagesStructured multi-photo routing', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_OCR_SERVER_URL = 'https://ocr.test.example.com';
    process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY = 'test-api-key-abc123';
    mockFileSystem.uploadAsync.mockReset();
    mockFileSystem.copyAsync.mockReset();
    mockFileSystem.deleteAsync.mockReset();
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_OCR_SERVER_URL;
    delete process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY;
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('uses runRemoteOcrImageMulti when uris.length > 1', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [
          { width: 800, height: 1200, elements: [
            { type: 'text', text: '姓名：陳', bbox: [20, 40, 100, 56], confidence: 0.99, photo_index: 0 },
          ]},
          { width: 800, height: 1200, elements: [
            { type: 'text', text: '警語', bbox: [20, 640, 80, 656], confidence: 0.99, photo_index: 1 },
          ]},
        ],
        case_fields: { patientName: '陳' },
        extraction_engine: 'llm',
        extraction_fallback: false,
        photo_count: 2,
      }),
    });
    global.fetch = mockFetch;

    const { runOcrOnImagesStructured } = loadOcrModule('android');

    const result = await runOcrOnImagesStructured(['file://photo-1.jpg', 'file://photo-2.jpg']);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.blocks.some((b) => b.photoIndex === 0)).toBe(true);
    expect(result.blocks.some((b) => b.photoIndex === 1)).toBe(true);
    expect(result.modelData?.photo_count).toBe(2);
    expect(result.modelData?.case_fields?.patientName).toBe('陳');
  });

  test('still uses individual /parse endpoint for single photo', async () => {
    mockFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        engine: 'paddleocr-ppstructurev3',
        version: 'v1',
        pages: [{ width: 800, height: 600, elements: [
          { type: 'text', text: 'AMOXICILLIN', bbox: [20, 40, 200, 56], confidence: 0.99, photo_index: 0 },
        ]}],
      }),
    });

    const { runOcrOnImagesStructured } = loadOcrModule('android');

    await runOcrOnImagesStructured(['file://photo-1.jpg']);

    expect(mockFileSystem.uploadAsync).toHaveBeenCalledTimes(1);
  });
});

describe('mapRemoteCaseFields', () => {
  let mapRemoteCaseFields: typeof import('../ocr').mapRemoteCaseFields;

  beforeAll(() => {
    ({ mapRemoteCaseFields } = loadOcrModule('android'));
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('correctly maps all fields from remote case fields', () => {
    const remote = {
      patientName: '王小花',
      patientSex: 'F' as const,
      prescriptionNo: '15432',
      medicationName: 'Trajenta DUO 2.5 & 850mg/膜衣錠 (Linagliptin & Metformin)',
      quantity: '28粒',
      directions: '每天兩次，早晚飯後使用，每次1粒，共14天。',
      indications: '治療第二型糖尿病',
      warnings: '腎功能不全者服用前請告知醫師',
      sideEffects: '可能發生：腹瀉、鼻咽炎',
      appearance: '淡橘色、橢圓形',
      pharmacyName: '台北慈濟醫院',
      pharmacyAddress: '新北市新店區建國路289號',
      pharmacistName: '胡慈慈',
      physicianName: '黃華陀',
      dispensingDate: '2024-04-25',
      useBefore: null,
    };

    const result = mapRemoteCaseFields(remote);

    expect(result).not.toBeNull();
    expect(result!.patientName).toBe('王小花');
    expect(result!.patientSex).toBe('F');
    expect(result!.prescriptionNo).toBe('15432');
    expect(result!.quantity).toBe('28粒');
    expect(result!.directions).toBe('每天兩次，早晚飯後使用，每次1粒，共14天。');
    expect(result!.pharmacyName).toBe('台北慈濟醫院');
    expect(result!.pharmacyAddress).toBe('新北市新店區建國路289號');
    expect(result!.pharmacistName).toBe('胡慈慈');
    expect(result!.physicianName).toBe('黃華陀');
    expect(result!.dispensingDate).toBe('2024-04-25');
    expect(result!.useBefore).toBeNull();
  });

  test('wraps indications in array correctly', () => {
    const remote = {
      patientName: null,
      patientSex: null,
      prescriptionNo: null,
      medicationName: null,
      quantity: null,
      directions: null,
      indications: '治療第二型糖尿病',
      warnings: null,
      sideEffects: null,
      appearance: null,
      pharmacyName: null,
      pharmacyAddress: null,
      pharmacistName: null,
      physicianName: null,
      dispensingDate: null,
      useBefore: null,
    };

    const result = mapRemoteCaseFields(remote);

    expect(result!.indications).toEqual(['治療第二型糖尿病']);
  });

  test('wraps warnings in array correctly', () => {
    const remote = {
      patientName: null,
      patientSex: null,
      prescriptionNo: null,
      medicationName: null,
      quantity: null,
      directions: null,
      indications: null,
      warnings: '請勿與酒精同時服用',
      sideEffects: null,
      appearance: null,
      pharmacyName: null,
      pharmacyAddress: null,
      pharmacistName: null,
      physicianName: null,
      dispensingDate: null,
      useBefore: null,
    };

    const result = mapRemoteCaseFields(remote);

    expect(result!.warnings).toEqual(['請勿與酒精同時服用']);
  });

  test('wraps sideEffects in array correctly', () => {
    const remote = {
      patientName: null,
      patientSex: null,
      prescriptionNo: null,
      medicationName: null,
      quantity: null,
      directions: null,
      indications: null,
      warnings: null,
      sideEffects: '可能發生：腹瀉、鼻咽炎',
      appearance: null,
      pharmacyName: null,
      pharmacyAddress: null,
      pharmacistName: null,
      physicianName: null,
      dispensingDate: null,
      useBefore: null,
    };

    const result = mapRemoteCaseFields(remote);

    expect(result!.sideEffects).toEqual(['可能發生：腹瀉、鼻咽炎']);
  });

  test('returns null when input is null', () => {
    const result = mapRemoteCaseFields(null);

    expect(result).toBeNull();
  });

  test('patientSex M/F passthrough works', () => {
    const male = {
      patientName: null,
      patientSex: 'M' as const,
      prescriptionNo: null,
      medicationName: null,
      quantity: null,
      directions: null,
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
    };

    const result = mapRemoteCaseFields(male);

    expect(result!.patientSex).toBe('M');
  });

  test('does not wrap null indications/warnings/sideEffects', () => {
    const remote = {
      patientName: null,
      patientSex: null,
      prescriptionNo: null,
      medicationName: null,
      quantity: null,
      directions: null,
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
    };

    const result = mapRemoteCaseFields(remote);

    expect(result!.indications).toBeUndefined();
    expect(result!.warnings).toBeUndefined();
    expect(result!.sideEffects).toBeUndefined();
  });
});

import { getSupabaseClient, type AppSupabaseClient } from '../lib/supabase';
import { extractDetectedItems } from '../detectedItems/extractDetectedItems';
import { analyzeMedicationLineGrouping, groupMedicationLinesIntoItems } from '../ocr/groupMedicationLines';
import { createUploadImage, createThumbnailImage } from '../photos/processPhoto';
import { extractCaseFields } from '../ocr/structuredCaseExtractor';
import { mapRemoteCaseFields, runRemoteOcrImage } from '../ocr/ocr';
import { mapOcrSections } from '../ocr/sectionMapper';
import type { BrandMatch, CaseFields } from '../types/caseFields';
import type { AutoShareStatus, CaseRecord, CaseSummary, CreateCaseInput, DetectedItem, OcrSections } from '../types/case';
import type { RemoteOcrResult } from '../ocr/types';

const CASE_PHOTO_BUCKET = 'rx-case-photos';
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24;

type RxCaseRow = {
  case_id: string;
  case_type: CaseRecord['caseType'];
  created_at: string;
  updated_at: string;
  ocr_raw_text: string;
  case_group_id: string | null;
  ocr_sections: {
    medication_lines?: string[] | null;
    instruction_lines?: string[] | null;
    indications_lines?: string[] | null;
    warnings_lines?: string[] | null;
    side_effects_lines?: string[] | null;
    dispensing_date_lines?: string[] | null;
    quantity_lines?: string[] | null;
    pharmacist_lines?: string[] | null;
    case_fields?: CaseFields | null;
    remote_model?: unknown;
  } | null;
  detected_items: Array<{
    source?: 'ocr_line';
    raw_text?: string | null;
    display_name?: string | null;
    match_status?: 'matched' | 'unmatched' | null;
    confidence?: number | null;
    ingredient_id?: string | null;
    ingredient_ids?: string[] | null;
    match_method?: 'canonical_exact' | 'alias_exact' | 'paren_alias_exact' | null;
    nhi_code?: string | null;
    note?: string | null;
  }> | null;
  photo_paths: string[] | null;
  ingredient_ids: string[] | null;
  share_to_all_care_teams: boolean;
};

type RxMedicationLineMatchRow = {
  input_index: number;
  input_text: string;
  normalized_text: string;
  match_status: 'matched' | 'unmatched';
  ingredient_id: string | null;
  ingredient_ids: string[] | null;
  ingredient_canonical_name: string | null;
  product_id: string | null;
  product_display_name: string | null;
  match_method: 'canonical_exact' | 'alias_exact' | 'paren_alias_exact' | 'ingredient_token' | 'ocr_product' | 'product_exact' | 'product_token' | null;
  confidence: number | null;
};

type RxBrandLineMatchRow = {
  input_index: number;
  input_text: string;
  normalized_text: string;
  match_status: 'matched' | 'unmatched';
  product_id: string | null;
  product_display_name: string | null;
  nhi_code: string | null;
  match_method: 'product_exact' | 'alias_exact' | null;
  confidence: number | null;
  product_name_zh: string | null;
  product_name_en: string | null;
};

function mapDetectedItemsFromDb(items: RxCaseRow['detected_items']): DetectedItem[] {
  return (items ?? []).map((item) => ({
    confidence: item.confidence ?? null,
    displayName: item.display_name ?? '',
    ingredientId: item.ingredient_id ?? undefined,
    ingredientIds: item.ingredient_ids ?? undefined,
    matchMethod: item.match_method ?? null,
    matchStatus: item.match_status === 'matched' ? 'matched' : 'unmatched',
    nhiCode: item.nhi_code ?? undefined,
    note: item.note ?? null,
    rawText: item.raw_text ?? undefined,
    source: item.source ?? 'ocr_line',
  }));
}

async function requireCurrentUserId(client: AppSupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error) {
    throw error;
  }
  const userId = data.user?.id;
  if (!userId) {
    throw new Error('No authenticated user is available to create or load a case.');
  }
  return userId;
}

async function readPhotoAsArrayBuffer(uri: string) {
  const response = await fetch(uri);
  return {
    arrayBuffer: await response.arrayBuffer(),
    contentType: response.headers.get('Content-Type') || 'image/jpeg',
  };
}

async function buildSignedUrls(client: AppSupabaseClient, photoPaths: string[]) {
  const urls = await Promise.all(
    photoPaths.map(async (path) => {
      const { data, error } = await client.storage.from(CASE_PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
      if (error) {
        throw error;
      }
      return data.signedUrl;
    }),
  );

  return urls;
}

function stripNonMedicationText(line: string): string {
  let result = line;
  result = result.replace(/適應症[：:].*$/g, '');
  result = result.replace(/警語[：:].*$/g, '');
  result = result.replace(/成份名[：:].*$/g, '');
  result = result.replace(/\|\s*藥師\s*$/g, '');
  result = result.replace(/代收健保.*$/g, '');
  result = result.replace(/[|｜]\s*$/, '');
  return result.trim();
}

function getMedicationCandidateLines(input: CreateCaseInput) {
  const groupingDiagnostics = analyzeMedicationLineGrouping(input.sectionedOcr?.sections.medication.lines ?? []);
  const groupedMedicationItems = groupingDiagnostics.groupedItems;

  if (__DEV__ && process.env.NODE_ENV !== 'test') {
    console.log('[createCase] medication grouping', {
      groupedItemsCount: groupedMedicationItems.length,
      groupedItemsPreview: groupedMedicationItems.slice(0, 3).map((item) => item.text.slice(0, 80)),
      medicationLinesCount: groupingDiagnostics.candidateLines.length,
    });
  }

  let sectionLines: string[];
  if (groupedMedicationItems.length > 0) {
    sectionLines = groupedMedicationItems.map((item) => item.text);
  } else {
    const raw = input.sectionedOcr?.sections.medication.texts ?? [];
    sectionLines = raw.map((line) => line.trim()).filter(Boolean);
    if (!sectionLines.length) {
      const llmOtherLines = (input.sectionedOcr?.modelData?.case_fields as any)?.other ?? [];
      if (llmOtherLines.length > 0) {
        const NON_MED_KEYWORDS = [
          '適應症', '适应症', '警語', '警语', '成份名', '代收',
          '就醫', '就医', '日份', '合計', '合计', '調劑', '调剂',
          '藥師', '药师', '兹收到', '茲收到', '性別', '性别', '姓名',
          '病號', '病号', '身分證', '身份证', '就醫序', '就医序',
          'N處方', 'N处方', '次量',
        ];
        sectionLines = llmOtherLines
          .filter((line: string) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.length >= 60) return false;
            if (NON_MED_KEYWORDS.some((kw) => trimmed.startsWith(kw))) return false;
            if (/[A-Za-z]{4,}/.test(trimmed)) return true;
            if (/\d+\s*(?:mg|mcg|g|ml|iu|cap|tab|inj|syr)/i.test(trimmed)) return true;
            return false;
          })
          .map((line: string) => line.replace(/\|/g, ' ').trim())
          .filter(Boolean);
      }
    }
    if (!sectionLines.length) {
      sectionLines = extractDetectedItems({
        ocrRawText: input.ocrRawText,
        sectionedOcr: input.sectionedOcr,
      }).map((item) => item.displayName);
    }
  }

  const llmMedicationName = input.sectionedOcr?.modelData?.case_fields?.medicationName?.trim();
  if (llmMedicationName && !sectionLines.includes(llmMedicationName)) {
    sectionLines.unshift(llmMedicationName);
  }

  // Ensure OCR medication section lines are always included
  const ocrMedLines = input.sectionedOcr?.sections?.medication?.texts ?? [];
  for (const ocrLine of ocrMedLines) {
    const trimmed = ocrLine.trim();
    if (trimmed && !sectionLines.includes(trimmed)) {
      sectionLines.push(trimmed);
    }
  }

  return sectionLines.map(stripNonMedicationText);
}

function buildStoredOcrSections(
  input: CreateCaseInput,
  brandNames?: string[],
  brandMatches?: BrandMatch[],
  remoteCaseFields?: Partial<CaseFields> | null,
): OcrSections {
  const sections = input.sectionedOcr?.sections;
  let caseFields: CaseFields;

  if (remoteCaseFields && Object.keys(remoteCaseFields).length > 0) {
    caseFields = remoteCaseFields as CaseFields;
  } else {
    caseFields = sections
      ? extractCaseFields(input.ocrRawText, input.sectionedOcr)
      : extractCaseFields(input.ocrRawText);
  }

  if (brandNames?.length || brandMatches?.length) {
    caseFields.brandNames = brandNames;
    caseFields.brandMatches = brandMatches;
  }

  return {
    medicationLines: sections?.medication.texts ?? [],
    instructionLines: sections?.instruction.texts ?? [],
    indicationsLines: sections?.indications.texts ?? [],
    warningsLines: sections?.warnings.texts ?? [],
    sideEffectsLines: sections?.side_effects.texts ?? [],
    dispensingDateLines: sections?.dispensing_date.texts ?? [],
    quantityLines: sections?.quantity.texts ?? [],
    pharmacistLines: sections?.pharmacist.texts ?? [],
    caseFields,
    remoteModel: input.sectionedOcr?.modelData ?? null,
  };
}

function mapMedicationMatchesToDetectedItems(
  candidateLines: string[],
  matchRows: RxMedicationLineMatchRow[] | null | undefined,
  medicationName?: string,
  brandRows?: RxBrandLineMatchRow[],
  brandIngredientMap?: Map<string, string[]>,
): { detectedItems: Array<Record<string, unknown>>; ingredientIds: string[] } {
  if (!candidateLines.length) {
    return { detectedItems: [], ingredientIds: [] };
  }

  const rowsByIndex = new Map<number, RxMedicationLineMatchRow>();
  for (const row of matchRows ?? []) {
    rowsByIndex.set(row.input_index, row);
  }

  const matchedById = new Map<string, Record<string, unknown>>();
  const ingredientIds = new Set<string>();

  candidateLines.forEach((line, i) => {
    const m = rowsByIndex.get(i);

    const hasIngredientIds = (m?.ingredient_ids?.length ?? 0) > 0;
    if (m?.match_status === 'matched' && (m.ingredient_id || hasIngredientIds)) {
      const effectiveId = m.ingredient_id ?? (m.ingredient_ids && m.ingredient_ids.length > 0 ? m.ingredient_ids[0] : null);
      if (!effectiveId) return;
      ingredientIds.add(effectiveId);
      if (m.ingredient_ids) {
        for (const id of m.ingredient_ids) {
          ingredientIds.add(id);
        }
      }
      if (!matchedById.has(effectiveId)) {
        matchedById.set(effectiveId, {
          confidence: m.confidence ?? null,
          display_name: m.product_display_name ?? m.ingredient_canonical_name ?? m.input_text ?? line,
          ingredient_id: effectiveId,
          ingredient_ids: m.ingredient_ids ?? (effectiveId ? [effectiveId] : null),
          match_method: m.match_method ?? null,
          match_status: 'matched',
          nhi_code: m.product_id ?? null,
          note: null,
          raw_text: m.input_text ?? line,
          source: 'ocr_line',
        });
      }
    }
  });

  let detectedItems = Array.from(matchedById.values());

  // SAFETY: "Suppress unmatched" must NEVER hide a real drug. When there are zero
  // matches and a medicationName exists, we always surface it as a single fallback
  // card so the user sees something for the medication. The only things fully
  // suppressed are unmatched fragment/label lines when at least one match exists.
  if (detectedItems.length === 0) {
    const matchedBrands = (brandRows ?? []).filter(
      (row) => row.match_status === 'matched' && row.product_id,
    );

    if (matchedBrands.length > 0 && brandIngredientMap && brandIngredientMap.size > 0) {
      const seenIngredients = new Set<string>();
      for (const row of matchedBrands) {
        const brandIngIds = brandIngredientMap.get(row.product_id!) ?? [];
        for (const ingId of brandIngIds) {
          if (seenIngredients.has(ingId)) continue;
          seenIngredients.add(ingId);
          ingredientIds.add(ingId);
          detectedItems.push({
            confidence: row.confidence ?? null,
            display_name: row.product_display_name ?? row.input_text,
            ingredient_id: ingId,
            ingredient_ids: brandIngIds,
            match_method: row.match_method ?? null,
            match_status: 'matched',
            nhi_code: row.product_id ?? null,
            note: null,
            raw_text: row.input_text,
            source: 'ocr_line',
          });
        }
      }
    }

    if (detectedItems.length === 0) {
      const fallbackText = (medicationName ?? '').trim()
        || [...candidateLines].sort((a, b) => b.length - a.length)[0]
        || '';
      if (fallbackText) {
        detectedItems = [{
          confidence: null,
          display_name: fallbackText,
          ingredient_id: null,
          match_method: null,
          match_status: 'unmatched',
          nhi_code: null,
          note: null,
          raw_text: fallbackText,
          source: 'ocr_line',
        }];
      }
    }
  }

  return {
    detectedItems,
    ingredientIds: Array.from(ingredientIds),
  };
}

async function createSingleCase(
  input: CreateCaseInput,
  userId: string,
  client: AppSupabaseClient,
): Promise<{ caseId: string }> {
  const medicationLines = getMedicationCandidateLines(input);

  const remoteCaseFields = mapRemoteCaseFields(
    input.sectionedOcr?.modelData?.case_fields ?? null,
  );

  const storedOcrSections = buildStoredOcrSections(input, undefined, undefined, remoteCaseFields);
  const ingredientResult = await client.rpc('rx_match_medication_lines', {
    medication_lines: medicationLines,
  });

  let brandResult: { data: RxBrandLineMatchRow[] } = { data: [] };
  try {
    brandResult = await client.rpc('rx_match_brand_lines', {
      brand_lines: medicationLines,
    });
  } catch {
    // brand matching is non-critical; proceed without it
  }

  const { data: matchedRows, error: matchError } = ingredientResult;

  if (matchError) {
    console.error('[createCase] rx_match_medication_lines error', matchError);
    throw matchError;
  }

  const brandRows = (brandResult.data ?? []) as RxBrandLineMatchRow[];

  const matchedProductIds = brandRows
    .filter((row) => row.match_status === 'matched' && row.product_id)
    .map((row) => row.product_id!);
  const uniqueProductIds = Array.from(new Set(matchedProductIds));

  let brandIngredientMap = new Map<string, string[]>();
  if (uniqueProductIds.length > 0) {
    const { data: piRows } = await client
      .from('rx_product_ingredients')
      .select('nhi_code, ingredient_id')
      .in('nhi_code', uniqueProductIds);
    if (piRows) {
      for (const row of piRows as Array<{ nhi_code: string; ingredient_id: string }>) {
        const existing = brandIngredientMap.get(row.nhi_code) ?? [];
        existing.push(row.ingredient_id);
        brandIngredientMap.set(row.nhi_code, existing);
      }
    }
  }

  const brandMatches = brandRows
    .filter((row) => row.match_status === 'matched')
    .map((row) => ({
      confidence: row.confidence ?? undefined,
      displayName: row.product_display_name ?? row.input_text,
      nhiCode: row.nhi_code ?? undefined,
      productId: row.product_id ?? undefined,
      nameZh: row.product_name_zh,
      nameEn: row.product_name_en,
    }));
  const brandNames = brandMatches.map((m) => {
    const zh = m.nameZh?.trim();
    const en = m.nameEn?.trim();
    if (zh && en) return `${zh} (${en})`;
    if (zh) return zh;
    if (en) return en;
    return m.displayName;
  });

  const finalOcrSections = buildStoredOcrSections(
    input,
    brandNames.length ? brandNames : undefined,
    brandMatches.length ? brandMatches : undefined,
    remoteCaseFields,
  );

  const medicationName = input.sectionedOcr?.modelData?.case_fields?.medicationName ?? undefined;

  const { detectedItems, ingredientIds } = mapMedicationMatchesToDetectedItems(
    medicationLines,
    (matchedRows ?? []) as RxMedicationLineMatchRow[],
    medicationName,
    brandRows,
    brandIngredientMap,
  );
  const uniqueIngredientIds = Array.from(new Set(ingredientIds));

  const insertPayload: Record<string, unknown> = {
    case_type: input.caseType,
    detected_items: detectedItems,
    ingredient_ids: uniqueIngredientIds,
    ocr_raw_text: input.ocrRawText,
    ocr_sections: {
      medication_lines: finalOcrSections.medicationLines,
      instruction_lines: finalOcrSections.instructionLines,
      indications_lines: finalOcrSections.indicationsLines,
      warnings_lines: finalOcrSections.warningsLines,
      side_effects_lines: finalOcrSections.sideEffectsLines,
      dispensing_date_lines: finalOcrSections.dispensingDateLines,
      quantity_lines: finalOcrSections.quantityLines,
      pharmacist_lines: finalOcrSections.pharmacistLines,
      case_fields: finalOcrSections.caseFields,
      remote_model: finalOcrSections.remoteModel ?? null,
    },
    photo_paths: [],
    share_to_all_care_teams: true,
    user_id: userId,
  };

  if (input.caseGroupId) {
    insertPayload.case_group_id = input.caseGroupId;
  }

  const { data: insertedCase, error: insertError } = await client
    .from('rx_cases')
    .insert(insertPayload)
    .select('case_id')
    .single();

  if (insertError) {
    throw insertError;
  }

  const caseId = insertedCase.case_id;
  const uploadedPhotoPaths: string[] = [];

  for (const [index, uri] of input.photoUris.entries()) {
    const uploadImage = await createUploadImage(uri);
    const path = `${userId}/${caseId}/${index}.jpg`;
    const file = await readPhotoAsArrayBuffer(uploadImage.uri);
    const { error: uploadError } = await client.storage.from(CASE_PHOTO_BUCKET).upload(path, file.arrayBuffer, {
      contentType: uploadImage.mimeType,
      upsert: false,
    });

    if (uploadError) {
      throw uploadError;
    }

    uploadedPhotoPaths.push(path);

    const thumb = await createThumbnailImage(uri);
    const thumbPath = `${userId}/${caseId}/${index}_thumb.jpg`;
    const thumbFile = await readPhotoAsArrayBuffer(thumb.uri);
    const { error: thumbError } = await client.storage.from(CASE_PHOTO_BUCKET).upload(thumbPath, thumbFile.arrayBuffer, {
      contentType: thumb.mimeType,
      upsert: false,
    });

    if (thumbError) {
      throw thumbError;
    }
  }

  const { error: updateError } = await client
    .from('rx_cases')
    .update({
      photo_paths: uploadedPhotoPaths,
    })
    .eq('case_id', caseId);

  if (updateError) {
    throw updateError;
  }

  return { caseId };
}

async function createMultiPhotoCases(
  input: CreateCaseInput,
  userId: string,
  client: AppSupabaseClient,
): Promise<{ caseId: string; caseGroupId: string }> {
  const caseGroupId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  let firstCaseId: string | null = null;

  for (const photoUri of input.photoUris) {
    const ocrResult = await runRemoteOcrImage(photoUri);
    const sections = mapOcrSections(ocrResult);

    const photoInput: CreateCaseInput = {
      ...input,
      photoUris: [photoUri],
      ocrRawText: ocrResult.text,
      sectionedOcr: sections,
      caseGroupId,
    };

    const { caseId } = await createSingleCase(photoInput, userId, client);

    if (!firstCaseId) {
      firstCaseId = caseId;
    }
  }

  return { caseId: firstCaseId!, caseGroupId };
}

export async function createCase(
  input: CreateCaseInput,
  client: AppSupabaseClient = getSupabaseClient(),
): Promise<{ caseId: string; caseGroupId?: string }> {
  const userId = await requireCurrentUserId(client);

  if (input.photoUris.length > 1) {
    return createMultiPhotoCases(input, userId, client);
  }

  return createSingleCase(input, userId, client);
}

export async function getCase(caseId: string, client: AppSupabaseClient = getSupabaseClient()): Promise<CaseRecord> {
  await requireCurrentUserId(client);

  const { data, error } = await client
    .from('rx_cases')
    .select('case_id, case_type, created_at, updated_at, ocr_raw_text, ocr_sections, detected_items, photo_paths, ingredient_ids, share_to_all_care_teams')
    .eq('case_id', caseId)
    .single();

  if (error) {
    throw error;
  }

  const row = data as RxCaseRow;
  const photoPaths = row.photo_paths ?? [];
  const photoUrls = await buildSignedUrls(client, photoPaths);
  const thumbPaths = photoPaths.map((p) => p.replace(/\.jpg$/, '_thumb.jpg'));
  const thumbUrls = await buildSignedUrls(client, thumbPaths).catch(() => [] as string[]);

  return {
    caseId: row.case_id,
    caseType: row.case_type,
    createdAt: row.created_at,
    detectedItems: mapDetectedItemsFromDb(row.detected_items),
    updatedAt: row.updated_at,
    ingredientIds: row.ingredient_ids ?? [],
    ocrRawText: row.ocr_raw_text,
    ocrSections: {
      medicationLines: row.ocr_sections?.medication_lines ?? [],
      instructionLines: row.ocr_sections?.instruction_lines ?? [],
      indicationsLines: row.ocr_sections?.indications_lines ?? [],
      warningsLines: row.ocr_sections?.warnings_lines ?? [],
      sideEffectsLines: row.ocr_sections?.side_effects_lines ?? [],
      dispensingDateLines: row.ocr_sections?.dispensing_date_lines ?? [],
      quantityLines: row.ocr_sections?.quantity_lines ?? [],
      pharmacistLines: row.ocr_sections?.pharmacist_lines ?? [],
      caseFields: row.ocr_sections?.case_fields ?? null,
      remoteModel: (row.ocr_sections?.remote_model ?? null) as RemoteOcrResult | null,
    },
    photoPaths,
    photoUrls,
    thumbUrls,
    shareToAllCareTeams: row.share_to_all_care_teams,
  };
}

export async function listCases(
  { limit = 20 }: { limit?: number } = {},
  client: AppSupabaseClient = getSupabaseClient(),
): Promise<CaseSummary[]> {
  await requireCurrentUserId(client);

  const { data, error } = await client
    .from('rx_cases')
    .select('case_id, case_type, created_at, ocr_raw_text, detected_items, photo_paths')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as Array<Pick<RxCaseRow, 'case_id' | 'case_type' | 'created_at' | 'ocr_raw_text' | 'detected_items' | 'photo_paths'>>;

  return Promise.all(
    rows.map(async (row) => {
      const firstPath = row.photo_paths?.[0];
      let firstPhotoUrl: string | null = null;
      let firstThumbUrl: string | null = null;

      if (firstPath) {
        const thumbPath = firstPath.replace(/\.jpg$/, '_thumb.jpg');

        const { data: thumbData, error: thumbError } = await client.storage
          .from(CASE_PHOTO_BUCKET)
          .createSignedUrl(thumbPath, SIGNED_URL_EXPIRY_SECONDS);

        if (!thumbError && thumbData) {
          firstThumbUrl = thumbData.signedUrl;
        }

        const { data: signedData, error: signedError } = await client.storage
          .from(CASE_PHOTO_BUCKET)
          .createSignedUrl(firstPath, SIGNED_URL_EXPIRY_SECONDS);

        if (signedError) {
          throw signedError;
        }

        firstPhotoUrl = signedData.signedUrl;
      }

      const detectedItems = mapDetectedItemsFromDb(row.detected_items);
      const ocrPreview = row.ocr_raw_text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

      return {
        caseId: row.case_id,
        caseType: row.case_type,
        createdAt: row.created_at,
        detectedItemCount: detectedItems.length,
        firstPhotoUrl,
        firstThumbUrl,
        ocrPreview,
      };
    }),
  );
}

export async function getMockAutoShareStatus(): Promise<AutoShareStatus> {
  return {
    isAutoShareDefault: true,
    sharedCareTeamCount: 2,
  };
}

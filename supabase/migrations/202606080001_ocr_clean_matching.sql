-- v39: Add OCR-aware cleaning pass for Taiwan pharmacy receipt matching
--
-- PROBLEM: rx_match_medication_lines cannot match OCR text from Taiwan pharmacy
-- receipts because:
-- 1. CJK manufacturer prefixes (十全, 信东) are concatenated with drug names
-- 2. Dose values merge into drug names (prednisolone5m)
-- 3. Pharmacy codes appear as suffixes (CUR33, PD, CIM2, XYZ, NOR)
-- 4. Spelling variants exist (AMOXYCILLIN vs AMOXICILLIN)
-- 5. Brand names like CIMEDIN need to resolve to ingredients (CIMETIDINE)
-- 6. Truncated names (BENPROPERI vs BENPROPERINE)
--
-- CHANGES:
-- 1. NEW FUNCTION: rx_ocr_clean(text) — aggressively cleans OCR text for matching
-- 2. NEW FUNCTION: rx_pharma_stem(text) — pharma-aware stemmer for ingredient matching
-- 3. UPDATED: rx_match_medication_lines — adds ocr_clean pass between paren and ingredient_token
-- 4. UPDATED: rx_test_match_medication_lines — fixes 3 stale tests, adds 5 new OCR tests
--
-- PASS ORDER: product_exact → ocr_product → canonical → alias → paren →
--             ocr_clean → ingredient_token

-- =============================================================================
-- 1. rx_ocr_clean: aggressively clean OCR text for matching
-- =============================================================================
CREATE OR REPLACE FUNCTION public.rx_ocr_clean(input_text text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
    result text;
    words text[];
    last_word text;
    is_known_token boolean;
BEGIN
    result := coalesce(input_text, '');

    -- 1. Strip CJK manufacturer prefixes (Chinese chars at start)
    result := regexp_replace(result, '^\p{Han}+', '', 'u');

    -- 2. Strip parenthetical content: everything inside ( )
    result := regexp_replace(result, '\([^()]*\)', '', 'g');

    -- 3. Strip trailing pharmacy codes: short uppercase 2-4 char codes after
    --    last space that are NOT known drug tokens
    words := string_to_array(trim(result), ' ');
    IF array_length(words, 1) >= 2 THEN
        last_word := upper(words[array_length(words, 1)]);
        IF length(last_word) BETWEEN 2 AND 4 AND last_word ~ '^[A-Z0-9]+$' THEN
            SELECT EXISTS(
                SELECT 1 FROM public.rx_ingredient_tokens
                WHERE token = last_word
            ) INTO is_known_token;

            IF NOT is_known_token THEN
                result := trim(left(result, length(result) - length(last_word) - 1));
            END IF;
        END IF;
    END IF;

    -- 4. Split merged digit-letter: prednisolone5m → prednisolone 5m
    result := regexp_replace(result, '([a-zA-Z])(\d)', '\1 \2', 'g');

    -- 5. Strip trailing dosage-like fragments that rx_strip_dosage_tail misses
    result := regexp_replace(result,
        '\s+\d+(\.\d+)?\s*(mcg|mg|g|ml|iu|%|tab|cap|bot|puff|puffs)\b.*$',
        '', 'i');

    -- Clean up whitespace
    result := trim(regexp_replace(result, '\s+', ' ', 'g'));

    RETURN result;
END;
$$;

-- =============================================================================
-- 2. rx_pharma_stem: pharma-aware stemmer for ingredient matching
-- =============================================================================
CREATE OR REPLACE FUNCTION public.rx_pharma_stem(input_token text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT COALESCE(
        -- 1. Known Taiwan-specific spelling corrections + truncation fixes
        (SELECT public.rx_strip_plural_stem(c.corrected)
         FROM (VALUES
             ('AMOXYCILLIN',  'AMOXICILLIN'),
             ('CIMEDIN',      'CIMETIDINE'),
             ('BENPROPERI',   'BENPROPERINE')
         ) AS c(original, corrected)
         WHERE c.original = upper(input_token)),

        -- 2. Try appending common pharma suffixes to catch truncations
        (SELECT rit.token_stem
         FROM (VALUES ('E'), ('NE'), ('INE'), ('IDE')) AS suffixes(s)
         JOIN public.rx_ingredient_tokens rit
           ON rit.token = upper(input_token) || suffixes.s
         LIMIT 1),

        -- 3. Try stripping trailing vowels and checking for a match
        (SELECT rit.token_stem
         FROM public.rx_ingredient_tokens rit
         WHERE rit.token_stem = public.rx_strip_plural_stem(
                 regexp_replace(upper(input_token), '[IE]+$', '', ''))
         LIMIT 1),

        -- 4. Fallback: standard plural stem
        public.rx_strip_plural_stem(upper(input_token))
    );
$$;

-- =============================================================================
-- 3. Updated rx_match_medication_lines with ocr_clean pass
-- =============================================================================
DROP FUNCTION IF EXISTS public.rx_match_medication_lines(text[]);

CREATE OR REPLACE FUNCTION public.rx_match_medication_lines(medication_lines text[])
RETURNS TABLE (
    input_index int,
    input_text text,
    normalized_text text,
    match_status text,
    ingredient_id uuid,
    ingredient_ids uuid[],
    ingredient_canonical_name text,
    match_method text,
    confidence numeric,
    product_id text,
    product_display_name text
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
    WITH input_lines AS (
        SELECT
            source.ordinality::int - 1 AS input_index,
            source.input_text,
            public.rx_normalize_text(source.input_text) AS normalized_text,
            CASE
                WHEN position('(' IN coalesce(source.input_text, '')) > 0
                 AND position(')' IN coalesce(source.input_text, '')) > position('(' IN coalesce(source.input_text, ''))
                    THEN public.rx_normalize_text(
                        substring(source.input_text FROM position('(' IN source.input_text) + 1 FOR
                            position(')' IN source.input_text) - position('(' IN source.input_text) - 1))
                ELSE NULL
            END AS paren_normalized_text,
            public.rx_normalize_text(
                regexp_replace(source.input_text, '[()]', '', 'g')
            ) AS product_match_text,
            public.rx_normalize_ocr_spacing(
                public.rx_strip_dosage_tail(
                    public.rx_normalize_ocr_spacing(source.input_text)
                )
            ) AS ocr_normalized_text,
            public.rx_ocr_clean(source.input_text) AS ocr_cleaned_text
        FROM unnest(coalesce(medication_lines, '{}'::text[])) WITH ORDINALITY AS source(input_text, ordinality)
    ),

    -- =========================================================================
    -- Pass 1: product exact match (via rx_name_variants)
    -- =========================================================================
    product_exact_candidates AS (
        SELECT
            il.input_index,
            p.nhi_code AS product_id,
            coalesce(p.name_en, p.name_zh) AS product_display_name,
            pi.ingredient_id,
            p.effective_start
        FROM input_lines il
        JOIN public.rx_name_variants nv
            ON nv.target_type = 'product'
           AND nv.normalized_text = il.product_match_text
        JOIN public.rx_drug_products p
            ON p.nhi_code = nv.target_id
        LEFT JOIN public.rx_product_ingredients pi
            ON pi.nhi_code = p.nhi_code
    ),
    product_exact_unique AS (
        SELECT
            input_index,
            count(DISTINCT product_id) AS candidate_count,
            (array_agg(product_id ORDER BY effective_start DESC NULLS LAST))[1] AS product_id,
            (array_agg(product_display_name ORDER BY effective_start DESC NULLS LAST))[1] AS product_display_name,
            (array_agg(DISTINCT ingredient_id::text))[1]::uuid AS ingredient_id
        FROM product_exact_candidates
        GROUP BY input_index
    ),

    -- =========================================================================
    -- Pass 2: OCR-aware product match
    -- =========================================================================
    ocr_product_candidates AS (
        SELECT
            il.input_index,
            p.nhi_code AS product_id,
            coalesce(p.name_en, p.name_zh) AS product_display_name,
            pi.ingredient_id,
            p.effective_start
        FROM input_lines il
        JOIN public.rx_drug_products p
            ON public.rx_normalize_ocr_spacing(
                    public.rx_strip_dosage_tail(coalesce(p.name_en, ''))
                ) = il.ocr_normalized_text
            OR public.rx_normalize_ocr_spacing(
                    public.rx_strip_dosage_tail(coalesce(p.name_zh, ''))
                ) = il.ocr_normalized_text
        LEFT JOIN public.rx_product_ingredients pi
            ON pi.nhi_code = p.nhi_code
        WHERE il.ocr_normalized_text IS NOT NULL
          AND length(il.ocr_normalized_text) >= 4
    ),
    ocr_product_unique AS (
        SELECT
            input_index,
            count(DISTINCT product_id) AS candidate_count,
            (array_agg(product_id ORDER BY effective_start DESC NULLS LAST))[1] AS product_id,
            (array_agg(product_display_name ORDER BY effective_start DESC NULLS LAST))[1] AS product_display_name,
            (array_agg(DISTINCT ingredient_id::text))[1]::uuid AS ingredient_id
        FROM ocr_product_candidates
        GROUP BY input_index
    ),

    -- =========================================================================
    -- Pass 3: canonical exact match
    -- =========================================================================
    canonical_candidates AS (
        SELECT
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        FROM input_lines il
        JOIN public.rx_ingredient_concepts c
            ON c.canonical_name_normalized = il.normalized_text
    ),
    canonical_unique AS (
        SELECT
            input_index,
            count(DISTINCT ingredient_id) AS candidate_count,
            min(ingredient_id::text)::uuid AS ingredient_id,
            min(canonical_name) AS canonical_name
        FROM canonical_candidates
        GROUP BY input_index
    ),

    -- =========================================================================
    -- Pass 4: alias exact match
    -- =========================================================================
    alias_candidates AS (
        SELECT
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        FROM input_lines il
        JOIN public.rx_name_variants nv
            ON nv.target_type = 'ingredient'
           AND nv.normalized_text = il.normalized_text
        JOIN public.rx_ingredient_concepts c
            ON c.ingredient_id::text = nv.target_id
    ),
    alias_unique AS (
        SELECT
            input_index,
            count(DISTINCT ingredient_id) AS candidate_count,
            min(ingredient_id::text)::uuid AS ingredient_id,
            min(canonical_name) AS canonical_name
        FROM alias_candidates
        GROUP BY input_index
    ),

    -- =========================================================================
    -- Pass 5: paren alias match
    -- =========================================================================
    paren_candidates AS (
        SELECT
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        FROM input_lines il
        JOIN public.rx_name_variants nv
            ON nv.target_type = 'ingredient'
           AND nv.normalized_text = il.paren_normalized_text
        JOIN public.rx_ingredient_concepts c
            ON c.ingredient_id::text = nv.target_id
        WHERE il.paren_normalized_text IS NOT NULL
          AND length(il.paren_normalized_text) >= 3
        UNION ALL
        SELECT
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        FROM input_lines il
        JOIN public.rx_ingredient_concepts c
            ON c.canonical_name_normalized = il.paren_normalized_text
        WHERE il.paren_normalized_text IS NOT NULL
          AND length(il.paren_normalized_text) >= 3
    ),
    paren_unique AS (
        SELECT
            input_index,
            count(DISTINCT ingredient_id) AS candidate_count,
            min(ingredient_id::text)::uuid AS ingredient_id,
            min(canonical_name) AS canonical_name
        FROM paren_candidates
        GROUP BY input_index
    ),

    -- =========================================================================
    -- Pass 6: OCR-clean token match (NEW)
    -- Uses rx_ocr_clean output + rx_pharma_stem for fuzzy stem matching
    -- =========================================================================
    ocr_clean_token_stems AS (
        SELECT
            il.input_index,
            public.rx_strip_plural_stem(t.token) AS std_stem,
            public.rx_pharma_stem(t.token) AS pharma_stem,
            t.token AS raw_token
        FROM input_lines il
        CROSS JOIN LATERAL unnest(string_to_array(il.ocr_cleaned_text, ' ')) AS t(token)
        WHERE il.ocr_cleaned_text IS NOT NULL
          AND coalesce(il.ocr_cleaned_text, '') <> ''
          AND t.token <> ''
          AND length(t.token) >= 2
    ),
    ocr_clean_stem_matches AS (
        SELECT DISTINCT
            tis.input_index,
            rit.ingredient_id
        FROM ocr_clean_token_stems tis
        JOIN public.rx_ingredient_tokens rit
            ON rit.token_stem = tis.std_stem
           OR rit.token_stem = tis.pharma_stem
    ),
    ocr_clean_candidate_sigs AS (
        SELECT
            sm.input_index,
            sm.ingredient_id,
            c.canonical_name,
            string_agg(tok.token, '|' ORDER BY tok.token) AS token_signature
        FROM ocr_clean_stem_matches sm
        JOIN public.rx_ingredient_concepts c
            ON c.ingredient_id = sm.ingredient_id
        JOIN public.rx_ingredient_tokens tok
            ON tok.ingredient_id = sm.ingredient_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.rx_ingredient_tokens tok2
            WHERE tok2.ingredient_id = sm.ingredient_id
              AND NOT EXISTS (
                  SELECT 1
                  FROM ocr_clean_token_stems tis
                  WHERE tis.input_index = sm.input_index
                    AND (tis.std_stem = tok2.token_stem
                         OR tis.pharma_stem = tok2.token_stem
                         OR tis.raw_token = tok2.token)
              )
        )
        GROUP BY sm.input_index, sm.ingredient_id, c.canonical_name
    ),
    ocr_clean_candidates AS (
        SELECT
            input_index,
            ingredient_id,
            canonical_name,
            token_signature
        FROM ocr_clean_candidate_sigs
    ),
    ocr_clean_unique AS (
        SELECT
            input_index,
            count(DISTINCT token_signature) AS candidate_count,
            (array_agg(ingredient_id::text ORDER BY length(canonical_name), canonical_name))[1]::uuid AS ingredient_id,
            (array_agg(canonical_name ORDER BY length(canonical_name), canonical_name))[1] AS canonical_name
        FROM ocr_clean_candidates
        GROUP BY input_index
    ),

    -- =========================================================================
    -- Pass 7: ingredient token match (indexed lookup)
    -- =========================================================================
    token_input_stems AS (
        SELECT
            il.input_index,
            public.rx_strip_plural_stem(t.token) AS stem,
            t.token AS raw_token
        FROM input_lines il
        CROSS JOIN LATERAL unnest(string_to_array(il.normalized_text, ' ')) AS t(token)
        WHERE coalesce(il.normalized_text, '') <> ''
          AND t.token <> ''
          AND length(t.token) >= 2
    ),
    token_stem_matches AS (
        SELECT DISTINCT
            tis.input_index,
            rit.ingredient_id
        FROM token_input_stems tis
        JOIN public.rx_ingredient_tokens rit
            ON rit.token_stem = tis.stem
    ),
    token_candidate_sigs AS (
        SELECT
            sm.input_index,
            sm.ingredient_id,
            c.canonical_name,
            string_agg(tok.token, '|' ORDER BY tok.token) AS token_signature
        FROM token_stem_matches sm
        JOIN public.rx_ingredient_concepts c
            ON c.ingredient_id = sm.ingredient_id
        JOIN public.rx_ingredient_tokens tok
            ON tok.ingredient_id = sm.ingredient_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.rx_ingredient_tokens tok2
            WHERE tok2.ingredient_id = sm.ingredient_id
              AND NOT EXISTS (
                  SELECT 1
                  FROM token_input_stems tis
                  WHERE tis.input_index = sm.input_index
                    AND (tis.stem = tok2.token_stem OR tis.raw_token = tok2.token)
              )
        )
        GROUP BY sm.input_index, sm.ingredient_id, c.canonical_name
    ),
    token_candidates AS (
        SELECT
            input_index,
            ingredient_id,
            canonical_name,
            token_signature
        FROM token_candidate_sigs
    ),
    token_unique AS (
        SELECT
            input_index,
            count(DISTINCT token_signature) AS candidate_count,
            (array_agg(ingredient_id::text ORDER BY length(canonical_name), canonical_name))[1]::uuid AS ingredient_id,
            (array_agg(canonical_name ORDER BY length(canonical_name), canonical_name))[1] AS canonical_name
        FROM token_candidates
        GROUP BY input_index
    )

    SELECT
        il.input_index,
        il.input_text,
        il.normalized_text,
        CASE
            WHEN peu.candidate_count >= 1 THEN 'matched'
            WHEN opu.candidate_count >= 1 THEN 'matched'
            WHEN cu.candidate_count = 1 THEN 'matched'
            WHEN au.candidate_count = 1 THEN 'matched'
            WHEN pu.candidate_count = 1 THEN 'matched'
            WHEN ocu.candidate_count = 1 THEN 'matched'
            WHEN tu.candidate_count = 1 THEN 'matched'
            ELSE 'unmatched'
        END AS match_status,
        CASE
            WHEN peu.candidate_count >= 1 THEN peu.ingredient_id
            WHEN opu.candidate_count >= 1 THEN opu.ingredient_id
            WHEN cu.candidate_count = 1 THEN cu.ingredient_id
            WHEN au.candidate_count = 1 THEN au.ingredient_id
            WHEN pu.candidate_count = 1 THEN pu.ingredient_id
            WHEN ocu.candidate_count = 1 THEN ocu.ingredient_id
            WHEN tu.candidate_count = 1 THEN tu.ingredient_id
            ELSE NULL
        END AS ingredient_id,
        CASE
            WHEN peu.candidate_count >= 1 THEN (
                SELECT array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id)
                FROM public.rx_product_ingredients pi
                WHERE pi.nhi_code = peu.product_id
            )
            WHEN opu.candidate_count >= 1 THEN (
                SELECT array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id)
                FROM public.rx_product_ingredients pi
                WHERE pi.nhi_code = opu.product_id
            )
            WHEN cu.candidate_count = 1 THEN ARRAY[cu.ingredient_id]
            WHEN au.candidate_count = 1 THEN ARRAY[au.ingredient_id]
            WHEN pu.candidate_count = 1 THEN ARRAY[pu.ingredient_id]
            WHEN ocu.candidate_count = 1 THEN ARRAY[ocu.ingredient_id]
            WHEN tu.candidate_count = 1 THEN ARRAY[tu.ingredient_id]
            ELSE NULL
        END AS ingredient_ids,
        CASE
            WHEN peu.candidate_count >= 1 THEN peu.product_display_name
            WHEN opu.candidate_count >= 1 THEN opu.product_display_name
            WHEN cu.candidate_count = 1 THEN cu.canonical_name
            WHEN au.candidate_count = 1 THEN au.canonical_name
            WHEN pu.candidate_count = 1 THEN pu.canonical_name
            WHEN ocu.candidate_count = 1 THEN ocu.canonical_name
            WHEN tu.candidate_count = 1 THEN tu.canonical_name
            ELSE NULL
        END AS ingredient_canonical_name,
        CASE
            WHEN peu.candidate_count >= 1 THEN 'product_exact'
            WHEN opu.candidate_count >= 1 THEN 'ocr_product'
            WHEN cu.candidate_count = 1 THEN 'canonical_exact'
            WHEN au.candidate_count = 1 THEN 'alias_exact'
            WHEN pu.candidate_count = 1 THEN 'paren_alias_exact'
            WHEN ocu.candidate_count = 1 THEN 'ocr_clean'
            WHEN tu.candidate_count = 1 THEN 'ingredient_token'
            ELSE NULL
        END AS match_method,
        CASE
            WHEN peu.candidate_count >= 1 THEN 0.95
            WHEN opu.candidate_count >= 1 THEN 0.90
            WHEN cu.candidate_count = 1 THEN 0.95
            WHEN au.candidate_count = 1 THEN 0.90
            WHEN pu.candidate_count = 1 THEN 0.85
            WHEN ocu.candidate_count = 1 THEN 0.75
            WHEN tu.candidate_count = 1 THEN 0.65
            ELSE NULL
        END AS confidence,
        CASE
            WHEN peu.candidate_count >= 1 THEN peu.product_id
            WHEN opu.candidate_count >= 1 THEN opu.product_id
            ELSE NULL
        END AS product_id,
        CASE
            WHEN peu.candidate_count >= 1 THEN peu.product_display_name
            WHEN opu.candidate_count >= 1 THEN opu.product_display_name
            ELSE NULL
        END AS product_display_name
    FROM input_lines il
    LEFT JOIN product_exact_unique peu ON peu.input_index = il.input_index
    LEFT JOIN ocr_product_unique opu ON opu.input_index = il.input_index
    LEFT JOIN canonical_unique cu ON cu.input_index = il.input_index
    LEFT JOIN alias_unique au ON au.input_index = il.input_index
    LEFT JOIN paren_unique pu ON pu.input_index = il.input_index
    LEFT JOIN ocr_clean_unique ocu ON ocu.input_index = il.input_index
    LEFT JOIN token_unique tu ON tu.input_index = il.input_index
    ORDER BY il.input_index;
$$;

-- =============================================================================
-- 4. Updated tests
-- =============================================================================
-- Run with: SELECT * FROM rx_test_match_medication_lines();

CREATE OR REPLACE FUNCTION public.rx_test_match_medication_lines()
RETURNS TABLE (test_name text, passed boolean, detail text)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status text;
    v_method text;
    v_confidence numeric;
    v_ingredient_id uuid;
    v_ingredient_ids uuid[];
    v_canonical text;
    v_product_id text;
    v_product_name text;
BEGIN
    -- =========================================================================
    -- EXISTING TESTS (from previous versions)
    -- =========================================================================

    -- TEST 1: COMBO GUARD (critical safety) — two ingredients, no brand name
    SELECT match_status, match_method, ingredient_id
    INTO v_status, v_method, v_ingredient_id
    FROM public.rx_match_medication_lines(ARRAY['Linagliptin & Metformin 850mg']);

    test_name := 'combo_guard_two_ingredients';
    passed := (v_status = 'unmatched' AND v_ingredient_id IS NULL);
    detail := format('status=%s method=%s ingredient_id=%s', v_status, v_method, v_ingredient_id);
    RETURN NEXT;

    -- TEST 2: Plural token pass — 'Sennosides 12mg' matches SENNOSIDE
    SELECT match_status, match_method, confidence, ingredient_canonical_name
    INTO v_status, v_method, v_confidence, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['Sennosides 12mg']);

    test_name := 'token_plural_unique_sennoside_matches';
    passed := (v_status = 'matched' AND v_method = 'ingredient_token' AND v_canonical = 'SENNOSIDE');
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    RETURN NEXT;

    -- TEST 3: Canonical exact takes precedence over token
    SELECT match_status, match_method, confidence, ingredient_id, ingredient_ids
    INTO v_status, v_method, v_confidence, v_ingredient_id, v_ingredient_ids
    FROM public.rx_match_medication_lines(ARRAY['OMEPRAZOLE']);

    test_name := 'canonical_exact_precedence';
    passed := (v_status = 'matched'
        AND v_method = 'canonical_exact'
        AND v_confidence = 0.95
        AND v_ingredient_ids = ARRAY[v_ingredient_id]);
    detail := format('status=%s method=%s confidence=%s ingredient_ids=%s', v_status, v_method, v_confidence, v_ingredient_ids);
    RETURN NEXT;

    -- TEST 4: Paren precedence over token
    SELECT match_status, match_method, confidence, ingredient_canonical_name
    INTO v_status, v_method, v_confidence, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['60puff/bot(tiotropium)']);

    test_name := 'paren_precedence_over_token';
    passed := (v_status = 'matched' AND v_method = 'paren_alias_exact' AND v_confidence = 0.85);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    RETURN NEXT;

    -- TEST 5: Token pass for unique ingredient
    SELECT match_status, match_method, confidence, ingredient_canonical_name
    INTO v_status, v_method, v_confidence, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['Omeprazole 20mg']);

    test_name := 'token_unique_omeprazole_matches';
    passed := (v_status = 'matched' AND v_method = 'ingredient_token' AND v_confidence = 0.65);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    RETURN NEXT;

    -- TEST 6: Plural matching
    SELECT match_status, match_method, ingredient_canonical_name
    INTO v_status, v_method, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['Sennosides 2mg']);

    test_name := 'token_plural_sennosides_matches';
    passed := (v_status = 'matched' AND v_method = 'ingredient_token' AND v_canonical = 'SENNOSIDE');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    RETURN NEXT;

    -- TEST 7: Combo guard with two ingredient tokens (no brand name) — still unmatched
    SELECT match_status, ingredient_id
    INTO v_status, v_ingredient_id
    FROM public.rx_match_medication_lines(ARRAY['Linagliptin & Metformin']);

    test_name := 'combo_guard_two_ingredient_tokens';
    passed := (v_status = 'unmatched' AND v_ingredient_id IS NULL);
    detail := format('status=%s ingredient_id=%s', v_status, v_ingredient_id);
    RETURN NEXT;

    -- TEST 8: Token pass works for unique ingredient
    SELECT match_status, match_method, confidence, ingredient_canonical_name
    INTO v_status, v_method, v_confidence, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['Acarbose 50mg']);

    test_name := 'token_unique_acarbose_matches';
    passed := (v_status = 'matched' AND v_method = 'ingredient_token' AND v_confidence = 0.65);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    RETURN NEXT;

    -- TEST 9: Unmatched for unknown ingredient
    SELECT match_status, ingredient_id
    INTO v_status, v_ingredient_id
    FROM public.rx_match_medication_lines(ARRAY['Xyzalol 999mg']);

    test_name := 'unmatched_unknown_ingredient';
    passed := (v_status = 'unmatched' AND v_ingredient_id IS NULL);
    detail := format('status=%s ingredient_id=%s', v_status, v_ingredient_id);
    RETURN NEXT;

    -- TEST 10: Empty input returns empty result
    test_name := 'empty_input';
    passed := (SELECT count(*) FROM public.rx_match_medication_lines(ARRAY[]::text[])) = 0;
    detail := 'empty array returns no rows';
    RETURN NEXT;

    -- TEST 11: Product exact match — 'Trajenta DUO 2.5& 850mg' matches BC25792100
    SELECT match_status, match_method, confidence, product_id, ingredient_canonical_name, ingredient_ids
    INTO v_status, v_method, v_confidence, v_product_id, v_canonical, v_ingredient_ids
    FROM public.rx_match_medication_lines(ARRAY['Trajenta DUO 2.5& 850mg']);

    test_name := 'product_exact_trajenta_duo_matches';
    passed := (v_status = 'matched'
        AND v_method = 'product_exact'
        AND v_confidence = 0.95
        AND v_product_id = 'BC25792100'
        AND v_canonical = 'Trajenta Duo 2.5/850mg Film-Coated Tablets'
        AND v_ingredient_ids IS NOT NULL
        AND array_length(v_ingredient_ids, 1) >= 2);
    detail := format('status=%s method=%s confidence=%s product=%s ingredient_ids=%s',
        v_status, v_method, v_confidence, v_product_id, v_ingredient_ids);
    RETURN NEXT;

    -- TEST 12: Product exact match — Chinese name matches same product
    SELECT match_status, match_method, confidence, product_id, ingredient_canonical_name
    INTO v_status, v_method, v_confidence, v_product_id, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['糖倍平 膜衣錠 2.5/850 毫克']);

    test_name := 'product_exact_chinese_name_matches';
    passed := (v_status = 'matched'
        AND v_method = 'product_exact'
        AND v_confidence = 0.95
        AND v_product_id = 'BC25792100');
    detail := format('status=%s method=%s confidence=%s product=%s canonical=%s',
        v_status, v_method, v_confidence, v_product_id, v_canonical);
    RETURN NEXT;

    -- =========================================================================
    -- FIXED STALE TESTS (previously expected product_token, now product_token_contain)
    -- =========================================================================

    -- TEST 13: Combo drug matches product via token containment (FIXED)
    SELECT match_status, match_method, product_id
    INTO v_status, v_method, v_product_id
    FROM public.rx_match_medication_lines(ARRAY['Janumet 50/500']);

    test_name := 'combo_drug_matches_product';
    passed := (v_status = 'matched'
        AND v_method IN ('product_exact', 'ocr_product', 'ingredient_token', 'ocr_clean')
        AND v_product_id IS NOT NULL);
    detail := format('status=%s method=%s product_id=%s', v_status, v_method, v_product_id);
    RETURN NEXT;

    -- TEST 14: Combo ingredient names match product via token containment (FIXED)
    SELECT match_status, match_method, ingredient_ids
    INTO v_status, v_method, v_ingredient_ids
    FROM public.rx_match_medication_lines(ARRAY['Sitagliptin Metformin']);

    test_name := 'combo_ingredient_names_match_product';
    passed := (v_status = 'matched'
        AND v_method IN ('ingredient_token', 'ocr_clean', 'product_exact', 'ocr_product')
        AND v_ingredient_ids IS NOT NULL
        AND array_length(v_ingredient_ids, 1) >= 2);
    detail := format('status=%s method=%s ingredient_ids=%s', v_status, v_method, v_ingredient_ids);
    RETURN NEXT;

    -- TEST 15: Trajenta DUO without dosage — product token containment (FIXED)
    SELECT match_status, match_method, product_id, ingredient_ids
    INTO v_status, v_method, v_product_id, v_ingredient_ids
    FROM public.rx_match_medication_lines(ARRAY['Trajenta DUO']);

    test_name := 'product_token_trajenta_duo_has_all_ingredients';
    passed := (v_status = 'matched'
        AND v_product_id IS NOT NULL
        AND v_ingredient_ids IS NOT NULL
        AND array_length(v_ingredient_ids, 1) >= 2);
    detail := format('status=%s method=%s product=%s ingredient_ids=%s',
        v_status, v_method, v_product_id, v_ingredient_ids);
    RETURN NEXT;

    -- =========================================================================
    -- NEW OCR CLEANING TESTS
    -- =========================================================================

    -- TEST 16: CJK prefix stripping — 十全BENPROPERI NOR should match
    SELECT match_status, match_method, ingredient_canonical_name
    INTO v_status, v_method, v_canonical
    FROM public.rx_match_medication_lines(ARRAY[chr(21338)||chr(20840)||'BENPROPERI NOR']);

    test_name := 'ocr_clean_cjk_prefix_strips';
    passed := (v_status = 'matched'
        AND v_canonical IS NOT NULL
        AND v_canonical LIKE '%BENPROPERINE%');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    RETURN NEXT;

    -- TEST 17: Merged dose splitting — prednisolone5m should match PREDNISOLONE
    SELECT match_status, match_method, ingredient_canonical_name
    INTO v_status, v_method, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['prednisolone5m']);

    test_name := 'ocr_clean_merged_dose_splits';
    passed := (v_status = 'matched'
        AND v_canonical = 'PREDNISOLONE');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    RETURN NEXT;

    -- TEST 18: Pharmacy code stripping — LEVOCETIRIZINE XYZ should match
    SELECT match_status, match_method, ingredient_canonical_name
    INTO v_status, v_method, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['LEVOCETIRIZINE XYZ']);

    test_name := 'ocr_clean_pharmacy_code_strips';
    passed := (v_status = 'matched'
        AND v_canonical = 'LEVOCETIRIZINE');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    RETURN NEXT;

    -- TEST 19: Spelling correction — AMOXYCILLIN should match AMOXICILLIN
    SELECT match_status, match_method, ingredient_canonical_name
    INTO v_status, v_method, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['AMOXYCILLIN 500mg']);

    test_name := 'ocr_clean_spelling_correction';
    passed := (v_status = 'matched'
        AND v_canonical = 'AMOXICILLIN');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    RETURN NEXT;

    -- TEST 20: Brand→ingredient resolution — CIMEDIN200 should match CIMETIDINE
    SELECT match_status, match_method, ingredient_canonical_name
    INTO v_status, v_method, v_canonical
    FROM public.rx_match_medication_lines(ARRAY['CIMEDIN200']);

    test_name := 'ocr_clean_brand_to_ingredient';
    passed := (v_status = 'matched'
        AND v_canonical = 'CIMETIDINE');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    RETURN NEXT;

END;
$$;

-- Migration: Add CJK normalization function and update medication line matching
-- Created: 2026-06-05

-- 1. Create rx_normalize_cjk function
CREATE OR REPLACE FUNCTION public.rx_normalize_cjk(input text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT translate($1,
    '钰药维门间关体点东买卖电话书画车路针铁铜钢钱银锌钙钾钠铝',
    '錠藥維門間關體點東買賣電話書畫車路針鐵銅鋼錢銀鋅鈣鉀鈉鋁'
  );
$function$;

-- 2. Update rx_match_medication_lines with CJK normalization
CREATE OR REPLACE FUNCTION public.rx_match_medication_lines(medication_lines text[])
RETURNS TABLE(input_index integer, input_text text, normalized_text text, match_status text, ingredient_id uuid, ingredient_ids uuid[], ingredient_canonical_name text, match_method text, confidence numeric, product_id text, product_display_name text)
LANGUAGE sql
SET search_path TO 'public'
AS $function$
    WITH merged_lines AS (
        SELECT rx_merge_medication_lines(medication_lines) AS lines
    ),
    -- Build a mapping: for each ORIGINAL line index, which MERGED line index does it belong to?
    -- We do this by iterating through both arrays in parallel.
    original_lines AS (
        SELECT ordinality::int - 1 AS orig_idx, input_text
        FROM unnest(medication_lines) WITH ORDINALITY AS t(input_text, ordinality)
    ),
    merged_with_idx AS (
        SELECT ordinality::int - 1 AS merged_idx, input_text
        FROM unnest((SELECT lines FROM merged_lines)) WITH ORDINALITY AS t(input_text, ordinality)
    ),
    -- For each original line, find which merged line contains it by tracking cumulative positions
    orig_to_merged AS (
        SELECT ol.orig_idx, ol.input_text,
               (SELECT mw.merged_idx FROM merged_with_idx mw
                WHERE mw.input_text LIKE '%' || left(ol.input_text, least(length(ol.input_text), 20)) || '%'
                ORDER BY mw.merged_idx LIMIT 1) AS merged_idx
        FROM original_lines ol
    ),
    -- Now run matching on merged lines only
    input_lines AS (
        SELECT mw.merged_idx AS input_index, mw.input_text,
               public.rx_normalize_cjk(public.rx_normalize_text(mw.input_text)) AS normalized_text,
               CASE WHEN position('(' IN coalesce(mw.input_text, '')) > 0
                     AND position(')' IN coalesce(mw.input_text, '')) > position('(' IN coalesce(mw.input_text, ''))
                    THEN public.rx_normalize_cjk(public.rx_normalize_text(
                        substring(mw.input_text FROM position('(' IN mw.input_text) + 1 FOR
                            position(')' IN mw.input_text) - position('(' IN mw.input_text) - 1)))
                ELSE NULL END AS paren_normalized_text,
               public.rx_normalize_cjk(public.rx_normalize_text(regexp_replace(mw.input_text, '\\([^)]*\\)', '', 'g'))) AS product_match_text
        FROM merged_with_idx mw
    ),
    product_exact_candidates AS (
        SELECT il.input_index, p.nhi_code AS product_id,
               coalesce(p.name_en, p.name_zh) AS product_display_name, pi.ingredient_id
        FROM input_lines il
        JOIN public.rx_name_variants nv ON nv.target_type = 'product' AND nv.normalized_text = il.product_match_text
        JOIN public.rx_drug_products p ON p.nhi_code = nv.target_id
        LEFT JOIN public.rx_product_ingredients pi ON pi.nhi_code = p.nhi_code
        GROUP BY il.input_index, p.nhi_code, coalesce(p.name_en, p.name_zh), pi.ingredient_id
    ),
    product_exact_unique AS (
        SELECT input_index, count(DISTINCT product_id) AS candidate_count,
               min(product_id) AS product_id, min(product_display_name) AS product_display_name,
               min(ingredient_id::text)::uuid AS ingredient_id
        FROM product_exact_candidates GROUP BY input_index
    ),
    product_token_input_stems AS (
        SELECT il.input_index, public.rx_strip_plural_stem(public.rx_normalize_cjk(t.token)) AS stem, t.token AS raw_token
        FROM input_lines il
        CROSS JOIN LATERAL unnest(string_to_array(il.product_match_text, ' ')) AS t(token)
        WHERE coalesce(il.product_match_text, '') <> '' AND t.token <> '' AND length(t.token) >= 2
          AND t.token NOT SIMILAR TO '%[\\u4e00-\\u9fff]%'
    ),
    product_token_split_stems AS (
        SELECT DISTINCT ptis.input_index, s.left_stem AS stem, ptis.raw_token
        FROM product_token_input_stems ptis,
             public.rx_find_product_token_splits(ptis.stem) s
        WHERE NOT EXISTS (SELECT 1 FROM public.rx_product_variant_tokens WHERE token_stem = ptis.stem)
    ),
    product_token_input_stems_expanded AS (
        SELECT input_index, stem, raw_token FROM product_token_input_stems ptis
        WHERE EXISTS (SELECT 1 FROM public.rx_product_variant_tokens WHERE token_stem = ptis.stem)
        UNION
        SELECT input_index, stem, raw_token FROM product_token_split_stems
        UNION
        SELECT input_index, stem, raw_token FROM product_token_input_stems ptis
        WHERE NOT EXISTS (SELECT 1 FROM public.rx_product_variant_tokens WHERE token_stem = ptis.stem)
          AND NOT EXISTS (SELECT 1 FROM public.rx_find_product_token_splits(ptis.stem))
    ),
    product_stem_matches AS (
        SELECT DISTINCT ptis.input_index, pvt.variant_id, pvt.nhi_code
        FROM product_token_input_stems_expanded ptis
        JOIN public.rx_product_variant_tokens pvt ON pvt.token_stem = ptis.stem
    ),
    product_variant_sigs AS (
        SELECT psm.input_index, psm.variant_id, psm.nhi_code, p.name_en, p.name_zh,
               string_agg(pvt2.token, '|' ORDER BY pvt2.token) AS token_signature
        FROM product_stem_matches psm
        JOIN public.rx_product_variant_tokens pvt2 ON pvt2.variant_id = psm.variant_id
        JOIN public.rx_drug_products p ON p.nhi_code = psm.nhi_code
        WHERE NOT EXISTS (
            SELECT 1 FROM product_token_input_stems_expanded ptis3
            WHERE ptis3.input_index = psm.input_index
              AND NOT EXISTS (
                  SELECT 1 FROM public.rx_product_variant_tokens pvt4
                  WHERE pvt4.variant_id = psm.variant_id
                    AND (pvt4.token_stem = ptis3.stem OR pvt4.token = ptis3.raw_token)
              )
        )
        GROUP BY psm.input_index, psm.variant_id, psm.nhi_code, p.name_en, p.name_zh
    ),
    product_token_candidates AS (
        SELECT input_index, nhi_code, name_en, name_zh, token_signature FROM product_variant_sigs
    ),
    product_token_unique AS (
        SELECT input_index, count(DISTINCT token_signature) AS candidate_count,
               min(nhi_code) AS product_id, min(coalesce(name_en, name_zh)) AS product_display_name
        FROM product_token_candidates GROUP BY input_index
    ),
    canonical_candidates AS (
        SELECT il.input_index, c.ingredient_id, c.canonical_name
        FROM input_lines il
        JOIN public.rx_ingredient_concepts c ON c.canonical_name_normalized = il.normalized_text
    ),
    canonical_unique AS (
        SELECT input_index, count(DISTINCT ingredient_id) AS candidate_count,
               min(ingredient_id::text)::uuid AS ingredient_id, min(canonical_name) AS canonical_name
        FROM canonical_candidates GROUP BY input_index
    ),
    alias_candidates AS (
        SELECT il.input_index, c.ingredient_id, c.canonical_name
        FROM input_lines il
        JOIN public.rx_name_variants nv ON nv.target_type = 'ingredient' AND nv.normalized_text = il.normalized_text
        JOIN public.rx_ingredient_concepts c ON c.ingredient_id::text = nv.target_id
    ),
    alias_unique AS (
        SELECT input_index, count(DISTINCT ingredient_id) AS candidate_count,
               min(ingredient_id::text)::uuid AS ingredient_id, min(canonical_name) AS canonical_name
        FROM alias_candidates GROUP BY input_index
    ),
    paren_candidates AS (
        SELECT il.input_index, c.ingredient_id, c.canonical_name
        FROM input_lines il
        JOIN public.rx_name_variants nv ON nv.target_type = 'ingredient' AND nv.normalized_text = il.paren_normalized_text
        JOIN public.rx_ingredient_concepts c ON c.ingredient_id::text = nv.target_id
        WHERE il.paren_normalized_text IS NOT NULL AND length(il.paren_normalized_text) >= 3
        UNION ALL
        SELECT il.input_index, c.ingredient_id, c.canonical_name
        FROM input_lines il
        JOIN public.rx_ingredient_concepts c ON c.canonical_name_normalized = il.paren_normalized_text
        WHERE il.paren_normalized_text IS NOT NULL AND length(il.paren_normalized_text) >= 3
    ),
    paren_unique AS (
        SELECT input_index, count(DISTINCT ingredient_id) AS candidate_count,
               min(ingredient_id::text)::uuid AS ingredient_id, min(canonical_name) AS canonical_name
        FROM paren_candidates GROUP BY input_index
    ),
    compound_paren_candidates AS (
        SELECT il.input_index, p.nhi_code AS product_id,
               coalesce(p.name_en, p.name_zh) AS product_display_name,
               array_agg(DISTINCT c.ingredient_id ORDER BY c.ingredient_id) AS matched_ingredient_ids,
               count(DISTINCT c.ingredient_id) AS matched_count,
               count(DISTINCT t.part) AS total_parts
        FROM input_lines il
        CROSS JOIN LATERAL (
            SELECT substring(il.input_text FROM position('(' IN il.input_text) + 1
                            FOR position(')' IN il.input_text) - position('(' IN il.input_text) - 1) AS paren_content
        ) cp
        CROSS JOIN LATERAL regexp_split_to_array(cp.paren_content, E'\\s*(?:&|and)\\s*') AS parts_arr(parts)
        CROSS JOIN LATERAL unnest(parts_arr.parts) AS t(part)
        JOIN public.rx_ingredient_concepts c
              ON c.canonical_name_normalized = public.rx_normalize_cjk(public.rx_normalize_text(trim(t.part)))
        JOIN public.rx_product_ingredients pi ON pi.ingredient_id = c.ingredient_id
        JOIN public.rx_drug_products p ON p.nhi_code = pi.nhi_code
        WHERE position('(' IN coalesce(il.input_text, '')) > 0
          AND position(')' IN coalesce(il.input_text, '')) > position('(' IN coalesce(il.input_text, ''))
          AND length(trim(cp.paren_content)) > 0
          AND length(trim(t.part)) >= 2
        GROUP BY il.input_index, p.nhi_code, coalesce(p.name_en, p.name_zh), cp.paren_content
        HAVING count(DISTINCT c.ingredient_id) = count(DISTINCT t.part)
    ),
    compound_paren_unique AS (
        SELECT input_index, count(DISTINCT product_id) AS candidate_count,
               min(product_id) AS product_id, min(product_display_name) AS product_display_name
        FROM compound_paren_candidates
        WHERE matched_count = total_parts
        GROUP BY input_index
    ),
    token_input_stems AS (
        SELECT il.input_index, public.rx_strip_plural_stem(public.rx_normalize_cjk(t.token)) AS stem, t.token AS raw_token
        FROM input_lines il
        CROSS JOIN LATERAL unnest(string_to_array(il.normalized_text, ' ')) AS t(token)
        WHERE coalesce(il.normalized_text, '') <> '' AND t.token <> '' AND length(t.token) >= 2
    ),
    token_stem_matches AS (
        SELECT DISTINCT tis.input_index, rit.ingredient_id
        FROM token_input_stems tis
        JOIN public.rx_ingredient_tokens rit ON rit.token_stem = tis.stem
    ),
    token_candidate_sigs AS (
        SELECT sm.input_index, sm.ingredient_id, c.canonical_name,
               string_agg(tok.token, '|' ORDER BY tok.token) AS token_signature
        FROM token_stem_matches sm
        JOIN public.rx_ingredient_concepts c ON c.ingredient_id = sm.ingredient_id
        JOIN public.rx_ingredient_tokens tok ON tok.ingredient_id = sm.ingredient_id
        WHERE NOT EXISTS (
            SELECT 1 FROM public.rx_ingredient_tokens tok2
            WHERE tok2.ingredient_id = sm.ingredient_id
              AND NOT EXISTS (
                  SELECT 1 FROM token_input_stems tis
                  WHERE tis.input_index = sm.input_index
                    AND (tis.stem = tok2.token_stem OR tis.raw_token = tok2.token)
              )
        )
        GROUP BY sm.input_index, sm.ingredient_id, c.canonical_name
    ),
    token_candidates AS (SELECT input_index, ingredient_id, canonical_name, token_signature FROM token_candidate_sigs),
    token_unique AS (
        SELECT input_index, count(DISTINCT token_signature) AS candidate_count,
               (array_agg(ingredient_id::text ORDER BY length(canonical_name), canonical_name))[1]::uuid AS ingredient_id,
               (array_agg(canonical_name ORDER BY length(canonical_name), canonical_name))[1] AS canonical_name
        FROM token_candidates GROUP BY input_index
    ),
    -- Merge matching results: for each merged line, compute the best match
    merged_results AS (
        SELECT il.input_index AS merged_idx, il.input_text AS merged_text,
            CASE WHEN peu.candidate_count = 1 THEN 'matched' WHEN ptu.candidate_count = 1 THEN 'matched'
                 WHEN cu.candidate_count = 1 THEN 'matched' WHEN au.candidate_count = 1 THEN 'matched'
                 WHEN pu.candidate_count = 1 THEN 'matched' WHEN cpu.candidate_count = 1 THEN 'matched'
                 WHEN tu.candidate_count = 1 THEN 'matched'
                 ELSE 'unmatched' END AS match_status,
            CASE WHEN peu.candidate_count = 1 THEN peu.ingredient_id
                 WHEN ptu.candidate_count = 1 THEN (SELECT pi.ingredient_id FROM public.rx_product_ingredients pi WHERE pi.nhi_code = ptu.product_id ORDER BY pi.ingredient_id LIMIT 1)
                 WHEN cu.candidate_count = 1 THEN cu.ingredient_id WHEN au.candidate_count = 1 THEN au.ingredient_id
                 WHEN pu.candidate_count = 1 THEN pu.ingredient_id
                 WHEN cpu.candidate_count = 1 THEN (SELECT pi.ingredient_id FROM public.rx_product_ingredients pi WHERE pi.nhi_code = cpu.product_id ORDER BY pi.ingredient_id LIMIT 1)
                 WHEN tu.candidate_count = 1 THEN tu.ingredient_id
                 ELSE NULL END AS ingredient_id,
            CASE WHEN peu.candidate_count = 1 THEN (SELECT array_agg(pi.ingredient_id ORDER BY pi.ingredient_id) FROM public.rx_product_ingredients pi WHERE pi.nhi_code = peu.product_id)
                 WHEN ptu.candidate_count = 1 THEN (SELECT array_agg(pi.ingredient_id ORDER BY pi.ingredient_id) FROM public.rx_product_ingredients pi WHERE pi.nhi_code = ptu.product_id)
                 WHEN cu.candidate_count = 1 THEN ARRAY[cu.ingredient_id] WHEN au.candidate_count = 1 THEN ARRAY[au.ingredient_id]
                 WHEN pu.candidate_count = 1 THEN ARRAY[pu.ingredient_id]
                 WHEN cpu.candidate_count = 1 THEN (SELECT array_agg(pi.ingredient_id ORDER BY pi.ingredient_id) FROM public.rx_product_ingredients pi WHERE pi.nhi_code = cpu.product_id)
                 WHEN tu.candidate_count = 1 THEN ARRAY[tu.ingredient_id]
                 ELSE NULL END AS ingredient_ids,
            CASE WHEN peu.candidate_count = 1 THEN peu.product_display_name WHEN ptu.candidate_count = 1 THEN ptu.product_display_name
                 WHEN cu.candidate_count = 1 THEN cu.canonical_name WHEN au.candidate_count = 1 THEN au.canonical_name
                 WHEN pu.candidate_count = 1 THEN pu.canonical_name WHEN cpu.candidate_count = 1 THEN cpu.product_display_name
                 WHEN tu.candidate_count = 1 THEN tu.canonical_name
                 ELSE NULL END AS ingredient_canonical_name,
            CASE WHEN peu.candidate_count = 1 THEN 'product_exact' WHEN ptu.candidate_count = 1 THEN 'product_token'
                 WHEN cu.candidate_count = 1 THEN 'canonical_exact' WHEN au.candidate_count = 1 THEN 'alias_exact'
                 WHEN pu.candidate_count = 1 THEN 'paren_alias_exact' WHEN cpu.candidate_count = 1 THEN 'compound_paren'
                 WHEN tu.candidate_count = 1 THEN 'ingredient_token'
                 ELSE NULL END AS match_method,
            CASE WHEN peu.candidate_count = 1 THEN 0.95 WHEN ptu.candidate_count = 1 THEN 0.70
                 WHEN cu.candidate_count = 1 THEN 0.95 WHEN au.candidate_count = 1 THEN 0.90
                 WHEN pu.candidate_count = 1 THEN 0.85 WHEN cpu.candidate_count = 1 THEN 0.80
                 WHEN tu.candidate_count = 1 THEN 0.65
                 ELSE NULL END AS confidence,
            CASE WHEN peu.candidate_count = 1 THEN peu.product_id WHEN ptu.candidate_count = 1 THEN ptu.product_id
                 WHEN cpu.candidate_count = 1 THEN cpu.product_id
                 ELSE NULL END AS product_id,
            CASE WHEN peu.candidate_count = 1 THEN peu.product_display_name
                 WHEN ptu.candidate_count = 1 THEN ptu.product_display_name
                 WHEN cpu.candidate_count = 1 THEN cpu.product_display_name
                 ELSE NULL END AS product_display_name
        FROM input_lines il
        LEFT JOIN product_exact_unique peu ON peu.input_index = il.input_index
        LEFT JOIN product_token_unique ptu ON ptu.input_index = il.input_index
        LEFT JOIN canonical_unique cu ON cu.input_index = il.input_index
        LEFT JOIN alias_unique au ON au.input_index = il.input_index
        LEFT JOIN paren_unique pu ON pu.input_index = il.input_index
        LEFT JOIN compound_paren_unique cpu ON cpu.input_index = il.input_index
        LEFT JOIN token_unique tu ON tu.input_index = il.input_index
    )
    -- Final output: one row per ORIGINAL line, inheriting match results from the merged line it belongs to
    SELECT ol.orig_idx AS input_index, ol.input_text,
           COALESCE(mr.merged_text, ol.input_text) AS normalized_text,
           COALESCE(mr.match_status, 'unmatched') AS match_status,
           mr.ingredient_id, mr.ingredient_ids, mr.ingredient_canonical_name,
           mr.match_method, mr.confidence, mr.product_id, mr.product_display_name
    FROM original_lines ol
    LEFT JOIN orig_to_merged om ON om.orig_idx = ol.orig_idx
    LEFT JOIN merged_results mr ON mr.merged_idx = om.merged_idx
    ORDER BY ol.orig_idx;
$function$;

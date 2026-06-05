-- Forward-merge OCR split lines: lines ending with &, +, or unclosed (
-- merge with the next line. Handles cascading (e.g., line ends with (
-- merges with next line which ends with & which merges with next line).
CREATE OR REPLACE FUNCTION public.rx_merge_medication_lines(raw_lines text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    result   text[] := '{}';
    i        int    := 1;
    acc      text   := '';
    n        int;
    cur      text;
    trimmed  text;
    acc_trim text;
    p_open   int;
    p_close  int;
    has_cont boolean;
BEGIN
    IF raw_lines IS NULL THEN
        RETURN '{}';
    END IF;

    n := array_length(raw_lines, 1);
    IF n IS NULL OR n = 0 THEN
        RETURN '{}';
    END IF;

    WHILE i <= n LOOP
        cur     := raw_lines[i];
        trimmed := trim(cur);

        -- Skip empty lines (noise from OCR)
        IF trimmed = '' THEN
            i := i + 1;
            CONTINUE;
        END IF;

        -- Append to accumulator
        IF acc = '' THEN
            acc := trimmed;
        ELSE
            acc := acc || ' ' || trimmed;
        END IF;

        -- Check if the accumulated text has a continuation marker
        acc_trim := trim(acc);

        -- Ends with & or +
        IF right(acc_trim, 1) IN ('&', '+') THEN
            has_cont := TRUE;
        ELSE
            -- Unclosed parentheses: count opens vs closes
            p_open  := length(acc_trim) - length(replace(acc_trim, '(', ''));
            p_close := length(acc_trim) - length(replace(acc_trim, ')', ''));
            has_cont := p_open > p_close;
        END IF;

        IF has_cont AND i < n THEN
            -- More lines remain; continue accumulating (cascading merge)
            i := i + 1;
        ELSE
            -- Flush accumulated text as one merged line
            result := array_append(result, acc);
            acc    := '';
            i      := i + 1;
        END IF;
    END LOOP;

    -- Flush any leftover accumulator (line ended with continuation but no next line)
    IF acc != '' THEN
        result := array_append(result, acc);
    END IF;

    RETURN result;
END;
$$;

-- Grant to authenticated (same as rx_match_medication_lines)
GRANT EXECUTE ON FUNCTION public.rx_merge_medication_lines(text[]) TO authenticated;


-- ============================================================================
-- TESTS
-- Run with: SELECT * FROM public.rx_test_merge_medication_lines();
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rx_test_merge_medication_lines()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    got    text[];
    expect text[];
    ok     boolean := TRUE;
BEGIN
    -- 1: Basic & merge
    got    := public.rx_merge_medication_lines(ARRAY['Aspirin &', 'Metformin']);
    expect := ARRAY['Aspirin & Metformin'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 1: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 2: Basic + merge
    got    := public.rx_merge_medication_lines(ARRAY['Aspirin +', 'Metformin']);
    expect := ARRAY['Aspirin + Metformin'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 2: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 3: Unclosed ( merge
    got    := public.rx_merge_medication_lines(ARRAY['Spiriva Respimat 2puff (tiotropium', '30mcg)']);
    expect := ARRAY['Spiriva Respimat 2puff (tiotropium 30mcg)'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 3: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 4: Cascading merge: ( then & then normal
    got    := public.rx_merge_medication_lines(ARRAY['Linagliptin (', 'Metformin 850mg &', 'something']);
    expect := ARRAY['Linagliptin ( Metformin 850mg & something'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 4: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 5: No merge needed
    got    := public.rx_merge_medication_lines(ARRAY['Aspirin', 'Metformin']);
    expect := ARRAY['Aspirin', 'Metformin'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 5: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 6: Empty input
    got    := public.rx_merge_medication_lines(ARRAY[]::text[]);
    expect := ARRAY[]::text[];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 6: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 7: NULL input
    got    := public.rx_merge_medication_lines(NULL);
    expect := ARRAY[]::text[];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 7: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 8: Single line, no continuation
    got    := public.rx_merge_medication_lines(ARRAY['Aspirin 100mg']);
    expect := ARRAY['Aspirin 100mg'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 8: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 9: Last line ends with & (no next line to merge with) — flush as-is
    got    := public.rx_merge_medication_lines(ARRAY['Aspirin &']);
    expect := ARRAY['Aspirin &'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 9: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 10: Mixed — some merge, some don't
    got    := public.rx_merge_medication_lines(ARRAY['Aspirin &', 'Paracetamol', 'Ibuprofen']);
    expect := ARRAY['Aspirin & Paracetamol', 'Ibuprofen'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 10: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    -- 11: Empty lines in between (noise) are skipped
    got    := public.rx_merge_medication_lines(ARRAY['Aspirin &', '', 'Metformin']);
    expect := ARRAY['Aspirin & Metformin'];
    IF got IS DISTINCT FROM expect THEN
        RAISE NOTICE 'FAIL 11: got %, expected %', got, expect;
        ok := FALSE;
    END IF;

    IF ok THEN
        RAISE NOTICE 'ALL rx_test_merge_medication_lines PASSED';
    END IF;
END;
$$;

SELECT public.rx_test_merge_medication_lines();

-- v35: Add product token containment scoring + reorganize pass priority
--
-- CHANGES from v32:
-- 1. ADDED: rx_product_token_counts table (pre-computed product token counts)
-- 2. ADDED: product_token_contain pass (LAST resort, after all ingredient passes)
--    Uses rx_product_variant_tokens with forward coverage scoring:
--    >= 60% of INPUT tokens must be found in the product.
--    Picks best candidate by matched_tokens (no ambiguity guard).
-- 3. REORDERED: product_exact → ocr_product → canonical → alias → paren →
--    ingredient_token → product_token_contain (last resort)
--
-- WHY LAST RESORT: If input matches an ingredient name (e.g., OMEPRAZOLE),
-- it should match as an ingredient, not as a product brand. The token
-- containment pass is only for brand names that don't match any ingredient.
--
-- PERFORMANCE: ~2-3s per call (token containment uses indexed lookups)

-- Pre-computed product token counts
CREATE TABLE IF NOT EXISTS public.rx_product_token_counts (
  nhi_code text PRIMARY KEY,
  token_count int NOT NULL
);

INSERT INTO public.rx_product_token_counts
SELECT nhi_code, count(distinct token_stem)
FROM public.rx_product_variant_tokens
GROUP BY nhi_code
ON CONFLICT (nhi_code) DO UPDATE SET token_count = EXCLUDED.token_count;

CREATE INDEX IF NOT EXISTS idx_product_token_counts_nhi ON public.rx_product_token_counts(nhi_code);

-- The function is deployed via MCP (rename + create pattern to bust PgBouncer cache).
-- See mcp_supabase_apply_migration calls for the actual SQL.
-- This file tracks the migration for git history.

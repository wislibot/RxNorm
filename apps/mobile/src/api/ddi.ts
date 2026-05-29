import { getSupabaseClient, type AppSupabaseClient } from '../lib/supabase';
import type { CaseDdiResult, CaseDdiRpcRow, CheckedIngredient } from '../types/ddi';

const COVERAGE_DISCLAIMER_EN =
  'DDI screening coverage is limited to medicines in the Taiwan curated dictionary. If some medicines could not be checked, confirm with a clinician/pharmacist.';

function buildEmptyDdiResult(): CaseDdiResult {
  return {
    checked_ingredient_count: 0,
    unchecked_ingredient_count: 0,
    checked_ingredients: [],
    coverage_disclaimer_en: COVERAGE_DISCLAIMER_EN,
    interactions: [],
    interactions_found_count: 0,
    unchecked_items: [],
  };
}

export async function getCaseDdiByIngredients(
  ingredientIds: string[],
  client: AppSupabaseClient = getSupabaseClient(),
): Promise<CaseDdiResult> {
  const uniqueIngredientIds = Array.from(new Set(ingredientIds.filter(Boolean)));
  if (!uniqueIngredientIds.length) {
    return buildEmptyDdiResult();
  }

  const { data: ingredientRows, error: ingredientError } = await client
    .from('rx_ingredient_concepts')
    .select('ingredient_id, canonical_name')
    .in('ingredient_id', uniqueIngredientIds);

  if (ingredientError) {
    throw ingredientError;
  }

  const checkedIngredients = (ingredientRows ?? []) as CheckedIngredient[];
  const checkedIds = new Set(checkedIngredients.map((item) => item.ingredient_id));
  const validIngredientIds = uniqueIngredientIds.filter((id) => checkedIds.has(id));
  const uncheckedIds = uniqueIngredientIds.filter((id) => !checkedIds.has(id));

  const { data: rpcRows, error: rpcError } = await client.rpc('rx_get_ddi_for_ingredients', {
    ingredient_ids: validIngredientIds,
  });

  if (rpcError) {
    throw rpcError;
  }

  const interactions = ((rpcRows ?? []) as CaseDdiRpcRow[]).map((row) => ({
    ...row,
    disclaimer_en: row.disclaimer_en || COVERAGE_DISCLAIMER_EN,
  }));

  return {
    checked_ingredient_count: checkedIngredients.length,
    unchecked_ingredient_count: uncheckedIds.length,
    checked_ingredients: checkedIngredients,
    coverage_disclaimer_en: COVERAGE_DISCLAIMER_EN,
    interactions,
    interactions_found_count: interactions.length,
    unchecked_items: uncheckedIds.map((ingredientId) => ({
      raw_text: ingredientId,
      reason: 'missing_ingredient_concept',
    })),
  };
}

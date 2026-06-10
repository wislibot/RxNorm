import { getSupabaseClient } from '../lib/supabase';

export type DrugSearchResult = {
  nhi_code: string;
  name_en: string | null;
  name_zh: string | null;
  ingredient_text: string | null;
  atc_code: string | null;
  dose_form: string | null;
  strength_value: number | null;
  strength_unit: string | null;
  relevance: number;
};

export type SavedMed = {
  id: string;
  nhi_code: string;
  name_en: string | null;
  name_zh: string | null;
  ingredient_text: string | null;
  atc_code: string | null;
  dose_form: string | null;
  strength_value: number | null;
  strength_unit: string | null;
  saved_at: string;
};

export async function searchDrugs(query: string): Promise<DrugSearchResult[]> {
  if (!query.trim()) return [];
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('search_drugs', {
    search_query: query.trim(),
    max_results: 20,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getSavedMeds(): Promise<SavedMed[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('saved_meds')
    .select('*')
    .order('saved_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveMed(drug: DrugSearchResult): Promise<void> {
  const client = getSupabaseClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await client.from('saved_meds').insert({
    user_id: user.id,
    nhi_code: drug.nhi_code,
    name_en: drug.name_en,
    name_zh: drug.name_zh,
    ingredient_text: drug.ingredient_text,
    atc_code: drug.atc_code,
    dose_form: drug.dose_form,
    strength_value: drug.strength_value,
    strength_unit: drug.strength_unit,
  });
  if (error) throw error;
}

export async function removeMed(id: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('saved_meds').delete().eq('id', id);
  if (error) throw error;
}

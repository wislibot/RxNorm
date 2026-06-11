import { getSupabaseClient } from '../lib/supabase';

export interface ConceptGroup {
  ingredient: string;
  atc_code: string | null;
  atc_name: string | null;
  brand_count: number;
  brand_names: string[];
  sample_nhi_codes: string[];
}

export interface ATCLevel {
  atc_code: string;
  atc_name: string;
  drug_count: number;
}

export async function searchDrugsGrouped(query: string, maxResults = 50): Promise<ConceptGroup[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('search_drugs_grouped', {
    p_query: query,
    p_max_results: maxResults,
  });
  if (error) throw error;
  return data ?? [];
}

export async function browseATCLevel(prefix: string = ''): Promise<ATCLevel[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('browse_atc_level', { p_prefix: prefix });
  if (error) throw error;
  return data ?? [];
}

export async function browseATCDrugs(atcPrefix: string, maxResults = 100): Promise<ConceptGroup[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('browse_atc_drugs', {
    p_atc_prefix: atcPrefix,
    p_max_results: maxResults,
  });
  if (error) throw error;
  return data ?? [];
}

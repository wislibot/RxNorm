import { getSupabaseClient } from '../lib/supabase';

export type Hospital = {
  id: string;
  name_en: string;
  name_zh: string;
  address: string | null;
  phone: string | null;
};

export type HospitalSearchResult = Hospital & {
  relevance: number;
};

export async function searchHospitals(query: string): Promise<HospitalSearchResult[]> {
  if (!query.trim()) return [];
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('search_hospitals', {
    search_query: query.trim(),
    max_results: 20,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getMyHospitals(): Promise<Hospital[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('rx_patient_hospitals')
    .select('hospital_id, rx_hospitals(id, name_en, name_zh, address, phone)')
    .order('added_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => row.rx_hospitals).filter(Boolean);
}

export async function addHospital(hospitalId: string): Promise<void> {
  const client = getSupabaseClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await client.from('rx_patient_hospitals').insert({
    user_id: user.id,
    hospital_id: hospitalId,
  });
  if (error) throw error;
}

export async function removeHospital(hospitalId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('rx_patient_hospitals')
    .delete()
    .eq('hospital_id', hospitalId);
  if (error) throw error;
}

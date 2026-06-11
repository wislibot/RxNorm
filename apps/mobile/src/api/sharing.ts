import { getSupabaseClient } from '../lib/supabase';

export async function getSharedRecordIds(
  hospitalId: string,
  recordType: 'case' | 'druglist',
): Promise<Set<string>> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_shared_record_ids', {
    p_hospital_id: hospitalId,
    p_record_type: recordType,
  });
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.record_id));
}

export async function getSharedHospitalIds(
  recordType: 'case' | 'druglist',
  recordId: string,
): Promise<Set<string>> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('rx_shared_records')
    .select('hospital_id')
    .eq('record_type', recordType)
    .eq('record_id', recordId);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.hospital_id));
}

export async function shareRecord(
  hospitalId: string,
  recordType: 'case' | 'druglist',
  recordId: string,
): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.rpc('share_record', {
    p_hospital_id: hospitalId,
    p_record_type: recordType,
    p_record_id: recordId,
  });
  if (error) throw error;
}

export async function unshareRecord(
  hospitalId: string,
  recordType: 'case' | 'druglist',
  recordId: string,
): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.rpc('unshare_record', {
    p_hospital_id: hospitalId,
    p_record_type: recordType,
    p_record_id: recordId,
  });
  if (error) throw error;
}

export async function getMyCaseSummaries(): Promise<{ case_id: string; created_at: string; ocr_sections: any; case_name: string | null }[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('rx_cases')
    .select('case_id, created_at, ocr_sections, case_name')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getMyPlaylists(): Promise<{ id: string; name: string; item_count: number }[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_user_playlists');
  if (error) throw error;
  return data ?? [];
}

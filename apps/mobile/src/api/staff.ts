import { getSupabaseClient } from '../lib/supabase';

export interface StaffHospital {
  hospital_id: string;
  name_zh: string;
  name_en: string;
  role: string;
}

export interface SharedCase {
  case_id: string;
  case_name: string | null;
  created_at: string;
  patient_email: string;
  medication_count: number;
  medication_names: string[];
  hospital_name?: string;
}

export interface SharedDruglist {
  playlist_id: string;
  playlist_name: string;
  created_at: string;
  patient_email: string;
  drug_count: number;
  drug_names: string[];
  hospital_name?: string;
}

export interface SharedCaseDetail {
  case_id: string;
  case_name: string | null;
  created_at: string;
  patient_email: string;
  detected_items: any[];
  case_type: string;
  photo_paths: string[];
}

export interface SharedDruglistDetail {
  playlist_id: string;
  playlist_name: string;
  created_at: string;
  patient_email: string;
  items: {
    item_id: string;
    item_name_en: string | null;
    item_name_zh: string | null;
    item_nhi_code: string | null;
    item_ingredient_text: string | null;
    item_atc_code: string | null;
    item_strength_value: number | null;
    item_strength_unit: string | null;
    item_position: number;
  }[];
}

export async function isStaff(): Promise<boolean> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('is_staff');
  if (error) {
    console.error('isStaff error:', error);
    return false;
  }
  return data === true;
}

export async function getStaffHospitals(): Promise<StaffHospital[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_staff_hospitals');
  if (error) throw error;
  return data ?? [];
}

export async function getAllStaffSharedCases(): Promise<SharedCase[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_all_staff_shared_cases');
  if (error) throw error;
  return data ?? [];
}

export async function getAllStaffSharedDruglists(): Promise<SharedDruglist[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_all_staff_shared_druglists');
  if (error) throw error;
  return data ?? [];
}

export async function getSharedCaseDetail(caseId: string): Promise<SharedCaseDetail | null> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_hospital_shared_case_detail', { p_case_id: caseId });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  const row = data[0];
  return {
    case_id: row.case_id,
    case_name: row.case_name,
    created_at: row.created_at,
    patient_email: row.patient_email,
    detected_items: row.detected_items ?? [],
    case_type: row.case_type,
    photo_paths: row.photo_paths ?? [],
  };
}

export async function getSharedDruglistDetail(playlistId: string): Promise<SharedDruglistDetail | null> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_hospital_shared_druglist_detail', { p_playlist_id: playlistId });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  const first = data[0];
  return {
    playlist_id: first.playlist_id,
    playlist_name: first.playlist_name,
    created_at: first.created_at,
    patient_email: first.patient_email,
    items: data.map((row: any) => ({
      item_id: row.item_id,
      item_name_en: row.item_name_en,
      item_name_zh: row.item_name_zh,
      item_nhi_code: row.item_nhi_code,
      item_ingredient_text: row.item_ingredient_text,
      item_atc_code: row.item_atc_code,
      item_strength_value: row.item_strength_value,
      item_strength_unit: row.item_strength_unit,
      item_position: row.item_position,
    })),
  };
}

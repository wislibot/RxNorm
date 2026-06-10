import { getSupabaseClient } from '../lib/supabase';
import type { DrugSearchResult } from './drugs';

export type Playlist = {
  id: string;
  name: string;
  created_at: string;
  item_count: number;
};

export type PlaylistItem = {
  id: string;
  nhi_code: string;
  name_en: string | null;
  name_zh: string | null;
  ingredient_text: string | null;
  atc_code: string | null;
  dose_form: string | null;
  strength_value: number | null;
  strength_unit: string | null;
  position: number;
  added_at: string;
};

export async function getPlaylists(): Promise<Playlist[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_user_playlists');
  if (error) throw error;
  return data ?? [];
}

export async function getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_playlist_items', {
    playlist_id: playlistId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const client = getSupabaseClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await client
    .from('rx_playlists')
    .insert({ user_id: user.id, name })
    .select('id, name, created_at')
    .single();
  if (error) throw error;
  return { ...data, item_count: 0 };
}

export async function addToPlaylist(
  playlistId: string,
  drug: DrugSearchResult,
): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.rpc('add_to_playlist', {
    playlist_id: playlistId,
    p_nhi_code: drug.nhi_code,
    p_name_en: drug.name_en,
    p_name_zh: drug.name_zh,
    p_ingredient_text: drug.ingredient_text,
    p_atc_code: drug.atc_code,
    p_dose_form: drug.dose_form,
    p_strength_value: drug.strength_value,
    p_strength_unit: drug.strength_unit,
  });
  if (error) throw error;
}

export async function removeFromPlaylist(itemId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('rx_playlist_items')
    .delete()
    .eq('id', itemId);
  if (error) throw error;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('rx_playlists')
    .delete()
    .eq('id', playlistId);
  if (error) throw error;
}

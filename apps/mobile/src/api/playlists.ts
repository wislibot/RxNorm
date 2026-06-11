import { getSupabaseClient, type AppSupabaseClient } from '../lib/supabase';
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

function stripDosage(name: string): string {
  return name.replace(/\s+\d+(\.\d+)?\s*(MG|GM|MCG|ML|IU|MEQ|MMOL|UNIT|UNITS|%)\s*$/i, '');
}

export async function getPlaylistIngredientIds(
  playlistId: string,
  client: AppSupabaseClient = getSupabaseClient(),
): Promise<string[]> {
  const { data: items, error: itemsError } = await client
    .rpc('get_playlist_items', { p_playlist_id: playlistId });
  if (itemsError) throw itemsError;

  if (!items?.length) return [];

  const seenIngredientIds = new Set<string>();

  // 1a. Resolve by NHI code
  const nhiCodes = items
    .map((item: any) => item.nhi_code)
    .filter(Boolean) as string[];

  const matchedNhiCodes = new Set<string>();

  if (nhiCodes.length > 0) {
    const { data: piRows, error: piError } = await client
      .from('rx_product_ingredients')
      .select('nhi_code, ingredient_id')
      .in('nhi_code', nhiCodes);
    if (piError) throw piError;

    if (piRows?.length) {
      for (const row of piRows) {
        if (row.ingredient_id) {
          seenIngredientIds.add(row.ingredient_id);
          matchedNhiCodes.add(row.nhi_code);
        }
      }
    }
  }

  // 1b. Name fallback for items not resolved by NHI
  const unresolvedItems = items.filter(
    (item: any) =>
      item.name_en &&
      (!item.nhi_code || !matchedNhiCodes.has(item.nhi_code)),
  );

  for (const item of unresolvedItems) {
    const cleanedName = (item.name_en ?? '').replace(/^["']|["']$/g, '');
    if (!cleanedName) continue;

    const { data: nameRows, error: nameError } = await client
      .from('rx_ingredient_concepts')
      .select('ingredient_id')
      .ilike('canonical_name', `${cleanedName}%`);
    if (nameError) throw nameError;

    if (nameRows?.length) {
      for (const row of nameRows) {
        if (row.ingredient_id) {
          seenIngredientIds.add(row.ingredient_id);
        }
      }
    }
  }

  if (seenIngredientIds.size === 0) return [];

  // 2. Map dosage-specific ingredients to base (no-dosage) ingredients
  const ids = Array.from(seenIngredientIds);
  const { data: concepts, error: conceptsError } = await client
    .from('rx_ingredient_concepts')
    .select('ingredient_id, canonical_name')
    .in('ingredient_id', ids);
  if (conceptsError) throw conceptsError;
  if (!concepts?.length) return [];

  const baseIds = new Set<string>();
  const strippedToOriginal = new Map<string, string>();

  for (const c of concepts) {
    const stripped = stripDosage(c.canonical_name);
    if (stripped !== c.canonical_name) {
      strippedToOriginal.set(stripped, c.ingredient_id);
    } else {
      baseIds.add(c.ingredient_id);
    }
  }

  if (strippedToOriginal.size > 0) {
    const strippedNames = Array.from(strippedToOriginal.keys());
    const { data: baseRows, error: baseError } = await client
      .from('rx_ingredient_concepts')
      .select('ingredient_id, canonical_name')
      .in('canonical_name', strippedNames);
    if (baseError) throw baseError;

    const foundNames = new Set((baseRows ?? []).map(r => r.canonical_name));
    for (const row of baseRows ?? []) {
      if (row.ingredient_id) {
        baseIds.add(row.ingredient_id);
      }
    }

    for (const [strippedName, originalId] of strippedToOriginal) {
      if (!foundNames.has(strippedName)) {
        baseIds.add(originalId);
      }
    }
  }

  return Array.from(baseIds);
}

export async function getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_playlist_items', {
    p_playlist_id: playlistId,
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
    p_playlist_id: playlistId,
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

export type DuplicateMatch = {
  id: string;
  nhi_code: string;
  name_en: string | null;
  name_zh: string | null;
  matching_ingredient: string;
};

export async function checkPlaylistDuplicates(
  playlistId: string,
  nhiCode: string,
): Promise<DuplicateMatch[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('check_playlist_duplicate_ingredients', {
    p_playlist_id: playlistId,
    p_nhi_code: nhiCode,
  });
  if (error) throw error;
  return data ?? [];
}

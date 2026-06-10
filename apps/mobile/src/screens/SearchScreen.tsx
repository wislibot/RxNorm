import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { searchDrugs, saveMed, getSavedMeds, type DrugSearchResult } from '../api/drugs';
import { addToPlaylist } from '../api/playlists';
import { SaveToPlaylistModal } from '../playlists/SaveToPlaylistModal';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { SearchStackParamList } from '../search/navigationTypes';

function useDebounce(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debouncedValue;
}

function DrugCard({
  drug,
  isSaved,
  onSave,
  onRemove,
  onPress,
  saving,
  onSaveToPlaylist,
}: {
  drug: DrugSearchResult;
  isSaved: boolean;
  onSave: (drug: DrugSearchResult) => void;
  onRemove: (id: string) => void;
  onPress: (nhiCode: string) => void;
  saving: boolean;
  onSaveToPlaylist: (drug: DrugSearchResult) => void;
}) {
  const { t } = useTranslation();

  const ingredientPart = drug.ingredient_text
    ? `${t('savedMedsIngredient', { text: drug.ingredient_text })}`
    : null;

  const formPart = drug.dose_form
    ? `${t('savedMedsForm', { form: drug.dose_form })}`
    : null;

  const strengthPart =
    drug.strength_value != null && drug.strength_unit
      ? `${t('savedMedsStrength', { value: drug.strength_value, unit: drug.strength_unit })}`
      : null;

  return (
    <Pressable
      onPress={() => onPress(drug.nhi_code)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardNames}>
            {drug.name_zh ? (
              <Text style={styles.cardNameZh}>{drug.name_zh}</Text>
            ) : null}
            {drug.name_en ? (
              <Text style={styles.cardNameEn}>{drug.name_en}</Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => {
              if (isSaved) {
                onRemove(drug.nhi_code);
              } else {
                onSaveToPlaylist(drug);
              }
            }}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveButton,
              isSaved && styles.saveButtonSaved,
              pressed && styles.saveButtonPressed,
            ]}
          >
            <Ionicons
              color={isSaved ? colors.card : colors.primary}
              name={isSaved ? 'bookmark' : 'bookmark-outline'}
              size={20}
            />
            <Text
              style={[styles.saveButtonText, isSaved && styles.saveButtonTextSaved]}
            >
              {isSaved ? t('searchSaved') : t('searchSaveMed')}
            </Text>
          </Pressable>
        </View>

        <View style={styles.cardDetails}>
          <Text style={styles.cardLabel}>{t('savedMedsNhiCode', { code: drug.nhi_code })}</Text>
          {ingredientPart ? <Text style={styles.cardLabel}>{ingredientPart}</Text> : null}
          <View style={styles.cardMeta}>
            {formPart ? <Text style={styles.cardMetaText}>{formPart}</Text> : null}
            {strengthPart ? <Text style={styles.cardMetaText}>{strengthPart}</Text> : null}
            {drug.atc_code ? (
              <Text style={styles.cardMetaText}>
                {t('savedMedsAtc', { code: drug.atc_code })}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

type Props = {
  navigation: NativeStackNavigationProp<SearchStackParamList, 'SearchHome'>;
};

export function SearchScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState<DrugSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());
  const [savingNhiCodes, setSavingNhiCodes] = useState<Set<string>>(new Set());
  const savedSetRef = useRef<Set<string>>(new Set());
  const [initialLoading, setInitialLoading] = useState(true);
  const [playlistModalDrug, setPlaylistModalDrug] = useState<DrugSearchResult | null>(null);

  useEffect(() => {
    getSavedMeds()
      .then((meds) => {
        const codes = new Set(meds.map((m) => m.nhi_code));
        savedSetRef.current = codes;
        setSavedSet(codes);
      })
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, []);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    searchDrugs(debouncedQuery)
      .then((data) => {
        if (!cancelled) {
          setResults(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('searchError'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, t]);

  const handleSave = useCallback(async (drug: DrugSearchResult) => {
    setSavingNhiCodes((prev) => new Set(prev).add(drug.nhi_code));
    try {
      await saveMed(drug);
      const next = new Set(savedSetRef.current);
      next.add(drug.nhi_code);
      savedSetRef.current = next;
      setSavedSet(next);
    } catch {
      // silently fail
    } finally {
      setSavingNhiCodes((prev) => {
        const next = new Set(prev);
        next.delete(drug.nhi_code);
        return next;
      });
    }
  }, []);

  const handleRemove = useCallback(async (nhiCode: string) => {
    setSavingNhiCodes((prev) => new Set(prev).add(nhiCode));
    try {
      const codes = new Set(savedSetRef.current);
      codes.delete(nhiCode);
      savedSetRef.current = codes;
      setSavedSet(codes);
    } finally {
      setSavingNhiCodes((prev) => {
        const next = new Set(prev);
        next.delete(nhiCode);
        return next;
      });
    }
  }, []);

  const handlePress = useCallback(
    (nhiCode: string) => {
      navigation.navigate('DrugDetail', { nhiCode });
    },
    [navigation],
  );

  const handleSaveToPlaylist = useCallback((drug: DrugSearchResult) => {
    setPlaylistModalDrug(drug);
  }, []);

  const handlePlaylistSaved = useCallback(() => {
    if (playlistModalDrug) {
      const next = new Set(savedSetRef.current);
      next.add(playlistModalDrug.nhi_code);
      savedSetRef.current = next;
      setSavedSet(next);
    }
    setPlaylistModalDrug(null);
  }, [playlistModalDrug]);

  const renderItem = useCallback(
    ({ item }: { item: DrugSearchResult }) => (
      <DrugCard
        drug={item}
        isSaved={savedSet.has(item.nhi_code)}
        onSave={handleSave}
        onRemove={handleRemove}
        onPress={handlePress}
        saving={savingNhiCodes.has(item.nhi_code)}
        onSaveToPlaylist={handleSaveToPlaylist}
      />
    ),
    [savedSet, handleSave, handleRemove, handlePress, savingNhiCodes, handleSaveToPlaylist],
  );

  const keyExtractor = useCallback((item: DrugSearchResult) => item.nhi_code, []);

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t('searchTitle')}</Text>

      <View style={styles.searchBar}>
        <Ionicons color={colors.textMuted} name="search" size={20} style={styles.searchIcon} />
        <TextInput
          onChangeText={setQuery}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          value={query}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} style={styles.clearButton}>
            <Ionicons color={colors.textMuted} name="close-circle" size={20} />
          </Pressable>
        ) : null}
      </View>

      {initialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : loading && results.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : debouncedQuery.trim() && results.length === 0 && !loading ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="search-outline" size={48} />
          <Text style={styles.emptyText}>{t('searchNoResults')}</Text>
        </View>
      ) : !debouncedQuery.trim() ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="search-outline" size={48} />
          <Text style={styles.emptyText}>{t('searchPlaceholder')}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={results}
          keyExtractor={keyExtractor}
          ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} size="small" /> : null}
          renderItem={renderItem}
        />
      )}
      <SaveToPlaylistModal
        visible={playlistModalDrug !== null}
        drug={playlistModalDrug}
        onSelectSaved={() => {
          if (playlistModalDrug) {
            handleSave(playlistModalDrug);
          }
          setPlaylistModalDrug(null);
        }}
        onSelectPlaylist={handlePlaylistSaved}
        onCancel={() => setPlaylistModalDrug(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  cardPressed: {
    opacity: 0.8,
  },
  cardContent: {
    gap: spacing.sm,
  },
  cardDetails: {
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardMetaText: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
  cardNameEn: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  cardNameZh: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
    lineHeight: 30,
  },
  cardNames: {
    flex: 1,
    gap: 2,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  clearButton: {
    padding: spacing.xs,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
    textAlign: 'center',
  },
  errorText: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
    textAlign: 'center',
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  saveButton: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  saveButtonPressed: {
    opacity: 0.8,
  },
  saveButtonSaved: {
    backgroundColor: colors.primary,
  },
  saveButtonText: {
    color: colors.primary,
    fontSize: typography.label,
    fontWeight: '600',
  },
  saveButtonTextSaved: {
    color: colors.card,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    lineHeight: 26,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
});

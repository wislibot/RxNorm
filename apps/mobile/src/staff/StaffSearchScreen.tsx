import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { searchDrugsGrouped, type ConceptGroup } from '../api/staffSearch';
import { colors, typography } from '../theme/tokens';

type Mode = 'search' | 'atc';

type StaffSearchStackParamList = {
  StaffSearchHome: undefined;
  ATCBrowser: { prefix: string; title: string };
  DrugDetail: { nhiCode: string };
};

type Nav = NativeStackNavigationProp<StaffSearchStackParamList, 'StaffSearchHome'>;

export function StaffSearchScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConceptGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const data = await searchDrugsGrouped(text.trim());
      setResults(data);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const renderConceptGroup = ({ item }: { item: ConceptGroup }) => (
    <View style={styles.conceptCard}>
      <View style={styles.conceptHeader}>
        <Text style={styles.ingredientName} numberOfLines={2}>
          {item.ingredient || t('staff.search.unknownIngredient')}
        </Text>
        <View style={styles.brandBadge}>
          <Text style={styles.brandBadgeText}>{item.brand_count}</Text>
        </View>
      </View>

      {item.atc_code && (
        <Pressable
          onPress={() => navigation.navigate('ATCBrowser', { prefix: item.atc_code!.slice(0, 5), title: item.atc_code! })}
          style={styles.atcChip}
        >
          <Ionicons name="layers-outline" size={12} color={colors.primary} />
          <Text style={styles.atcChipText}>{item.atc_code}</Text>
          {item.atc_name && <Text style={styles.atcName}> — {item.atc_name}</Text>}
        </Pressable>
      )}

      {item.brand_names.length > 0 && (
        <View style={styles.brandsList}>
          {item.brand_names.slice(0, 3).map((name, i) => (
            <Pressable
              key={item.sample_nhi_codes[i] || i}
              style={styles.brandRow}
              onPress={() => {
                if (item.sample_nhi_codes[i]) {
                  navigation.navigate('DrugDetail', { nhiCode: item.sample_nhi_codes[i] });
                }
              }}
            >
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              <Text style={styles.brandName} numberOfLines={1}>{name}</Text>
            </Pressable>
          ))}
          {item.brand_count > 3 && (
            <Text style={styles.moreBrands}>+{item.brand_count - 3} {t('staff.search.moreBrands')}</Text>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>{t('staff.search.title')}</Text>

      {/* Mode Toggle */}
      <View style={styles.modeRow}>
        <Pressable style={[styles.modeBtn, mode === 'search' && styles.modeBtnActive]} onPress={() => setMode('search')}>
          <Ionicons name="search" size={16} color={mode === 'search' ? '#fff' : colors.textMuted} />
          <Text style={[styles.modeBtnText, mode === 'search' && styles.modeBtnTextActive]}>
            {t('staff.search.textSearch')}
          </Text>
        </Pressable>
        <Pressable style={[styles.modeBtn, mode === 'atc' && styles.modeBtnActive]} onPress={() => setMode('atc')}>
          <Ionicons name="layers" size={16} color={mode === 'atc' ? '#fff' : colors.textMuted} />
          <Text style={[styles.modeBtnText, mode === 'atc' && styles.modeBtnTextActive]}>
            {t('staff.search.browseATC')}
          </Text>
        </Pressable>
      </View>

      {mode === 'search' ? (
        <>
          {/* Search Input */}
          <View style={styles.searchRow}>
            <Ionicons name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={t('staff.search.placeholder')}
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={handleSearch}
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => { setQuery(''); setResults([]); setSearched(false); }} style={styles.clearBtn}>
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          {/* Results */}
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item, i) => `${item.ingredient}-${item.atc_code || 'no-atc'}-${i}`}
              renderItem={renderConceptGroup}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                searched ? (
                  <View style={styles.empty}>
                    <Ionicons name="search-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyText}>{t('staff.search.noResults')}</Text>
                  </View>
                ) : (
                  <View style={styles.empty}>
                    <Ionicons name="medical-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyText}>{t('staff.search.hint')}</Text>
                  </View>
                )
              }
            />
          )}
        </>
      ) : (
        /* ATC Browser Quick Entry */
        <View style={styles.atcEntry}>
          <Ionicons name="layers-outline" size={64} color={colors.primary} style={{ marginBottom: 16 }} />
          <Text style={styles.atcEntryTitle}>{t('staff.search.atcEntryTitle')}</Text>
          <Text style={styles.atcEntryHint}>{t('staff.search.atcEntryHint')}</Text>
          <Pressable
            style={styles.atcStartBtn}
            onPress={() => navigation.navigate('ATCBrowser', { prefix: '', title: t('staff.search.browseATC') })}
          >
            <Ionicons name="arrow-forward" size={20} color="#fff" />
            <Text style={styles.atcStartBtnText}>{t('staff.search.startBrowsing')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  screenTitle: { fontSize: typography.title, fontWeight: '700', color: colors.text, paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  modeRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 12 },
  modeBtn: { flex: 1, flexDirection: 'row', paddingVertical: 10, borderRadius: 8, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border },
  modeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeBtnText: { fontSize: typography.label, fontWeight: '600', color: colors.textMuted },
  modeBtnTextActive: { color: '#fff' },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, marginHorizontal: 20, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: typography.body, color: colors.text, paddingVertical: 12 },
  clearBtn: { padding: 4 },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
  conceptCard: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  conceptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  ingredientName: { fontSize: typography.body, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  brandBadge: { backgroundColor: colors.primary + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  brandBadgeText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  atcChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10, flexWrap: 'wrap' },
  atcChipText: { fontSize: typography.label, fontWeight: '600', color: colors.primary },
  atcName: { fontSize: typography.label, color: colors.textMuted },
  brandsList: { gap: 4 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  brandName: { fontSize: typography.label, color: colors.textMuted, flex: 1 },
  moreBrands: { fontSize: typography.label, color: colors.primary, fontWeight: '600', marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: typography.body, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 40 },
  atcEntry: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  atcEntryTitle: { fontSize: typography.subtitle, fontWeight: '700', color: colors.text, marginBottom: 8, textAlign: 'center' },
  atcEntryHint: { fontSize: typography.label, color: colors.textMuted, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  atcStartBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 10 },
  atcStartBtnText: { fontSize: typography.body, fontWeight: '600', color: '#fff' },
});

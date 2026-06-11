import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { getBrandsForIngredient, type BrandItem } from '../api/staffSearch';
import { colors, typography } from '../theme/tokens';

type StaffSearchStackParamList = {
  StaffSearchHome: undefined;
  ATCBrowser: { prefix: string; title: string };
  BrandList: { atcPrefix: string; ingredient: string; atcCode: string | null; atcName: string | null };
  DrugDetail: { nhiCode: string };
};

type Nav = NativeStackNavigationProp<StaffSearchStackParamList, 'BrandList'>;
type RouteType = RouteProp<StaffSearchStackParamList, 'BrandList'>;

export function BrandListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteType>();
  const { atcPrefix, ingredient, atcCode, atcName } = route.params;

  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getBrandsForIngredient(atcPrefix, ingredient);
        setBrands(data);
      } catch (err) {
        console.error('Failed to load brands:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [atcPrefix, ingredient]);

  const renderBrand = ({ item }: { item: BrandItem }) => (
    <Pressable style={styles.brandCard} onPress={() => navigation.navigate('DrugDetail', { nhiCode: item.nhi_code })}>
      <View style={styles.brandInfo}>
        <Text style={styles.brandName}>{item.name_en || item.name_zh || '—'}</Text>
        {item.name_zh && item.name_en && <Text style={styles.brandNameAlt}>{item.name_zh}</Text>}
        <View style={styles.detailRow}>
          {item.nhi_code && (
            <View style={styles.detailChip}>
              <Text style={styles.detailChipText}>NHI: {item.nhi_code}</Text>
            </View>
          )}
          {item.dose_form && (
            <View style={styles.detailChip}>
              <Text style={styles.detailChipText}>{item.dose_form}</Text>
            </View>
          )}
          {item.strength_value && (
            <View style={styles.detailChip}>
              <Text style={styles.detailChipText}>{item.strength_value} {item.strength_unit || ''}</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.ingredientTitle} numberOfLines={3}>{ingredient}</Text>
        {atcCode && (
          <View style={styles.atcRow}>
            <Ionicons name="layers-outline" size={14} color={colors.primary} />
            <Text style={styles.atcText}>{atcCode}{atcName ? ` — ${atcName}` : ''}</Text>
          </View>
        )}
        <Text style={styles.countText}>{brands.length} {t('staff.brands.totalBrands')}</Text>
      </View>

      {/* Brand List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={brands}
          keyExtractor={(item) => item.nhi_code}
          renderItem={renderBrand}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="medical-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('staff.brands.noBrands')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  ingredientTitle: { fontSize: typography.subtitle, fontWeight: '700', color: colors.text, marginBottom: 8 },
  atcRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  atcText: { fontSize: typography.label, color: colors.primary, fontWeight: '600' },
  countText: { fontSize: typography.label, color: colors.textMuted },
  list: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  brandCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  brandInfo: { flex: 1, marginRight: 8 },
  brandName: { fontSize: typography.body, fontWeight: '600', color: colors.text, marginBottom: 2 },
  brandNameAlt: { fontSize: typography.label, color: colors.textMuted, marginBottom: 6 },
  detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  detailChip: { backgroundColor: colors.background, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  detailChipText: { fontSize: 12, color: colors.textMuted },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: typography.body, color: colors.textMuted },
});

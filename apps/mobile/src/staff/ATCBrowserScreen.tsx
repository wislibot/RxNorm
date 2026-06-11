import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { browseATCLevel, browseATCDrugs, type ATCLevel, type ConceptGroup } from '../api/staffSearch';
import { colors, typography } from '../theme/tokens';

type Breadcrumb = { prefix: string; title: string };

type StaffSearchStackParamList = {
  StaffSearchHome: undefined;
  ATCBrowser: { prefix: string; title: string };
  BrandList: { atcPrefix: string; ingredient: string; atcCode: string | null; atcName: string | null };
  DrugDetail: { nhiCode: string };
};

type Nav = NativeStackNavigationProp<StaffSearchStackParamList, 'ATCBrowser'>;
type RouteType = RouteProp<StaffSearchStackParamList, 'ATCBrowser'>;

export function ATCBrowserScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteType>();
  const { prefix: initialPrefix, title: initialTitle } = route.params;

  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ prefix: initialPrefix, title: initialTitle }]);
  const [levels, setLevels] = useState<ATCLevel[]>([]);
  const [drugs, setDrugs] = useState<ConceptGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDrugs, setShowDrugs] = useState(false);

  const currentPrefix = breadcrumbs[breadcrumbs.length - 1].prefix;

  const loadData = useCallback(async (p: string) => {
    setLoading(true);
    setShowDrugs(false);
    try {
      // If prefix is 5+ chars, show drugs grouped by ingredient
      if (p.length >= 5) {
        const d = await browseATCDrugs(p);
        setDrugs(d);
        setShowDrugs(true);
      } else {
        const l = await browseATCLevel(p);
        setLevels(l);
        setShowDrugs(false);
      }
    } catch (err) {
      console.error('ATC browse error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(currentPrefix);
  }, [currentPrefix, loadData]);

  const drillDown = (code: string, name: string) => {
    setBreadcrumbs(prev => [...prev, { prefix: code, title: name }]);
  };

  const goToBreadcrumb = (index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  };

  const renderLevelCard = ({ item }: { item: ATCLevel }) => (
    <Pressable style={styles.levelCard} onPress={() => drillDown(item.atc_code, item.atc_name)}>
      <View style={styles.levelCardLeft}>
        <Text style={styles.levelCode}>{item.atc_code}</Text>
        <Text style={styles.levelName} numberOfLines={2}>{item.atc_name}</Text>
      </View>
      <View style={styles.levelCardRight}>
        <Text style={styles.drugCount}>{item.drug_count}</Text>
        <Text style={styles.drugCountLabel}>{t('staff.atc.drugs')}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </Pressable>
  );

  const renderConceptGroup = ({ item }: { item: ConceptGroup }) => (
    <Pressable
      style={styles.conceptCard}
      onPress={() => {
        navigation.navigate('BrandList', {
          atcPrefix: currentPrefix,
          ingredient: item.ingredient,
          atcCode: item.atc_code,
          atcName: item.atc_name,
        });
      }}
    >
      <View style={styles.conceptHeader}>
        <Text style={styles.ingredientName} numberOfLines={2}>
          {item.ingredient || t('staff.search.unknownIngredient')}
        </Text>
        <View style={styles.brandBadge}>
          <Text style={styles.brandBadgeText}>{item.brand_count}</Text>
        </View>
      </View>
      {item.atc_code && (
        <View style={styles.atcInfo}>
          <Ionicons name="layers-outline" size={12} color={colors.primary} />
          <Text style={styles.atcInfoText}>{item.atc_code}{item.atc_name ? ` — ${item.atc_name}` : ''}</Text>
        </View>
      )}
      {item.brand_names.length > 0 && (
        <View style={styles.brandsList}>
          {item.brand_names.slice(0, 3).map((name, i) => (
            <View key={item.sample_nhi_codes[i] || i} style={styles.brandRow}>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              <Text style={styles.brandName} numberOfLines={1}>{name}</Text>
            </View>
          ))}
          {item.brand_count > 3 && (
            <Text style={styles.moreBrands}>+{item.brand_count - 3} {t('staff.search.moreBrands')}</Text>
          )}
        </View>
      )}
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {/* Breadcrumbs */}
      <View style={styles.breadcrumbRow}>
        {breadcrumbs.map((bc, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={styles.breadcrumbSep} />}
            <Pressable onPress={() => goToBreadcrumb(i)}>
              <Text style={[styles.breadcrumbText, i === breadcrumbs.length - 1 && styles.breadcrumbActive]}>
                {bc.prefix || t('staff.atc.root')}
              </Text>
            </Pressable>
          </React.Fragment>
        ))}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : showDrugs ? (
        <FlatList
          data={drugs}
          keyExtractor={(item, i) => `${item.ingredient}-${item.atc_code || 'no-atc'}-${i}`}
          renderItem={renderConceptGroup}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="medical-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('staff.atc.noDrugs')}</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={levels}
          keyExtractor={(item) => item.atc_code}
          renderItem={renderLevelCard}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="layers-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('staff.atc.noCategories')}</Text>
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
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: colors.border },
  breadcrumbSep: { marginHorizontal: 4 },
  breadcrumbText: { fontSize: typography.label, color: colors.textMuted },
  breadcrumbActive: { color: colors.primary, fontWeight: '700' },
  list: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  levelCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  levelCardLeft: { flex: 1, marginRight: 12 },
  levelCode: { fontSize: typography.label, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  levelName: { fontSize: typography.body, fontWeight: '500', color: colors.text, lineHeight: 22 },
  levelCardRight: { alignItems: 'center', gap: 2 },
  drugCount: { fontSize: typography.subtitle, fontWeight: '700', color: colors.text },
  drugCountLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  conceptCard: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  conceptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  ingredientName: { fontSize: typography.body, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  brandBadge: { backgroundColor: colors.primary + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  brandBadgeText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  atcInfo: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  atcInfoText: { fontSize: typography.label, color: colors.textMuted },
  brandsList: { gap: 4 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  brandName: { fontSize: typography.label, color: colors.textMuted, flex: 1 },
  moreBrands: { fontSize: typography.label, color: colors.primary, fontWeight: '600', marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: typography.body, color: colors.textMuted },
});

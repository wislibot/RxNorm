import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { getSharedDruglistDetail, type SharedDruglistDetail } from '../api/staff';
import { colors, typography } from '../theme/tokens';

type StaffRecordsStackParamList = {
  StaffRecordsHome: undefined;
  StaffCaseDetail: { caseId: string; caseName: string | null };
  StaffDruglistDetail: { playlistId: string; playlistName: string };
};

type RouteType = RouteProp<StaffRecordsStackParamList, 'StaffDruglistDetail'>;

export function StaffDruglistDetailScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteType>();
  const { playlistId, playlistName } = route.params;
  const [detail, setDetail] = useState<SharedDruglistDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getSharedDruglistDetail(playlistId);
        setDetail(data);
      } catch (err) {
        console.error('Failed to load druglist detail:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [playlistId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t('staff.records.loadError')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{playlistName}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>{detail.patient_email}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>{new Date(detail.created_at).toLocaleString()}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="medical-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>{detail.items.length} {t('staff.records.drugs')}</Text>
        </View>
      </View>

      {/* Drug List */}
      <FlatList
        data={detail.items}
        keyExtractor={(item) => item.item_id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <View style={styles.drugCard}>
            <View style={styles.drugHeader}>
              <Text style={styles.drugIndex}>#{index + 1}</Text>
              <Text style={styles.drugName}>{item.item_name_en || item.item_name_zh || '—'}</Text>
            </View>
            {item.item_name_zh && item.item_name_en && (
              <Text style={styles.drugAlt}>{item.item_name_zh}</Text>
            )}
            {item.item_nhi_code && (
              <Text style={styles.drugDetail}>NHI: {item.item_nhi_code}</Text>
            )}
            {item.item_ingredient_text && (
              <Text style={styles.drugDetail}>{t('staff.records.ingredient')}: {item.item_ingredient_text}</Text>
            )}
            {item.item_strength_value && (
              <Text style={styles.drugDetail}>
                {t('staff.records.strength')}: {item.item_strength_value} {item.item_strength_unit || ''}
              </Text>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('staff.records.noDrugs')}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: typography.title, fontWeight: '700', color: colors.text, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { fontSize: typography.label, color: colors.textMuted },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  drugCard: { backgroundColor: colors.card, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  drugHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  drugIndex: { fontSize: typography.label, fontWeight: '700', color: colors.primary },
  drugName: { fontSize: typography.body, fontWeight: '600', color: colors.text, flex: 1 },
  drugAlt: { fontSize: typography.label, color: colors.textMuted, marginBottom: 4 },
  drugDetail: { fontSize: typography.label, color: colors.textMuted, marginBottom: 2 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: typography.body, color: colors.textMuted },
  errorText: { fontSize: typography.body, color: colors.textMuted },
});

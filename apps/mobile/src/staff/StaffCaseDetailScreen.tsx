import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { getSharedCaseDetail, type SharedCaseDetail } from '../api/staff';
import { colors, typography } from '../theme/tokens';

type StaffRecordsStackParamList = {
  StaffRecordsHome: undefined;
  StaffCaseDetail: { caseId: string; caseName: string | null };
  StaffDruglistDetail: { playlistId: string; playlistName: string };
};

type RouteType = RouteProp<StaffRecordsStackParamList, 'StaffCaseDetail'>;

interface DetectedItem {
  display_name?: string;
  nhi_code?: string;
  match_status?: string;
  confidence?: number;
  raw_text?: string;
}

export function StaffCaseDetailScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteType>();
  const { caseId, caseName } = route.params;
  const [detail, setDetail] = useState<SharedCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getSharedCaseDetail(caseId);
        setDetail(data);
      } catch (err) {
        console.error('Failed to load case detail:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [caseId]);

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

  const items: DetectedItem[] = detail.detected_items ?? [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{caseName || t('staff.records.unnamedCase')}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>{detail.patient_email}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>{new Date(detail.created_at).toLocaleString()}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="medkit-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>{items.length} {t('staff.records.medications')}</Text>
        </View>
      </View>

      {/* Medications List */}
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${item.nhi_code || 'unknown'}-${index}`}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <View style={styles.medCard}>
            <View style={styles.medHeader}>
              <Text style={styles.medIndex}>#{index + 1}</Text>
              <Text style={styles.medName}>{item.display_name || item.raw_text || '—'}</Text>
            </View>
            {item.nhi_code && (
              <Text style={styles.medDetail}>NHI: {item.nhi_code}</Text>
            )}
            {item.match_status && (
              <Text style={styles.medDetail}>
                {t('staff.records.status')}: {item.match_status}
                {item.confidence != null ? ` (${Math.round(item.confidence * 100)}%)` : ''}
              </Text>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('staff.records.noMedications')}</Text>
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
  medCard: { backgroundColor: colors.card, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  medHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  medIndex: { fontSize: typography.label, fontWeight: '700', color: colors.primary },
  medName: { fontSize: typography.body, fontWeight: '600', color: colors.text, flex: 1 },
  medDetail: { fontSize: typography.label, color: colors.textMuted, marginBottom: 2 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: typography.body, color: colors.textMuted },
  errorText: { fontSize: typography.body, color: colors.textMuted },
});

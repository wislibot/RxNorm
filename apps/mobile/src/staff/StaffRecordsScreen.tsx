import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { getAllStaffSharedCases, getAllStaffSharedDruglists, type SharedCase, type SharedDruglist } from '../api/staff';
import { colors, typography } from '../theme/tokens';

type Tab = 'cases' | 'druglists';

type StaffRecordsStackParamList = {
  StaffRecordsHome: undefined;
  StaffCaseDetail: { caseId: string; caseName: string | null };
  StaffDruglistDetail: { playlistId: string; playlistName: string };
};

type Nav = NativeStackNavigationProp<StaffRecordsStackParamList, 'StaffRecordsHome'>;

export function StaffRecordsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const [tab, setTab] = useState<Tab>('cases');
  const [cases, setCases] = useState<SharedCase[]>([]);
  const [druglists, setDruglists] = useState<SharedDruglist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([getAllStaffSharedCases(), getAllStaffSharedDruglists()]);
      setCases(c);
      setDruglists(d);
    } catch (err) {
      console.error('Failed to load staff records:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const renderCase = ({ item }: { item: SharedCase }) => (
    <Pressable
      style={styles.card}
      onPress={() => navigation.navigate('StaffCaseDetail', { caseId: item.case_id, caseName: item.case_name })}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.case_name || t('staff.records.unnamedCase')}</Text>
        <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
      </View>
      <View style={styles.cardMeta}>
        <Ionicons name="person-outline" size={14} color={colors.textMuted} />
        <Text style={styles.metaText}>{item.patient_email}</Text>
      </View>
      <View style={styles.cardMeta}>
        <Ionicons name="medkit-outline" size={14} color={colors.textMuted} />
        <Text style={styles.metaText}>
          {item.medication_count} {t('staff.records.medications')}
        </Text>
      </View>
      {item.hospital_name && (
        <View style={styles.cardMeta}>
          <Ionicons name="business-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>{item.hospital_name}</Text>
        </View>
      )}
      {item.medication_names.length > 0 && (
        <Text style={styles.cardMeds} numberOfLines={2}>
          {item.medication_names.join(' • ')}
        </Text>
      )}
    </Pressable>
  );

  const renderDruglist = ({ item }: { item: SharedDruglist }) => (
    <Pressable
      style={styles.card}
      onPress={() => navigation.navigate('StaffDruglistDetail', { playlistId: item.playlist_id, playlistName: item.playlist_name })}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.playlist_name}</Text>
        <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
      </View>
      <View style={styles.cardMeta}>
        <Ionicons name="person-outline" size={14} color={colors.textMuted} />
        <Text style={styles.metaText}>{item.patient_email}</Text>
      </View>
      <View style={styles.cardMeta}>
        <Ionicons name="medical-outline" size={14} color={colors.textMuted} />
        <Text style={styles.metaText}>
          {item.drug_count} {t('staff.records.drugs')}
        </Text>
      </View>
      {item.hospital_name && (
        <View style={styles.cardMeta}>
          <Ionicons name="business-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>{item.hospital_name}</Text>
        </View>
      )}
      {item.drug_names.length > 0 && (
        <Text style={styles.cardMeds} numberOfLines={2}>
          {item.drug_names.join(' • ')}
        </Text>
      )}
    </Pressable>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>{t('staff.tabs.records')}</Text>

      {/* Tab Toggle */}
      <View style={styles.tabRow}>
        <Pressable style={[styles.tabBtn, tab === 'cases' && styles.tabBtnActive]} onPress={() => setTab('cases')}>
          <Text style={[styles.tabBtnText, tab === 'cases' && styles.tabBtnTextActive]}>
            {t('staff.records.cases')} ({cases.length})
          </Text>
        </Pressable>
        <Pressable style={[styles.tabBtn, tab === 'druglists' && styles.tabBtnActive]} onPress={() => setTab('druglists')}>
          <Text style={[styles.tabBtnText, tab === 'druglists' && styles.tabBtnTextActive]}>
            {t('staff.records.druglists')} ({druglists.length})
          </Text>
        </Pressable>
      </View>

      {tab === 'cases' ? (
        <FlatList
          data={cases}
          keyExtractor={(item) => item.case_id}
          renderItem={renderCase}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('staff.records.noCases')}</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={druglists}
          keyExtractor={(item) => item.playlist_id}
          renderItem={renderDruglist}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="medical-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('staff.records.noDruglists')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  screenTitle: { fontSize: typography.title, fontWeight: '700', color: colors.text, paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 12 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.card, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabBtnText: { fontSize: typography.label, fontWeight: '600', color: colors.textMuted },
  tabBtnTextActive: { color: '#fff' },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: typography.body, fontWeight: '600', color: colors.text, flex: 1 },
  cardDate: { fontSize: typography.label, color: colors.textMuted },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { fontSize: typography.label, color: colors.textMuted },
  cardMeds: { fontSize: typography.label, color: colors.textMuted, marginTop: 8, lineHeight: 18 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: typography.body, color: colors.textMuted },
});

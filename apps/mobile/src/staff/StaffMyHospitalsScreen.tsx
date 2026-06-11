import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthProvider';
import { colors, typography } from '../theme/tokens';

export function StaffMyHospitalsScreen() {
  const { t } = useTranslation();
  const { staffHospitals } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>{t('staff.tabs.hospitals')}</Text>

      <FlatList
        data={staffHospitals}
        keyExtractor={(item) => item.hospital_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardIcon}>
              <Ionicons name="business" size={24} color={colors.primary} />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.hospitalName}>{item.name_zh}</Text>
              <Text style={styles.hospitalNameEn}>{item.name_en}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{item.role}</Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="business-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('staff.hospitals.noHospitals')}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  screenTitle: { fontSize: typography.title, fontWeight: '700', color: colors.text, paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
  card: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 14 },
  cardIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  cardContent: { flex: 1 },
  hospitalName: { fontSize: typography.body, fontWeight: '600', color: colors.text },
  hospitalNameEn: { fontSize: typography.label, color: colors.textMuted, marginBottom: 6 },
  roleBadge: { alignSelf: 'flex-start', backgroundColor: colors.primary + '20', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  roleText: { fontSize: 12, fontWeight: '600', color: colors.primary, textTransform: 'capitalize' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: typography.body, color: colors.textMuted },
});

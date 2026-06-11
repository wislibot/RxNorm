import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { getMyCaseSummaries, getMyPlaylists, getSharedRecordIds, shareRecord, unshareRecord } from '../api/sharing';
import { colors, radius, spacing, typography } from '../theme/tokens';

type Props = {
  route: { params: { hospitalId: string; hospitalNameZh: string; hospitalNameEn: string } };
  navigation: { goBack: () => void };
};

type CaseSummary = {
  case_id: string;
  created_at: string;
  ocr_sections: any;
};

type PlaylistSummary = {
  id: string;
  name: string;
  item_count: number;
};

export function HospitalDetailScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { hospitalId, hospitalNameZh, hospitalNameEn } = route.params;
  const [activeTab, setActiveTab] = useState<'cases' | 'druglists'>('cases');
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [sharedCaseIds, setSharedCaseIds] = useState<Set<string>>(new Set());
  const [sharedPlaylistIds, setSharedPlaylistIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [casesData, playlistsData, sharedCases, sharedPlaylists] = await Promise.all([
        getMyCaseSummaries(),
        getMyPlaylists(),
        getSharedRecordIds(hospitalId, 'case'),
        getSharedRecordIds(hospitalId, 'druglist'),
      ]);
      setCases(casesData);
      setPlaylists(playlistsData);
      setSharedCaseIds(sharedCases);
      setSharedPlaylistIds(sharedPlaylists);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const toggleCaseShare = useCallback(async (caseId: string, currentlyShared: boolean) => {
    setSharedCaseIds((prev) => {
      const next = new Set(prev);
      if (currentlyShared) next.delete(caseId);
      else next.add(caseId);
      return next;
    });

    try {
      if (currentlyShared) {
        await unshareRecord(hospitalId, 'case', caseId);
      } else {
        await shareRecord(hospitalId, 'case', caseId);
      }
    } catch {
      setSharedCaseIds((prev) => {
        const next = new Set(prev);
        if (currentlyShared) next.add(caseId);
        else next.delete(caseId);
        return next;
      });
    }
  }, [hospitalId]);

  const togglePlaylistShare = useCallback(async (playlistId: string, currentlyShared: boolean) => {
    setSharedPlaylistIds((prev) => {
      const next = new Set(prev);
      if (currentlyShared) next.delete(playlistId);
      else next.add(playlistId);
      return next;
    });

    try {
      if (currentlyShared) {
        await unshareRecord(hospitalId, 'druglist', playlistId);
      } else {
        await shareRecord(hospitalId, 'druglist', playlistId);
      }
    } catch {
      setSharedPlaylistIds((prev) => {
        const next = new Set(prev);
        if (currentlyShared) next.add(playlistId);
        else next.delete(playlistId);
        return next;
      });
    }
  }, [hospitalId]);

  const getMedicationName = (item: CaseSummary): string => {
    const medicationName = item.ocr_sections?.case_fields?.medicationName;
    if (medicationName) return medicationName;
    const firstLine = item.ocr_sections?.medicationLines?.[0];
    if (firstLine) return firstLine;
    return t('casePageCreatedPlaceholder');
  };

  const formatDate = (dateStr: string): string => {
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const renderCasesTab = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (cases.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="document-text-outline" size={48} />
          <Text style={styles.emptyText}>{t('hospitalDetailNoCases')}</Text>
        </View>
      );
    }
    return (
      <View style={styles.list}>
        {cases.map((item) => {
          const isShared = sharedCaseIds.has(item.case_id);
          return (
            <View key={item.case_id} style={styles.card}>
              <View style={styles.cardContent}>
                <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
                <Text style={styles.cardMedName}>{getMedicationName(item)}</Text>
              </View>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>
                  {isShared ? t('shareToggleOn') : t('shareToggleOff')}
                </Text>
                <Switch
                  value={isShared}
                  onValueChange={() => toggleCaseShare(item.case_id, isShared)}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderDruglistsTab = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (playlists.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="list-outline" size={48} />
          <Text style={styles.emptyText}>{t('hospitalDetailNoDruglists')}</Text>
        </View>
      );
    }
    return (
      <View style={styles.list}>
        {playlists.map((item) => {
          const isShared = sharedPlaylistIds.has(item.id);
          return (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardContent}>
                <Text style={styles.cardMedName}>{item.name}</Text>
                <Text style={styles.cardDate}>
                  {t('playlistDrugCount', { count: item.item_count })}
                </Text>
              </View>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>
                  {isShared ? t('shareToggleOn') : t('shareToggleOff')}
                </Text>
                <Switch
                  value={isShared}
                  onValueChange={() => togglePlaylistShare(item.id, isShared)}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backButton}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.hospitalNameZh}>{hospitalNameZh}</Text>
          <Text style={styles.hospitalNameEn}>{hospitalNameEn}</Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setActiveTab('cases')}
          style={[styles.tab, activeTab === 'cases' && styles.activeTab]}
        >
          <Text style={[styles.tabText, activeTab === 'cases' && styles.activeTabText]}>
            {t('hospitalDetailScanHistory')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('druglists')}
          style={[styles.tab, activeTab === 'druglists' && styles.activeTab]}
        >
          <Text style={[styles.tabText, activeTab === 'druglists' && styles.activeTabText]}>
            {t('hospitalDetailDruglists')}
          </Text>
        </Pressable>
      </View>

      {activeTab === 'cases' ? renderCasesTab() : renderDruglistsTab()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  hospitalNameZh: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  hospitalNameEn: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  tabBar: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: 0,
    padding: spacing.xs,
  },
  tab: {
    alignItems: 'center',
    borderRadius: radius.md,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  activeTab: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  cardContent: {
    flex: 1,
    gap: 2,
  },
  cardMedName: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    lineHeight: 26,
  },
  cardDate: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 22,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
    textAlign: 'center',
  },
});

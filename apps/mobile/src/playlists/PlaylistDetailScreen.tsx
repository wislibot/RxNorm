import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { getCaseDdiByIngredients } from '../api/ddi';
import {
  getPlaylistItems,
  getPlaylistIngredientIds,
  removeFromPlaylist,
  deletePlaylist,
  type PlaylistItem,
} from '../api/playlists';
import type { MyMedsStackParamList } from '../case/navigationTypes';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { CaseDdiInteraction, CaseDdiResult } from '../types/ddi';
import { DeletePlaylistConfirm } from './DeletePlaylistConfirm';
import { getSupabaseClient } from '../lib/supabase';

type Props = {
  route: RouteProp<MyMedsStackParamList, 'PlaylistDetail'>;
  navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
};

export function PlaylistDetailScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { playlistId, playlistName } = route.params;
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [ddiResult, setDdiResult] = useState<CaseDdiResult | null>(null);
  const [ddiLoading, setDdiLoading] = useState(false);
  const [ddiVisible, setDdiVisible] = useState(false);

  const load = useCallback(async (pullRefresh = false) => {
    if (pullRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await getPlaylistItems(playlistId);
      setItems(data);
    } catch {
      setError(t('searchError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [playlistId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = useCallback(async (itemId: string) => {
    try {
      await removeFromPlaylist(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch {
      // silently fail
    }
  }, []);

  const handleDelete = useCallback(async () => {
    try {
      await deletePlaylist(playlistId);
      navigation.goBack();
    } catch {
      // silently fail
    }
  }, [playlistId, navigation]);

  const handleDdiPress = useCallback(async () => {
    setDdiVisible(true);
    setDdiLoading(true);
    try {
      const ingredientIds = await getPlaylistIngredientIds(playlistId, getSupabaseClient());
      const result = await getCaseDdiByIngredients(ingredientIds);
      setDdiResult(result);
    } catch {
      // silently fail
    } finally {
      setDdiLoading(false);
    }
  }, [playlistId]);

  const handleItemPress = useCallback(
    (nhiCode: string) => {
      navigation.navigate('DrugDetail', { nhiCode });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: PlaylistItem }) => {
      const ingredientPart = item.ingredient_text
        ? t('savedMedsIngredient', { text: item.ingredient_text })
        : null;

      const formPart = item.dose_form
        ? t('savedMedsForm', { form: item.dose_form })
        : null;

      const strengthPart =
        item.strength_value != null && item.strength_unit
          ? t('savedMedsStrength', { value: item.strength_value, unit: item.strength_unit })
          : null;

      return (
        <Pressable
          onPress={() => handleItemPress(item.nhi_code)}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <View style={styles.cardNames}>
                {item.name_zh ? <Text style={styles.cardNameZh}>{item.name_zh}</Text> : null}
                {item.name_en ? <Text style={styles.cardNameEn}>{item.name_en}</Text> : null}
              </View>
              <Pressable
                onPress={() => handleRemove(item.id)}
                style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
              >
                <Ionicons color={colors.textMuted} name="trash-outline" size={18} />
                <Text style={styles.removeButtonText}>{t('playlistRemove')}</Text>
              </Pressable>
            </View>
            <View style={styles.cardDetails}>
              <Text style={styles.cardLabel}>{t('savedMedsNhiCode', { code: item.nhi_code })}</Text>
              {ingredientPart ? <Text style={styles.cardLabel}>{ingredientPart}</Text> : null}
              <View style={styles.cardMeta}>
                {formPart ? <Text style={styles.cardMetaText}>{formPart}</Text> : null}
                {strengthPart ? <Text style={styles.cardMetaText}>{strengthPart}</Text> : null}
                {item.atc_code ? (
                  <Text style={styles.cardMetaText}>{t('savedMedsAtc', { code: item.atc_code })}</Text>
                ) : null}
              </View>
            </View>
          </View>
        </Pressable>
      );
    },
    [handleItemPress, handleRemove, t],
  );

  const keyExtractor = useCallback((item: PlaylistItem) => item.id, []);

  const ingredientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ing of ddiResult?.checked_ingredients ?? []) {
      map.set(ing.ingredient_id, ing.canonical_name);
    }
    return map;
  }, [ddiResult?.checked_ingredients]);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.title}>{playlistName}</Text>
          <Text style={styles.subtitle}>
            {t('playlistDrugCount', { count: items.length })}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleDdiPress}
            style={({ pressed }) => [styles.ddiButton, pressed && styles.ddiButtonPressed]}
          >
            <Ionicons color={colors.primary} name="shield-checkmark-outline" size={20} />
          </Pressable>
          <Pressable
            onPress={() => setDeleteVisible(true)}
            style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
          >
            <Ionicons color={colors.textMuted} name="trash-outline" size={20} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="alert-circle-outline" size={48} />
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="medical-outline" size={48} />
          <Text style={styles.emptyText}>{t('playlistEmptyDetail')}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={keyExtractor}
          refreshControl={
            <RefreshControl onRefresh={() => load(true)} refreshing={refreshing} />
          }
          renderItem={renderItem}
        />
      )}

      <DeletePlaylistConfirm
        visible={deleteVisible}
        onConfirm={handleDelete}
        onCancel={() => setDeleteVisible(false)}
      />

      <Modal
        visible={ddiVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDdiVisible(false)}
      >
        <View style={styles.ddiModal}>
          <View style={styles.ddiModalHeader}>
            <Text style={styles.ddiModalTitle}>{t('casePageDdiTitle')}</Text>
            <Pressable onPress={() => setDdiVisible(false)}>
              <Ionicons color={colors.textMuted} name="close" size={24} />
            </Pressable>
          </View>
          {ddiLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : ddiResult ? (
            <ScrollView contentContainerStyle={styles.ddiContent}>
              {ddiResult.unchecked_ingredient_count > 0 ? (
                <View style={styles.warningBanner}>
                  <Text style={styles.warningText}>{t('casePageDdiUncheckedWarning')}</Text>
                </View>
              ) : null}
              {ddiResult.interactions.map((interaction: CaseDdiInteraction) => {
                const aName = ingredientNameMap.get(interaction.ingredient_a_id) ?? interaction.ingredient_a_id;
                const bName = ingredientNameMap.get(interaction.ingredient_b_id) ?? interaction.ingredient_b_id;
                return (
                  <View key={`${interaction.ingredient_a_id}-${interaction.ingredient_b_id}`} style={styles.interactionCard}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.itemTitle}>{interaction.patient_title_en}</Text>
                      <View
                        style={[
                          styles.severityBadge,
                          interaction.severity === 'major'
                            ? styles.majorBadge
                            : interaction.severity === 'moderate'
                              ? styles.moderateBadge
                              : styles.minorBadge,
                        ]}
                      >
                        <Text
                          style={[
                            styles.severityBadgeText,
                            interaction.severity === 'major'
                              ? styles.majorBadgeText
                              : interaction.severity === 'moderate'
                                ? styles.moderateBadgeText
                                : styles.minorBadgeText,
                          ]}
                        >
                          {t(`casePageSeverity.${interaction.severity}`)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.ingredientPairText}>{`${aName} ↔ ${bName}`}</Text>
                    <Text style={styles.body}>{interaction.patient_message_en}</Text>
                  </View>
                );
              })}
              {ddiResult.interactions_found_count === 0 && ddiResult.unchecked_ingredient_count === 0 ? (
                <Text style={styles.body}>{t('casePageNoInteractions')}</Text>
              ) : null}
              <Text style={styles.disclaimerText}>
                {ddiResult.coverage_disclaimer_en}
              </Text>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerContent: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonPressed: {
    opacity: 0.7,
  },
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardNames: {
    flex: 1,
    gap: 2,
  },
  cardNameZh: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
    lineHeight: 30,
  },
  cardNameEn: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  cardDetails: {
    gap: spacing.xs,
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
  removeButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  removeButtonPressed: {
    opacity: 0.7,
  },
  removeButtonText: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
    textAlign: 'center',
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ddiButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ddiButtonPressed: {
    opacity: 0.7,
  },
  ddiModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  ddiModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  ddiModalTitle: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  ddiContent: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  warningBanner: {
    backgroundColor: colors.warningBackground,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  warningText: {
    color: colors.warningText,
    fontSize: typography.body,
    lineHeight: 26,
  },
  interactionCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
    flex: 1,
  },
  severityBadge: {
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  majorBadge: { backgroundColor: '#FDE8E8' },
  moderateBadge: { backgroundColor: '#FFF4D6' },
  minorBadge: { backgroundColor: '#E6FFFA' },
  severityBadgeText: {
    fontSize: typography.label,
    fontWeight: '600',
  },
  majorBadgeText: { color: '#B42318' },
  moderateBadgeText: { color: colors.warningText },
  minorBadgeText: { color: '#046C4E' },
  ingredientPairText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '500',
  },
  body: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 26,
  },
  disclaimerText: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 22,
    fontStyle: 'italic',
  },
});

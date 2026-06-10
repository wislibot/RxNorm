import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { getSavedMeds, removeMed, type SavedMed } from '../api/drugs';
import { colors, radius, spacing, typography } from '../theme/tokens';

function SavedMedCard({
  item,
  onRemove,
}: {
  item: SavedMed;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState(false);

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

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await removeMed(item.id);
      onRemove(item.id);
    } catch {
      setRemoving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardNames}>
            {item.name_zh ? (
              <Text style={styles.cardNameZh}>{item.name_zh}</Text>
            ) : null}
            {item.name_en ? (
              <Text style={styles.cardNameEn}>{item.name_en}</Text>
            ) : null}
          </View>
          <Pressable
            disabled={removing}
            onPress={handleRemove}
            style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
          >
            {removing ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <>
                <Ionicons color={colors.textMuted} name="trash-outline" size={18} />
                <Text style={styles.removeButtonText}>{t('savedMedsRemove')}</Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.cardDetails}>
          <Text style={styles.cardLabel}>
            {t('savedMedsNhiCode', { code: item.nhi_code })}
          </Text>
          {ingredientPart ? <Text style={styles.cardLabel}>{ingredientPart}</Text> : null}
          <View style={styles.cardMeta}>
            {formPart ? <Text style={styles.cardMetaText}>{formPart}</Text> : null}
            {strengthPart ? <Text style={styles.cardMetaText}>{strengthPart}</Text> : null}
            {item.atc_code ? (
              <Text style={styles.cardMetaText}>
                {t('savedMedsAtc', { code: item.atc_code })}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

export function SavedMedsScreen() {
  const { t } = useTranslation();
  const [meds, setMeds] = useState<SavedMed[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pullRefresh = false) => {
    if (pullRefresh) {
      setRefreshing(true);
    }
    setError(null);
    try {
      const data = await getSavedMeds();
      setMeds(data);
    } catch {
      setError(t('searchError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = useCallback((id: string) => {
    setMeds((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: SavedMed }) => (
      <SavedMedCard item={item} onRemove={handleRemove} />
    ),
    [handleRemove],
  );

  const keyExtractor = useCallback((item: SavedMed) => item.id, []);

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t('savedMedsTitle')}</Text>
      <Text style={styles.subtitle}>{t('savedMedsSubtitle')}</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="alert-circle-outline" size={48} />
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : meds.length === 0 ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="bookmark-outline" size={48} />
          <Text style={styles.emptyText}>{t('savedMedsEmpty')}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={meds}
          keyExtractor={keyExtractor}
          refreshControl={
            <RefreshControl onRefresh={() => load(true)} refreshing={refreshing} />
          }
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
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
  page: {
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    padding: spacing.lg,
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
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
});

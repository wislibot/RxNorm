import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { RouteProp } from '@react-navigation/native';

import { useAuth } from '../auth/AuthProvider';
import { getDrugDetail, saveMed, type DrugDetail, type DrugSearchResult } from '../api/drugs';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { SearchStackParamList } from './navigationTypes';
import { SaveToPlaylistModal } from '../playlists/SaveToPlaylistModal';

type Props = {
  route: RouteProp<SearchStackParamList, 'DrugDetail'>;
};

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function DrugDetailScreen({ route }: Props) {
  const { t } = useTranslation();
  const { isStaffUser } = useAuth();
  const { nhiCode } = route.params;
  const [drug, setDrug] = useState<DrugDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getDrugDetail(nhiCode)
      .then((data) => {
        if (!cancelled) setDrug(data);
      })
      .catch(() => {
        if (!cancelled) setError(t('drugDetailLoadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [nhiCode, t]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !drug) {
    return (
      <View style={styles.center}>
        <Ionicons color={colors.textMuted} name="alert-circle-outline" size={48} />
        <Text style={styles.emptyText}>{error ?? t('drugDetailLoadError')}</Text>
      </View>
    );
  }

  const strengthPart =
    drug.strength_value != null && drug.strength_unit
      ? `${drug.strength_value}${drug.strength_unit}`
      : null;

  const ingredientPart = drug.ingredient_text ?? null;

  const priceText =
    drug.price_nhi != null && drug.price_nhi > 0
      ? `NT$${drug.price_nhi}`
      : drug.price_nhi === 0
        ? t('drugDetailFree')
        : null;

  const dateRange =
    drug.effective_start && drug.effective_end
      ? `${drug.effective_start} ~ ${drug.effective_end}`
      : drug.effective_start
        ? `${drug.effective_start} ~`
        : null;

  const activeIngredients = (drug.ingredients ?? []).filter(
    (ing) => ing.role === 'active',
  );

  const drugSearchResult: DrugSearchResult | null = drug
    ? {
        atc_code: drug.atc_code,
        dose_form: drug.dose_form,
        ingredient_text: drug.ingredient_text,
        name_en: drug.name_en,
        name_zh: drug.name_zh,
        nhi_code: drug.nhi_code,
        strength_value: drug.strength_value,
        strength_unit: drug.strength_unit,
        relevance: 1,
      }
    : null;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        {drug.name_zh ? <Text style={styles.nameZh}>{drug.name_zh}</Text> : null}
        {drug.name_en ? <Text style={styles.nameEn}>{drug.name_en}</Text> : null}
        {!isStaffUser && (
          <Pressable
            onPress={() => {
              if (saved) return;
              setShowSaveModal(true);
            }}
            style={({ pressed }) => [
              styles.saveButton,
              saved && styles.saveButtonSaved,
              pressed && styles.saveButtonPressed,
            ]}
          >
            <Ionicons
              color={saved ? colors.card : colors.primary}
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={20}
            />
            <Text style={[styles.saveButtonText, saved && styles.saveButtonTextSaved]}>
              {saved ? t('searchSaved') : t('searchSaveMed')}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Core Info */}
      <View style={styles.card}>
        <DetailRow label={t('drugDetailNhiCode')} value={drug.nhi_code} />
        {ingredientPart ? <DetailRow label={t('drugDetailIngredient')} value={ingredientPart} /> : null}
        <DetailRow label={t('drugDetailDoseForm')} value={drug.dose_form} />
        {strengthPart ? <DetailRow label={t('drugDetailStrength')} value={strengthPart} /> : null}
        <DetailRow label={t('drugDetailAtc')} value={drug.atc_code} />
        {drug.is_combo != null ? (
          <DetailRow
            label={t('drugDetailCombo')}
            value={drug.is_combo ? t('drugDetailComboYes') : t('drugDetailComboNo')}
          />
        ) : null}
        {priceText ? <DetailRow label={t('drugDetailPrice')} value={priceText} /> : null}
        {dateRange ? <DetailRow label={t('drugDetailEffective')} value={dateRange} /> : null}
      </View>

      {/* Active Ingredients */}
      {activeIngredients.length > 0 ? (
        <View style={styles.card}>
          <SectionTitle>{t('drugDetailActiveIngredients')}</SectionTitle>
          {activeIngredients.map((ing, idx) => (
            <View key={`ing-${idx}`} style={styles.ingredientRow}>
              <Text style={styles.ingredientName}>{ing.name}</Text>
              {ing.strength_value != null && ing.strength_unit ? (
                <Text style={styles.ingredientStrength}>
                  {ing.strength_value}{ing.strength_unit}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* TFDA Link */}
      {drug.tfda_link ? (
        <Pressable
          style={styles.linkCard}
          onPress={() => Linking.openURL(drug.tfda_link!)}
        >
          <Ionicons color={colors.primary} name="open-outline" size={20} />
          <Text style={styles.linkText}>{t('drugDetailViewTfda')}</Text>
        </Pressable>
      ) : null}

      {!isStaffUser && drugSearchResult ? (
        <SaveToPlaylistModal
          visible={showSaveModal}
          drug={drugSearchResult}
          onSelectSaved={async () => {
            try {
              await saveMed(drugSearchResult);
              setSaved(true);
            } catch {
              // silently fail
            }
            setShowSaveModal(false);
          }}
          onSelectPlaylist={() => {
            setSaved(true);
            setShowSaveModal(false);
          }}
          onCancel={() => setShowSaveModal(false)}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
  detailRow: {
    gap: 2,
  },
  detailValue: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 26,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
    textAlign: 'center',
  },
  header: {
    gap: 4,
  },
  ingredientName: {
    color: colors.text,
    fontSize: typography.body,
    flex: 1,
    lineHeight: 26,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ingredientStrength: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  linkCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  linkText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '600',
    lineHeight: 26,
  },
  nameEn: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  nameZh: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  saveButton: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  saveButtonPressed: {
    opacity: 0.8,
  },
  saveButtonSaved: {
    backgroundColor: colors.primary,
  },
  saveButtonText: {
    color: colors.primary,
    fontSize: typography.label,
    fontWeight: '600',
  },
  saveButtonTextSaved: {
    color: colors.card,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: spacing.xs,
  },
});

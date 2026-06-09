import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { getCase, getMockAutoShareStatus } from '../api/case';
import { getCaseDdiByIngredients } from '../api/ddi';
import type { CasePageParams } from './navigationTypes';
import type { AutoShareStatus, CaseRecord, DetectedItem } from '../types/case';
import type { CaseDdiInteraction, CaseDdiResult } from '../types/ddi';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { normalizeOcrEnglishSpacing } from '../ocr/normalizeOcrEnglish';

type MedicationGroup = {
  title: string;
  matchStatus: 'matched' | 'unmatched' | 'other';
  confidence: number | null;
  items: DetectedItem[];
  lines: string[];
};

function looksMedicationRelated(text: string): boolean {
  if (/\\b\\d+(\\.\\d+)?\\s*(mcg|mg|g|ml|iu|%)\\b/i.test(text)) return true;
  if (/\\b(puff|puffs|bot|bottle)\\b/i.test(text)) return true;
  if (/\\([^)]*[A-Za-z][^)]*\\)/.test(text)) return true;
  if (/噴|吸入|錠|膠囊|滴眼|注射|溶液|懸浮|粉|顆粒|口服/.test(text)) return true;
  if (/[A-Za-z]/.test(text) && text.length >= 6) return true;
  return false;
}

function isMetaNoise(text: string): boolean {
  const normalized = text.replace(/\\s+/g, '').toLowerCase();
  const zhNoise = ['藥品資訊連結', '藥品查詢', '資訊連結'];
  for (const term of zhNoise) {
    if (normalized.includes(term)) return true;
  }
  const enNoise = [
    'quantity', 'use before', 'prescription', 'dispensing', 'pharmacist', 'physician',
    'indications', 'side effects', 'warnings', 'appearance', 'instruction',
  ];
  for (const term of enNoise) {
    if (normalized.includes(term)) return true;
  }
  return false;
}

function groupDetectedItemsForDisplay(detectedItems: DetectedItem[]): MedicationGroup[] {
  const matchedGroups = new Map<string, MedicationGroup>();
  const unmatchedItems: DetectedItem[] = [];

  for (const item of detectedItems) {
    if (item.matchStatus === 'matched' && item.ingredientId) {
      const existing = matchedGroups.get(item.ingredientId);
      if (existing) {
        existing.items.push(item);
        existing.lines.push(item.displayName);
        if (item.confidence !== null && (existing.confidence === null || item.confidence > existing.confidence)) {
          existing.confidence = item.confidence;
          existing.title = item.displayName;
        }
      } else {
        matchedGroups.set(item.ingredientId, {
          confidence: item.confidence,
          items: [item],
          lines: [item.displayName],
          matchStatus: 'matched',
          title: item.displayName,
        });
      }
    } else {
      unmatchedItems.push(item);
    }
  }

  const groups: MedicationGroup[] = [...matchedGroups.values()];

  if (unmatchedItems.length > 0) {
    const medRelated: DetectedItem[] = [];
    const otherLines: DetectedItem[] = [];

    for (const item of unmatchedItems) {
      if (looksMedicationRelated(item.displayName) && !isMetaNoise(item.displayName)) {
        medRelated.push(item);
      } else {
        otherLines.push(item);
      }
    }

    if (groups.length === 1) {
      for (const item of medRelated) {
        groups[0].items.push(item);
        groups[0].lines.push(item.displayName);
      }
      if (otherLines.length > 0) {
        groups.push({
          confidence: null,
          items: otherLines,
          lines: otherLines.map((item) => item.displayName),
          matchStatus: 'other',
          title: otherLines[0].displayName,
        });
      }
    } else if (medRelated.length > 0 || otherLines.length > 0) {
      const allRemaining = [...medRelated, ...otherLines];
      groups.push({
        confidence: null,
        items: allRemaining,
        lines: allRemaining.map((item) => item.displayName),
        matchStatus: 'unmatched',
        title: allRemaining[0].displayName,
      });
    }
  }

  return groups;
}

type Props = {
  route: RouteProp<{ CasePage: CasePageParams }, 'CasePage'>;
};

export function CasePageScreen({ route }: Props) {
  const { t } = useTranslation();
  const { caseId } = route.params;
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [autoShareStatus, setAutoShareStatus] = useState<AutoShareStatus | null>(null);
  const [ddiResult, setDdiResult] = useState<CaseDdiResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadCasePageData() {
      setIsLoading(true);
      setLoadError('');

      try {
        const [loadedCase, shareStatus] = await Promise.all([
          getCase(caseId),
          getMockAutoShareStatus(),
        ]);
        const ddi = await getCaseDdiByIngredients(loadedCase.ingredientIds);

        if (!isMounted) {
          return;
        }

        setCaseRecord(loadedCase);
        setAutoShareStatus(shareStatus);
        setDdiResult(ddi);
      } catch {
        if (!isMounted) {
          return;
        }
        setLoadError(t('casePageLoadError'));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadCasePageData();

    return () => {
      isMounted = false;
    };
  }, [caseId, t]);

  const shareCountText = useMemo(() => {
    return t('casePageSharedToCount', {
      count: autoShareStatus?.sharedCareTeamCount ?? 0,
    });
  }, [autoShareStatus?.sharedCareTeamCount, t]);

  const medicationGroups = useMemo(
    () => groupDetectedItemsForDisplay(caseRecord?.detectedItems ?? []),
    [caseRecord?.detectedItems],
  );

  const ingredientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ing of ddiResult?.checked_ingredients ?? []) {
      map.set(ing.ingredient_id, ing.canonical_name);
    }
    return map;
  }, [ddiResult?.checked_ingredients]);

  const shouldShowUncheckedBanner = (ddiResult?.unchecked_ingredient_count ?? 0) > 0;
  const shouldShowCoverageGap =
    (caseRecord?.detectedItems.length ?? 0) > 0 && (caseRecord.ingredientIds.length === 0 || shouldShowUncheckedBanner);
  const shouldShowNoInteractions =
    ddiResult?.interactions_found_count === 0 && !shouldShowCoverageGap;
  const createdAtLabel = caseRecord ? new Date(caseRecord.createdAt).toLocaleString() : t('casePageCreatedPlaceholder');

  const renderInteractionCard = (interaction: CaseDdiInteraction) => {
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
  };

  function filterInstructionLines(lines: string[]): string[] {
    const headers = new Set(
      [
        'instruction', 'indications', 'side effects', 'warnings', 'appearance',
        'medication', 'quantity', 'use before',
        '用法', '用途', '副作用', '警語', '外觀', '藥名', '總量', '處方期限', '領藥號', '調劑日期',
      ].map((h) => h.toLowerCase()),
    );
    return lines.filter(
      (line) => !headers.has(line.trim().toLowerCase()),
    );
  }

  const renderDetectedItemsSection = () => {
    const medGroups = medicationGroups.filter((g) => g.matchStatus !== 'other');
    const otherGroups = medicationGroups.filter((g) => g.matchStatus === 'other');

    return (
      <>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('casePageDetectedItemsTitle')}</Text>
          {medGroups.map((group, groupIdx) => renderGroupCard(group, groupIdx, ingredientNameMap))}
        </View>
        {otherGroups.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('casePageOtherExtractedTitle')}</Text>
            {otherGroups.map((group, groupIdx) => renderGroupCard(group, groupIdx, ingredientNameMap))}
          </View>
        ) : null}
      </>
    );
  };

  const renderGroupCard = (group: MedicationGroup, groupIdx: number, nameMap: Map<string, string>) => {
    const badgeLabel = group.matchStatus === 'other'
      ? t('casePageMatchStatus.unmatched')
      : t(`casePageMatchStatus.${group.matchStatus}`);
    const badgeStyle = group.matchStatus === 'matched' ? styles.matchedBadge : styles.unmatchedBadge;
    const badgeTextStyle = group.matchStatus === 'matched' ? styles.matchedBadgeText : styles.unmatchedBadgeText;

    const allIngredientIds = new Set<string>();
    for (const item of group.items) {
      if (item.ingredientIds) {
        for (const id of item.ingredientIds) {
          allIngredientIds.add(id);
        }
      } else if (item.ingredientId) {
        allIngredientIds.add(item.ingredientId);
      }
    }
    const activeIngredientNames = Array.from(allIngredientIds)
      .map((id) => nameMap.get(id))
      .filter((name): name is string => !!name);

    return (
      <View key={`group-${group.matchStatus}-${groupIdx}`} style={styles.itemCard}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.itemTitle}>{norm(group.title)}</Text>
          <View style={[styles.matchBadge, badgeStyle]}>
            <Text style={[styles.matchBadgeText, badgeTextStyle]}>{badgeLabel}</Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          {group.confidence !== null ? (
            <View style={styles.confidenceBadge}>
              <Text style={styles.confidenceBadgeText}>
                {t('casePageConfidenceLabel', {
                  value: Math.round(group.confidence * 100),
                })}
              </Text>
            </View>
          ) : (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{t('casePageConfidencePending')}</Text>
            </View>
          )}
        </View>
        {activeIngredientNames.length > 0 ? (
          <View style={styles.ingredientRow}>
            <Text style={styles.ingredientLabel}>{t('casePageActiveIngredientsLabel')}</Text>
            <Text style={styles.ingredientValue}>{activeIngredientNames.join(', ')}</Text>
          </View>
        ) : null}
        {group.lines.length > 1 ? (
          <View style={styles.linesList}>
            {group.lines.slice(0, 5).map((line, lineIdx) => (
              <Text key={`line-${groupIdx}-${lineIdx}`} style={styles.lineItem}>
                {norm(line)}
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={styles.metaText}>{t('casePageDoctorNoteLabel')}</Text>
        <Text style={styles.itemBody}>{t('casePageDoctorNotePlaceholder')}</Text>
      </View>
    );
  };

  const norm = (text: string) => normalizeOcrEnglishSpacing(text);

  const renderCaseSummary = () => {
    const fields = caseRecord?.ocrSections.caseFields;
    if (!fields) return null;

    const hasAnyField =
      fields.patientName ||
      fields.patientSex ||
      fields.quantity ||
      fields.dispensingDate ||
      (fields.indications && fields.indications.length > 0) ||
      (fields.warnings && fields.warnings.length > 0) ||
      (fields.sideEffects && fields.sideEffects.length > 0) ||
      fields.pharmacyName ||
      fields.pharmacyAddress ||
      fields.pharmacistName ||
      (fields.brandNames && fields.brandNames.length > 0);

    if (!hasAnyField) return null;

    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('caseSummaryTitle')}</Text>

        {fields.patientName ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('caseSummaryPatientName')}</Text>
            <Text style={styles.fieldValue}>{fields.patientName}</Text>
          </View>
        ) : null}

        {fields.patientSex ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('caseSummarySexLabel')}</Text>
            <Text style={styles.fieldValue}>
              {t(fields.patientSex === 'M' ? 'caseSummarySexMale' : 'caseSummarySexFemale')}
            </Text>
          </View>
        ) : null}

        {fields.quantity ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('caseSummaryQuantity')}</Text>
            <Text style={styles.fieldValue}>{fields.quantity}</Text>
          </View>
        ) : null}

        {fields.dispensingDate ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('caseSummaryDispensingDateLabel')}</Text>
            <Text style={styles.fieldValue}>{fields.dispensingDate}</Text>
          </View>
        ) : null}

        {fields.indications && fields.indications.length > 0 ? (
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t('caseSummaryIndications')}</Text>
            {fields.indications.map((line, idx) => (
              <Text key={`ind-${idx}`} style={styles.fieldValue}>{norm(line)}</Text>
            ))}
          </View>
        ) : null}

        {fields.warnings && fields.warnings.length > 0 ? (
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t('caseSummaryWarnings')}</Text>
            {fields.warnings.map((line, idx) => (
              <Text key={`warn-${idx}`} style={styles.fieldValue}>{norm(line)}</Text>
            ))}
          </View>
        ) : null}

        {fields.sideEffects && fields.sideEffects.length > 0 ? (
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t('caseSummarySideEffects')}</Text>
            {fields.sideEffects.map((line, idx) => (
              <Text key={`se-${idx}`} style={styles.fieldValue}>{norm(line)}</Text>
            ))}
          </View>
        ) : null}

        {fields.brandNames && fields.brandNames.length > 0 ? (
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t('caseSummaryBrandNameLabel')}</Text>
            {fields.brandNames.map((name, idx) => (
              <Text key={`brand-${idx}`} style={styles.fieldValue}>{norm(name)}</Text>
            ))}
          </View>
        ) : null}

        {fields.pharmacyName ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('caseSummaryPharmacyName')}</Text>
            <Text style={styles.fieldValue}>{norm(fields.pharmacyName)}</Text>
          </View>
        ) : null}

        {fields.pharmacyAddress ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('caseSummaryPharmacyAddress')}</Text>
            <Text style={styles.fieldValue}>{fields.pharmacyAddress}</Text>
          </View>
        ) : null}

        {fields.pharmacistName ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t('caseSummaryPharmacistLabel')}</Text>
            <Text style={styles.fieldValue}>{fields.pharmacistName}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  if (isLoading && !caseRecord) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('casePageTitle')}</Text>
          <Text style={styles.subtitle}>{t('casePageLoading')}</Text>
        </View>
      </ScrollView>
    );
  }

  if (!caseRecord) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('casePageTitle')}</Text>
          <Text style={styles.warningText}>{loadError || t('casePageLoadError')}</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('casePageTitle')}</Text>
        <Text style={styles.subtitle}>{createdAtLabel}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('selectedPhotos')}</Text>
        <View style={styles.photoGrid}>
          {caseRecord.photoUrls.map((photoUrl, index) => (
            <Image key={`${caseRecord.caseId}-${index}`} source={{ uri: photoUrl }} style={styles.photo} />
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('casePageAutoShareTitle')}</Text>
        <Text style={styles.body}>
          {caseRecord.shareToAllCareTeams ? t('casePageAutoShareDefaultOn') : t('casePageAutoShareDefaultOff')}
        </Text>
        <Text style={styles.subtitle}>{shareCountText}</Text>
      </View>

      {renderCaseSummary()}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('casePageOcrSectionTitle')}</Text>
        <ScrollView nestedScrollEnabled style={styles.rawTextBox}>
          <Text style={styles.rawText}>{caseRecord.ocrRawText || t('ocrEmptyState')}</Text>
        </ScrollView>
      </View>

      {caseRecord.ocrSections.instructionLines.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('casePageInstructionTitle')}</Text>
          <Text style={styles.body}>
            {filterInstructionLines(caseRecord.ocrSections.instructionLines).join('\n')}
          </Text>
        </View>
      ) : null}

      {renderDetectedItemsSection()}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('casePageDdiTitle')}</Text>
        {shouldShowCoverageGap ? (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>{t('casePageDdiUncheckedWarning')}</Text>
          </View>
        ) : null}
        {ddiResult?.interactions_found_count ? ddiResult.interactions.map(renderInteractionCard) : null}
        {shouldShowNoInteractions ? <Text style={styles.body}>{t('casePageNoInteractions')}</Text> : null}
        <Text style={styles.disclaimerText}>
          {ddiResult?.coverage_disclaimer_en ?? t('casePageCoverageDisclaimerFallback')}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
  },
  fieldRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: spacing.xs,
  },
  fieldBlock: {
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '600',
    minWidth: 80,
  },
  fieldValue: {
    color: colors.text,
    fontSize: typography.body,
    flexShrink: 1,
    lineHeight: 24,
  },
  cardHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photo: {
    backgroundColor: colors.border,
    borderRadius: radius.md,
    height: 120,
    width: '47%',
  },
  rawTextBox: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    maxHeight: 220,
    minHeight: 140,
    padding: spacing.md,
  },
  rawText: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 28,
  },
  itemCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    gap: spacing.xs,
    padding: spacing.md,
  },
  itemTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    flex: 1,
  },
  itemBody: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
  linesList: {
    backgroundColor: colors.border + '40',
    borderRadius: radius.md,
    gap: 2,
    padding: spacing.sm,
  },
  lineItem: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 24,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  ingredientRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: spacing.xs,
  },
  ingredientLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '600',
  },
  ingredientValue: {
    color: colors.text,
    fontSize: typography.label,
    flexShrink: 1,
    lineHeight: 24,
  },
  matchBadge: {
    borderRadius: radius.pill,
    minHeight: 36,
    minWidth: 88,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  matchedBadge: {
    backgroundColor: '#E3F9E5',
  },
  unmatchedBadge: {
    backgroundColor: colors.warningBackground,
  },
  matchBadgeText: {
    fontSize: typography.label,
    fontWeight: '700',
    textAlign: 'center',
  },
  matchedBadgeText: {
    color: '#207227',
  },
  unmatchedBadgeText: {
    color: colors.warningText,
  },
  confidenceBadge: {
    backgroundColor: '#E9F2FF',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  confidenceBadgeText: {
    color: colors.primary,
    fontSize: typography.label,
    fontWeight: '700',
  },
  pendingBadge: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pendingBadgeText: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '700',
  },
  metaText: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
  warningBanner: {
    backgroundColor: colors.warningBackground,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  ingredientPairText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    lineHeight: 26,
  },
  interactionCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    gap: spacing.sm,
    padding: spacing.md,
  },
  severityBadge: {
    borderRadius: radius.pill,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  majorBadge: {
    backgroundColor: '#FDE8E8',
  },
  moderateBadge: {
    backgroundColor: '#FFF4D6',
  },
  minorBadge: {
    backgroundColor: '#E6FFFA',
  },
  severityBadgeText: {
    fontSize: typography.label,
    fontWeight: '700',
    textAlign: 'center',
  },
  majorBadgeText: {
    color: '#B42318',
  },
  moderateBadgeText: {
    color: colors.warningText,
  },
  minorBadgeText: {
    color: '#046C4E',
  },
  disclaimerText: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
});

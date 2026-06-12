import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { getCase, getCaseGroupCases, renameCase } from '../api/case';
import { getCaseDdiByIngredients } from '../api/ddi';
import { addToPlaylist } from '../api/playlists';
import type { DrugSearchResult } from '../api/drugs';
import { SaveToPlaylistModal } from '../playlists/SaveToPlaylistModal';
import { ShareHospitalModal } from '../careteams/ShareHospitalModal';
import type { CasePageParams } from './navigationTypes';
import type { CaseRecord, DetectedItem } from '../types/case';
import type { CaseDdiInteraction, CaseDdiResult } from '../types/ddi';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { normalizeOcrEnglishSpacing } from '../ocr/normalizeOcrEnglish';

type PhotoModalState = { visible: boolean; index: number };

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
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [ddiResult, setDdiResult] = useState<CaseDdiResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [photoModal, setPhotoModal] = useState<PhotoModalState>({ visible: false, index: 0 });
  const [playlistModalDrug, setPlaylistModalDrug] = useState<DrugSearchResult | null>(null);
  const [playlistModalDrugs, setPlaylistModalDrugs] = useState<DrugSearchResult[] | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [caseNameInput, setCaseNameInput] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadCasePageData() {
      setIsLoading(true);
      setLoadError('');

      try {
        const loadedCase = await getCase(caseId);

        let mergedCase = loadedCase;

        if (loadedCase.caseGroupId) {
          const groupCases = await getCaseGroupCases(loadedCase.caseGroupId);

          if (groupCases.length > 0) {
            const allDetectedItems = groupCases.flatMap((c) => c.detectedItems);
            const allIngredientIds = groupCases.flatMap((c) => c.ingredientIds);
            const allPhotoUrls = groupCases.flatMap((c) => c.photoUrls);
            const allThumbUrls = groupCases.flatMap((c) => c.thumbUrls);
            const allPhotoPaths = groupCases.flatMap((c) => c.photoPaths);

            const seenIds = new Set<string>();
            const dedupedItems = allDetectedItems.filter((item) => {
              if (item.matchStatus === 'matched' && item.ingredientId) {
                if (seenIds.has(item.ingredientId)) return false;
                seenIds.add(item.ingredientId);
              }
              return true;
            });

            mergedCase = {
              ...loadedCase,
              detectedItems: dedupedItems,
              ingredientIds: Array.from(new Set(allIngredientIds)),
              photoUrls: allPhotoUrls,
              thumbUrls: allThumbUrls,
              photoPaths: allPhotoPaths,
            };
          }
        }

        const ddi = await getCaseDdiByIngredients(mergedCase.ingredientIds);

        if (!isMounted) {
          return;
        }

        setCaseRecord(mergedCase);
        setDdiResult(ddi);

        if (!mergedCase.caseName) {
          const medicationName = mergedCase.ocrSections?.remoteModel?.case_fields?.medicationName;
          const dateStr = new Date(mergedCase.createdAt).toLocaleDateString();
          setCaseNameInput(medicationName?.trim() || `${t('caseUntitled')} ${dateStr}`);
          setShowNameModal(true);
        }
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
          <View style={styles.headerBadges}>
            <View style={[styles.matchBadge, badgeStyle]}>
              <Text style={[styles.matchBadgeText, badgeTextStyle]}>{badgeLabel}</Text>
            </View>
            <Pressable
              onPress={() =>
                handleAddSingleToPlaylist({
                  ...group.items[0],
                  displayName: group.title,
                })
              }
              style={({ pressed }) => [styles.addItemButton, pressed && styles.addItemButtonPressed]}
            >
              <Ionicons color={colors.primary} name="add-circle-outline" size={20} />
            </Pressable>
          </View>
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

  const openPhotoModal = useCallback((index: number) => {
    setPhotoModal({ visible: true, index });
  }, []);

  const closePhotoModal = useCallback(() => {
    setPhotoModal({ visible: false, index: 0 });
  }, []);

  const handleAddAllToPlaylist = useCallback(() => {
    const items = caseRecord?.detectedItems ?? [];
    if (items.length === 0) return;
    const drugs: DrugSearchResult[] = items.map((item) => ({
      nhi_code: item.nhiCode ?? '',
      name_en: item.displayName,
      name_zh: null,
      ingredient_text: null,
      atc_code: null,
      dose_form: null,
      strength_value: null,
      strength_unit: null,
      relevance: 1,
    }));
    setPlaylistModalDrugs(drugs);
    setPlaylistModalDrug(null);
  }, [caseRecord?.detectedItems]);

  const handleAddSingleToPlaylist = useCallback((item: DetectedItem) => {
    setPlaylistModalDrug({
      nhi_code: item.nhiCode ?? '',
      name_en: item.displayName,
      name_zh: null,
      ingredient_text: null,
      atc_code: null,
      dose_form: null,
      strength_value: null,
      strength_unit: null,
      relevance: 1,
    });
    setPlaylistModalDrugs(null);
  }, []);

  const renderPhotoStrip = () => {
    const urls = caseRecord?.photoUrls ?? [];
    if (urls.length === 0) return null;

    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          {t('casePagePhotoTitle', { count: urls.length })}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
          {urls.map((photoUrl, idx) => (
            <Pressable key={`thumb-${idx}`} onPress={() => openPhotoModal(idx)}>
              <View style={styles.thumbnailWrapper}>
                <Image source={{ uri: photoUrl }} style={styles.thumbnail} />
                {urls.length > 1 ? (
                  <View style={styles.thumbnailBadge}>
                    <Text style={styles.thumbnailBadgeText}>{idx + 1}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderPhotoModal = () => {
    const urls = caseRecord?.photoUrls ?? [];
    if (!photoModal.visible || urls.length === 0) return null;

    const currentUrl = urls[photoModal.index];

    return (
      <Modal visible={photoModal.visible} transparent animationType="fade" onRequestClose={closePhotoModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalCloseButton} onPress={closePhotoModal}>
            <Text style={styles.modalCloseText}>✕</Text>
          </Pressable>
          <View style={styles.modalImageContainer}>
            <Image source={{ uri: currentUrl }} style={styles.modalImage} resizeMode="contain" />
          </View>
          {photoModal.index > 0 ? (
            <Pressable style={[styles.modalNav, styles.modalNavLeft]} onPress={() => openPhotoModal(photoModal.index - 1)}>
              <Text style={styles.modalNavText}>‹</Text>
            </Pressable>
          ) : null}
          {photoModal.index < urls.length - 1 ? (
            <Pressable style={[styles.modalNav, styles.modalNavRight]} onPress={() => openPhotoModal(photoModal.index + 1)}>
              <Text style={styles.modalNavText}>›</Text>
            </Pressable>
          ) : null}
          <Text style={styles.modalCounter}>
            {photoModal.index + 1} / {urls.length}
          </Text>
        </View>
      </Modal>
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
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.card}>
          <Text style={styles.title}>{caseRecord.caseName || t('casePageTitle')}</Text>
          <Text style={styles.subtitle}>{createdAtLabel}</Text>
        </View>

        {renderCaseSummary()}

        {(caseRecord?.detectedItems.length ?? 0) > 0 ? (
          <Pressable
            onPress={handleAddAllToPlaylist}
            style={({ pressed }) => [styles.playlistButton, pressed && styles.playlistButtonPressed]}
          >
            <Ionicons color={colors.primary} name="medical" size={20} />
            <Text style={styles.playlistButtonText}>{t('casePageAddAllToPlaylist')}</Text>
          </Pressable>
        ) : null}

        {renderPhotoStrip()}

        <Pressable
          onPress={() => setShareModalVisible(true)}
          style={({ pressed }) => [styles.playlistButton, pressed && styles.playlistButtonPressed]}
        >
          <Ionicons color={colors.primary} name="share-outline" size={20} />
          <Text style={styles.playlistButtonText}>{t('casePageShareButton')}</Text>
        </Pressable>

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
      {renderPhotoModal()}
      {playlistModalDrug ? (
        <SaveToPlaylistModal
          visible
          drug={playlistModalDrug}
          onSelectSaved={() => setPlaylistModalDrug(null)}
          onSelectPlaylist={() => setPlaylistModalDrug(null)}
          onCancel={() => setPlaylistModalDrug(null)}
        />
      ) : null}
      {playlistModalDrugs && playlistModalDrugs.length > 0 ? (
        <SaveToPlaylistModal
          visible
          drugs={playlistModalDrugs}
          onSelectSaved={() => setPlaylistModalDrugs(null)}
          onSelectPlaylist={() => setPlaylistModalDrugs(null)}
          onCancel={() => setPlaylistModalDrugs(null)}
        />
      ) : null}
      <ShareHospitalModal
        visible={shareModalVisible}
        recordType="case"
        recordId={caseId}
        onClose={() => setShareModalVisible(false)}
      />
      <Modal visible={showNameModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNameModal(false)}>
        <View style={styles.nameModal}>
          <View style={styles.nameModalHeader}>
            <Text style={styles.nameModalTitle}>{t('nameCaseTitle')}</Text>
          </View>
          <View style={styles.nameModalBody}>
            <TextInput
              style={styles.nameModalInput}
              value={caseNameInput}
              onChangeText={setCaseNameInput}
              placeholder={t('nameCasePlaceholder')}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.nameModalButtons}>
              <Pressable
                onPress={() => {
                  setShowNameModal(false);
                }}
                style={({ pressed }) => [styles.nameModalButton, styles.nameModalSkipButton, pressed && styles.nameModalButtonPressed]}
              >
                <Text style={styles.nameModalSkipText}>{t('nameCaseSkip')}</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const name = caseNameInput.trim();
                  if (!name) {
                    setShowNameModal(false);
                    return;
                  }
                  try {
                    await renameCase(caseId, name);
                    setCaseRecord((prev) => (prev ? { ...prev, caseName: name } : prev));
                  } catch {
                    // silently fail
                  }
                  setShowNameModal(false);
                }}
                style={({ pressed }) => [styles.nameModalButton, styles.nameModalSaveButton, pressed && styles.nameModalButtonPressed]}
              >
                <Text style={styles.nameModalSaveText}>{t('nameCaseSave')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  photoStrip: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  thumbnailWrapper: {
    borderRadius: 8,
    marginRight: spacing.sm,
    position: 'relative',
  },
  thumbnail: {
    backgroundColor: colors.border,
    borderRadius: 8,
    height: 80,
    width: 80,
  },
  thumbnailBadge: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    left: -4,
    position: 'absolute',
    top: -4,
    width: 24,
  },
  thumbnailBadgeText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.95)',
    flex: 1,
    justifyContent: 'center',
  },
  modalCloseButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.lg,
    top: 50,
    width: 40,
    zIndex: 10,
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  modalImageContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  modalImage: {
    height: '100%',
    maxHeight: '80%',
    width: '100%',
  },
  modalNav: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    top: '50%',
    width: 48,
  },
  modalNavLeft: {
    left: spacing.md,
    marginTop: -24,
  },
  modalNavRight: {
    marginTop: -24,
    right: spacing.md,
  },
  modalNavText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
  },
  modalCounter: {
    alignSelf: 'center',
    bottom: 60,
    color: '#FFFFFF',
    fontSize: typography.body,
    fontWeight: '600',
    position: 'absolute',
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
  playlistButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  playlistButtonPressed: {
    opacity: 0.8,
  },
  playlistButtonText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '600',
    lineHeight: 26,
  },
  headerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addItemButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E9F2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addItemButtonPressed: {
    opacity: 0.7,
  },
  nameModal: {
    backgroundColor: colors.background,
    flex: 1,
  },
  nameModalHeader: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  nameModalTitle: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  nameModalBody: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  nameModalInput: {
    backgroundColor: colors.card,
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    color: colors.text,
    fontSize: typography.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  nameModalButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  nameModalButton: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  nameModalSaveButton: {
    backgroundColor: colors.primary,
  },
  nameModalSkipButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  nameModalButtonPressed: {
    opacity: 0.8,
  },
  nameModalSaveText: {
    color: '#FFFFFF',
    fontSize: typography.body,
    fontWeight: '600',
  },
  nameModalSkipText: {
    color: colors.textMuted,
    fontSize: typography.body,
    fontWeight: '600',
  },
});

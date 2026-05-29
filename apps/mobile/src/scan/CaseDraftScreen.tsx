import React, { useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { createCase } from '../api/case';
import { mapOcrSections, type SectionedOcr } from '../ocr/sectionMapper';
import { isOcrUnavailableError, runOcrOnImagesStructured } from '../ocr/ocr';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { ScanStackParamList } from './types';

type Props = NativeStackScreenProps<ScanStackParamList, 'CaseDraft'>;

export function CaseDraftScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { photos } = route.params;
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [rawText, setRawText] = useState('');
  const [ocrAttempted, setOcrAttempted] = useState(false);
  const [friendlyMessage, setFriendlyMessage] = useState('');
  const [isSavingCase, setIsSavingCase] = useState(false);
  const [sectionedOcr, setSectionedOcr] = useState<SectionedOcr | undefined>(undefined);
  const ocrInFlight = useRef(false);

  const photoUris = useMemo(() => photos.map((photo) => photo.uri), [photos]);

  const getOcrErrorMessage = (error: unknown): string => {
    if (isOcrUnavailableError(error) && error instanceof Error) {
      if (error.message === 'OCR server not configured') {
        return t('ocrServerNotConfigured');
      }
      if (error.message === 'OCR server API key not configured') {
        return t('ocrServerApiKeyNotConfigured');
      }
      return t('ocrServerUnavailable');
    }
    return t('ocrFriendlyError');
  };

  const handleRunOcr = async () => {
    if (ocrInFlight.current) return;
    ocrInFlight.current = true;

    if (__DEV__) console.log('[OCR] run count CaseDraft');

    setIsRunningOcr(true);
    setFriendlyMessage('');
    try {
      const structured = await runOcrOnImagesStructured(photoUris);
      setRawText(structured.text);
      setSectionedOcr(structured.blocks.length > 0 ? mapOcrSections(structured) : undefined);
      setOcrAttempted(true);
      if (!structured.text.trim()) {
        setFriendlyMessage(t('ocrFriendlyError'));
      }
    } catch (error) {
      setRawText('');
      setSectionedOcr(undefined);
      if (isOcrUnavailableError(error)) {
        setOcrAttempted(false);
        setFriendlyMessage(getOcrErrorMessage(error));
      } else {
        setOcrAttempted(true);
        setFriendlyMessage(t('ocrFriendlyError'));
      }
    } finally {
      setIsRunningOcr(false);
      ocrInFlight.current = false;
    }
  };

  const handleCreateCase = async () => {
    setIsSavingCase(true);
    setFriendlyMessage('');

    try {
      const { caseId } = await createCase({
        caseType: 'medicine_bag',
        ingredientIds: [],
        ocrRawText: rawText,
        photoUris,
        sectionedOcr,
      });

      navigation.navigate('CasePage', { caseId });
    } catch (error) {
      console.error('[CaseDraft] createCase failed', error);
      setFriendlyMessage(t('caseDraftSaveError'));
    } finally {
      setIsSavingCase(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('caseDraftTitle')}</Text>
        <Text style={styles.subtitle}>{t('caseDraftSubtitle')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('selectedPhotos')}</Text>
        <View style={styles.photoGrid}>
          {photos.map((photo) => (
            <Image key={photo.id} source={{ uri: photo.uri }} style={styles.photo} />
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('caseDraftRawTextLabel')}</Text>
        <Pressable
          onPress={() => void handleRunOcr()}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
        >
          <Text style={styles.primaryButtonText}>{isRunningOcr ? t('ocrRunning') : t('runOcr')}</Text>
        </Pressable>
        {friendlyMessage ? <Text style={styles.warningText}>{friendlyMessage}</Text> : null}
        {ocrAttempted ? (
          <ScrollView nestedScrollEnabled style={styles.rawTextBox}>
            <Text style={styles.body}>{rawText || t('ocrEmptyState')}</Text>
          </ScrollView>
        ) : null}
        {ocrAttempted && !isRunningOcr ? (
          <Pressable
            onPress={() => void handleCreateCase()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          >
            <Text style={styles.primaryButtonText}>{isSavingCase ? t('caseCreating') : t('createCasePage')}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('caseDraftDetectedItemsLabel')}</Text>
        <Text style={styles.body}>1. {t('caseDraftDetectedItemOne')}</Text>
        <Text style={styles.body}>2. {t('caseDraftDetectedItemTwo')}</Text>
        <Text style={styles.body}>{t('caseDraftNextStep')}</Text>
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
  body: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 28,
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
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 60,
    paddingHorizontal: spacing.md,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryPressed,
    opacity: 0.92,
  },
  primaryButtonText: {
    color: colors.card,
    fontSize: typography.body,
    fontWeight: '700',
  },
  warningText: {
    color: colors.warningText,
    fontSize: typography.label,
    fontWeight: '600',
    lineHeight: 24,
  },
});

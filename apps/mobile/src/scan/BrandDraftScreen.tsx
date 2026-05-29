import React, { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { isOcrUnavailableError, runOcrOnImages } from '../ocr/ocr';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { ScanStackParamList } from './types';

type Props = NativeStackScreenProps<ScanStackParamList, 'BrandDraft'>;

export function BrandDraftScreen({ route }: Props) {
  const { t } = useTranslation();
  const { photo } = route.params;
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [rawText, setRawText] = useState('');
  const [ocrAttempted, setOcrAttempted] = useState(false);
  const [friendlyMessage, setFriendlyMessage] = useState('');
  const [showResult, setShowResult] = useState(false);
  const ocrInFlight = useRef(false);

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

    setIsRunningOcr(true);
    setFriendlyMessage('');
    try {
      const extracted = await runOcrOnImages([photo.uri]);
      setRawText(extracted);
      setOcrAttempted(true);
      if (!extracted.trim()) {
        setFriendlyMessage(t('ocrFriendlyError'));
      }
    } catch (error) {
      setRawText('');
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

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('brandDraftTitle')}</Text>
        <Text style={styles.subtitle}>{t('brandDraftSubtitle')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('selectedPhotos')}</Text>
        <Image source={{ uri: photo.uri }} style={styles.photo} />
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
        {ocrAttempted && !isRunningOcr && !showResult ? (
          <Pressable
            onPress={() => setShowResult(true)}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          >
            <Text style={styles.primaryButtonText}>{t('viewResult')}</Text>
          </Pressable>
        ) : null}
      </View>

      {showResult ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('brandDraftResultLabel')}</Text>
          <Text style={styles.body}>{t('brandDraftPlaceholderResult')}</Text>
          <Text style={styles.body}>{t('brandDraftNextStep')}</Text>
        </View>
      ) : null}
      
      {showResult ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('casePageDetectedItemsTitle')}</Text>
          <Text style={styles.body}>{t('brandResultDetectedItem')}</Text>
        </View>
      ) : null}
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
  photo: {
    backgroundColor: colors.border,
    borderRadius: radius.md,
    height: 180,
    width: '100%',
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

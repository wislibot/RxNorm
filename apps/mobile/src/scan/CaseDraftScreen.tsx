import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { createCase } from '../api/case';
import { mapOcrSections } from '../ocr/sectionMapper';
import { isOcrUnavailableError, runOcrOnImagesStructured } from '../ocr/ocr';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { ScanStackParamList } from './types';

type Props = NativeStackScreenProps<ScanStackParamList, 'CaseDraft'>;

export function CaseDraftScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { photos } = route.params;
  const [isProcessing, setIsProcessing] = useState(false);
  const [friendlyMessage, setFriendlyMessage] = useState('');
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

  const handleCreateCase = async () => {
    if (ocrInFlight.current) return;
    ocrInFlight.current = true;

    setIsProcessing(true);
    setFriendlyMessage('');

    try {
      // Step 1: Run OCR
      const structured = await runOcrOnImagesStructured(photoUris);
      const rawText = structured.text;
      const sectionedOcr = structured.blocks.length > 0 ? mapOcrSections(structured) : undefined;
      const perPhotoOcrResults = structured.perPhoto;

      if (!rawText.trim()) {
        setFriendlyMessage(t('ocrFriendlyError'));
        setIsProcessing(false);
        ocrInFlight.current = false;
        return;
      }

      // Step 2: Create case
      const { caseId } = await createCase({
        caseType: 'medicine_bag',
        ingredientIds: [],
        ocrRawText: rawText,
        photoUris,
        sectionedOcr,
        perPhotoOcrResults,
      });

      navigation.navigate('CasePage', { caseId });
    } catch (error) {
      console.error('[CaseDraft] failed', error);
      if (isOcrUnavailableError(error)) {
        setFriendlyMessage(getOcrErrorMessage(error));
      } else {
        setFriendlyMessage(t('caseDraftSaveError'));
      }
    } finally {
      setIsProcessing(false);
      ocrInFlight.current = false;
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
        {friendlyMessage ? <Text style={styles.warningText}>{friendlyMessage}</Text> : null}

        <Pressable
          onPress={() => void handleCreateCase()}
          disabled={isProcessing}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            isProcessing && styles.primaryButtonDisabled,
          ]}
        >
          {isProcessing ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.card} size="small" />
              <Text style={styles.primaryButtonText}>{t('caseCreating')}</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>{t('createCasePage')}</Text>
          )}
        </Pressable>
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
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: colors.card,
    fontSize: typography.body,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  warningText: {
    color: colors.warningText,
    fontSize: typography.label,
    fontWeight: '600',
    lineHeight: 24,
  },
});

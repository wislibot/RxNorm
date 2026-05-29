import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { listCases } from '../api/case';
import type { MyMedsStackParamList } from './navigationTypes';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { CaseSummary } from '../types/case';

type Props = NativeStackScreenProps<MyMedsStackParamList, 'CaseHistory'>;

export function CaseHistoryScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadCases() {
      try {
        const result = await listCases({ limit: 20 });
        if (mounted) {
          setCases(result);
        }
      } catch {
        if (mounted) {
          setLoadError(t('scanHistoryLoadError'));
        }
      }
    }

    void loadCases();

    return () => {
      mounted = false;
    };
  }, [t]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.headerCard}>
        <Text style={styles.title}>{t('scanHistoryTitle')}</Text>
        <Text style={styles.subtitle}>{t('scanHistorySubtitle')}</Text>
      </View>

      {loadError ? (
        <View style={styles.card}>
          <Text style={styles.warningText}>{loadError}</Text>
        </View>
      ) : null}

      {cases.map((item) => (
        <Pressable
          key={item.caseId}
          onPress={() => navigation.navigate('CasePage', { caseId: item.caseId })}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          {item.firstThumbUrl || item.firstPhotoUrl ? (
            <Image source={{ uri: (item.firstThumbUrl || item.firstPhotoUrl) as string }} style={styles.photo} />
          ) : null}
          <Text style={styles.caseType}>{t(`caseType.${item.caseType}`)}</Text>
          <Text style={styles.metaText}>{new Date(item.createdAt).toLocaleString()}</Text>
          <Text style={styles.previewText}>{item.ocrPreview || t('scanHistoryNoPreview')}</Text>
          <Text style={styles.metaText}>{t('scanHistoryDetectedCount', { count: item.detectedItemCount })}</Text>
        </Pressable>
      ))}
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
  headerCard: {
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
    lineHeight: 28,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  cardPressed: {
    opacity: 0.9,
  },
  photo: {
    borderRadius: radius.md,
    height: 140,
    width: '100%',
  },
  caseType: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
  },
  metaText: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
  previewText: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 28,
  },
  warningText: {
    color: colors.warningText,
    fontSize: typography.body,
    lineHeight: 28,
  },
});

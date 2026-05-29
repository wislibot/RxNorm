import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { ScanStackParamList } from '../scan/types';
import { colors, radius, spacing, typography } from '../theme/tokens';

type Props = NativeStackScreenProps<ScanStackParamList, 'HomeScanLanding'>;

export function HomeScanScreen({ navigation }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.page}>
      <Text style={styles.kicker}>{t('homeWelcome')}</Text>
      <Text style={styles.title}>{t('homeTitle')}</Text>
      <Text style={styles.subtitle}>{t('homeSubtitle')}</Text>

      <Pressable
        onPress={() => navigation.navigate('MedicineBagCapture')}
        style={({ pressed }) => [styles.cardButton, pressed && styles.cardButtonPressed]}
      >
        <Text style={styles.cardTitle}>{t('medicineBag')}</Text>
        <Text style={styles.cardBody}>{t('medicineBagHint')}</Text>
      </Pressable>

      <Pressable
        onPress={() => navigation.navigate('BrandPackageCapture')}
        style={({ pressed }) => [styles.cardButton, pressed && styles.cardButtonPressed]}
      >
        <Text style={styles.cardTitle}>{t('brandPackage')}</Text>
        <Text style={styles.cardBody}>{t('brandPackageHint')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  kicker: {
    color: colors.primary,
    fontSize: typography.label,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 36,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
    marginBottom: spacing.sm,
  },
  cardButton: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    gap: spacing.xs,
    minHeight: 140,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  cardButtonPressed: {
    opacity: 0.9,
  },
  cardTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
});

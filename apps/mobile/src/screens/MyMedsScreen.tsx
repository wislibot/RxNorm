import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { MyMedsStackParamList } from '../case/navigationTypes';
import { colors, spacing, typography } from '../theme/tokens';

type Props = NativeStackScreenProps<MyMedsStackParamList, 'MyMedsHome'>;

export function MyMedsScreen({ navigation }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t('myMedsTitle')}</Text>
      <Text style={styles.text}>{t('myMedsSubtitle')}</Text>
      <Pressable
        onPress={() => navigation.navigate('CaseHistory')}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <Text style={styles.cardTitle}>{t('scanHistoryTitle')}</Text>
        <Text style={styles.cardBody}>{t('scanHistorySubtitle')}</Text>
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('SavedMeds')}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <Text style={styles.cardTitle}>{t('savedMedsTitle')}</Text>
        <Text style={styles.cardBody}>{t('savedMedsSubtitle')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  text: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    gap: spacing.xs,
    minHeight: 120,
    padding: spacing.lg,
  },
  cardPressed: {
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
    lineHeight: 28,
  },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, spacing, typography } from '../theme/tokens';

export function CareTeamsScreen() {
  const { t } = useTranslation();

  return (
    <View style={styles.page}>
      <Text style={styles.text}>{t('placeholderCareTeams')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  text: {
    color: colors.text,
    fontSize: typography.subtitle,
    lineHeight: 30,
    textAlign: 'center',
  },
});

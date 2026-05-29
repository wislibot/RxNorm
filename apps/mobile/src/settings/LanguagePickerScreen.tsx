import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { setLanguage, type AppLanguage } from '../lib/i18n';
import { useAuth } from '../auth/AuthProvider';
import { colors, radius, spacing, typography } from '../theme/tokens';

type LanguagePickerScreenProps = {
  onComplete?: () => void;
};

const LANGUAGE_OPTIONS: Array<{ key: AppLanguage; labelKey: 'languageEnglish' | 'languageTraditionalChinese' }> = [
  { key: 'en', labelKey: 'languageEnglish' },
  { key: 'zh-TW', labelKey: 'languageTraditionalChinese' },
];

export function LanguagePickerScreen({ onComplete }: LanguagePickerScreenProps) {
  const { t } = useTranslation();
  const { preferredLanguage, setPreferredLanguage } = useAuth();
  const [selectedLanguage, setSelectedLanguage] = useState<AppLanguage>(preferredLanguage ?? 'en');

  const handleContinue = async () => {
    await setPreferredLanguage(selectedLanguage);
    await setLanguage(selectedLanguage);
    onComplete?.();
  };

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('languageTitle')}</Text>
        <Text style={styles.subtitle}>{t('languageSubtitle')}</Text>

        {LANGUAGE_OPTIONS.map((option) => {
          const selected = option.key === selectedLanguage;
          return (
            <Pressable key={option.key} onPress={() => setSelectedLanguage(option.key)} style={[styles.option, selected && styles.optionSelected]}>
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{t(option.labelKey)}</Text>
            </Pressable>
          );
        })}

        <Pressable onPress={handleContinue} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonText}>{t('saveLanguage')}</Text>
        </Pressable>
      </View>
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    gap: spacing.md,
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
  option: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: '#E8F1FF',
  },
  optionText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: colors.primary,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 58,
    marginTop: spacing.sm,
  },
  buttonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  buttonText: {
    color: colors.card,
    fontSize: typography.body,
    fontWeight: '700',
  },
});

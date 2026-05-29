import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthProvider';
import { OcrDebugScreen } from '../dev/OcrDebugScreen';
import { LanguagePickerScreen } from '../settings/LanguagePickerScreen';
import { colors, radius, spacing, typography } from '../theme/tokens';

export function SettingsScreen() {
  const { t } = useTranslation();
  const { preferredLanguage, signOut } = useAuth();
  const [editingLanguage, setEditingLanguage] = useState(false);
  const [showOcrDebug, setShowOcrDebug] = useState(false);

  if (editingLanguage) {
    return <LanguagePickerScreen onComplete={() => setEditingLanguage(false)} />;
  }

  if (showOcrDebug) {
    return <OcrDebugScreen onBack={() => setShowOcrDebug(false)} />;
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t('settingsTitle')}</Text>

      <Pressable onPress={() => setEditingLanguage(true)} style={styles.row}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowLabel}>{t('changeLanguage')}</Text>
          <Text style={styles.rowValue}>{preferredLanguage ?? 'en'}</Text>
        </View>
      </Pressable>

      {__DEV__ ? (
        <Pressable onPress={() => setShowOcrDebug(true)} style={styles.row}>
          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>DEV: OCR Debug</Text>
            <Text style={styles.rowValue}>Bounding boxes and section counts</Text>
          </View>
        </Pressable>
      ) : null}

      <Pressable onPress={() => void signOut()} style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutPressed]}>
        <Text style={styles.signOutText}>{t('signOut')}</Text>
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
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  row: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    minHeight: 76,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  rowCopy: {
    gap: spacing.xs,
  },
  rowLabel: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  rowValue: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 56,
  },
  signOutPressed: {
    opacity: 0.8,
  },
  signOutText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
});

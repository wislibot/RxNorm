import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthProvider';
import { OcrDebugScreen } from '../dev/OcrDebugScreen';
import { LanguagePickerScreen } from '../settings/LanguagePickerScreen';
import { colors, radius, spacing, typography } from '../theme/tokens';

export function SettingsScreen() {
  const { t } = useTranslation();
  const { user, preferredLanguage, signOut } = useAuth();
  const [editingLanguage, setEditingLanguage] = useState(false);
  const [showOcrDebug, setShowOcrDebug] = useState(false);

  if (editingLanguage) {
    return <LanguagePickerScreen onComplete={() => setEditingLanguage(false)} />;
  }

  if (showOcrDebug) {
    return <OcrDebugScreen onBack={() => setShowOcrDebug(false)} />;
  }

  const langLabel = preferredLanguage === 'zh-TW' ? '繁體中文' : 'English';

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t('settingsTitle')}</Text>

      {/* Profile section */}
      <View style={styles.section}>
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Ionicons color={colors.primary} name="person" size={24} />
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileEmail}>{user?.email ?? '—'}</Text>
            <Text style={styles.profileLabel}>{t('settingsAccount')}</Text>
          </View>
        </View>
      </View>

      {/* Preferences section */}
      <Text style={styles.sectionLabel}>{t('settingsPreferences')}</Text>
      <View style={styles.section}>
        <Pressable onPress={() => setEditingLanguage(true)} style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={[styles.rowIcon, { backgroundColor: '#E8F8EE' }]}>
              <Ionicons color="#00A651" name="language-outline" size={20} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>{t('changeLanguage')}</Text>
              <Text style={styles.rowValue}>{langLabel}</Text>
            </View>
          </View>
          <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
        </Pressable>
      </View>

      {/* Dev section */}
      {__DEV__ ? (
        <>
          <Text style={styles.sectionLabel}>Developer</Text>
          <View style={styles.section}>
            <Pressable onPress={() => setShowOcrDebug(true)} style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={[styles.rowIcon, { backgroundColor: '#FFF4D6' }]}>
                  <Ionicons color="#8D5B00" name="bug-outline" size={20} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel}>OCR Debug</Text>
                  <Text style={styles.rowValue}>Bounding boxes and section counts</Text>
                </View>
              </View>
              <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
            </Pressable>
          </View>
        </>
      ) : null}

      {/* About section */}
      <Text style={styles.sectionLabel}>{t('settingsAbout')}</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <View style={[styles.rowIcon, { backgroundColor: '#E8F8EE' }]}>
              <Ionicons color="#00A651" name="medical-outline" size={20} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>{t('settingsAppName')}</Text>
              <Text style={styles.rowValue}>{t('settingsAppDescription')}</Text>
            </View>
          </View>
          <Text style={styles.versionBadge}>v1.0.0</Text>
        </View>
      </View>

      {/* Sign out */}
      <View style={styles.signOutWrapper}>
        <Pressable onPress={() => void signOut()} style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutPressed]}>
          <Ionicons color={colors.warningText} name="log-out-outline" size={20} />
          <Text style={styles.signOutText}>{t('signOut')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  profileCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  avatarCircle: {
    alignItems: 'center',
    backgroundColor: '#E8F8EE',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  profileCopy: {
    flex: 1,
    gap: 2,
  },
  profileEmail: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  profileLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    gap: spacing.md,
  },
  rowIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  rowValue: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  versionBadge: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '600',
  },
  signOutWrapper: {
    marginTop: 'auto',
    paddingTop: spacing.lg,
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.warningText,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 56,
  },
  signOutPressed: {
    opacity: 0.8,
  },
  signOutText: {
    color: colors.warningText,
    fontSize: typography.body,
    fontWeight: '700',
  },
});

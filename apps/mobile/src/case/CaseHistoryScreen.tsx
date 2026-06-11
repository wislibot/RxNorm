import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { deleteCase, listCases, renameCase } from '../api/case';
import type { MyMedsStackParamList } from './navigationTypes';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { CaseSummary } from '../types/case';

type Props = NativeStackScreenProps<MyMedsStackParamList, 'CaseHistory'>;

export function CaseHistoryScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loadError, setLoadError] = useState('');
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [editingCaseName, setEditingCaseName] = useState('');

  const loadCases = useCallback(async () => {
    try {
      const result = await listCases({ limit: 20 });
      setCases((prev) => {
        const merged = result.map((incoming) => {
          const existing = prev.find((p) => p.caseId === incoming.caseId);
          return existing && existing.caseName && !incoming.caseName ? existing : incoming;
        });
        return merged;
      });
    } catch {
      setLoadError(t('scanHistoryLoadError'));
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void loadCases();
    }, [loadCases]),
  );

  const handleRename = async (caseId: string) => {
    const name = editingCaseName.trim();
    if (!name) {
      setEditingCaseId(null);
      return;
    }
    try {
      await renameCase(caseId, name);
      setCases((prev) => prev.map((c) => (c.caseId === caseId ? { ...c, caseName: name } : c)));
    } catch {
      // silently fail
    }
    setEditingCaseId(null);
  };

  const handleDelete = (caseId: string) => {
    Alert.alert(t('caseDeleteConfirm'), '', [
      { text: t('commonCancel') || 'Cancel', style: 'cancel' },
      {
        text: t('caseDelete'),
        style: 'destructive',
        onPress: async () => {
          const prev = [...cases];
          setCases((prevCases) => prevCases.filter((c) => c.caseId !== caseId));
          try {
            await deleteCase(caseId);
          } catch {
            setCases(prev);
          }
        },
      },
    ]);
  };

  const startEditing = (item: CaseSummary) => {
    setEditingCaseId(item.caseId);
    setEditingCaseName(item.caseName || '');
  };

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

      {cases.map((item) => {
        const isEditing = editingCaseId === item.caseId;
        return (
          <Pressable
            key={item.caseId}
            onPress={() => {
              if (!isEditing) navigation.navigate('CasePage', { caseId: item.caseId });
            }}
            style={({ pressed }) => [styles.card, pressed && !isEditing && styles.cardPressed]}
          >
            {item.firstThumbUrl || item.firstPhotoUrl ? (
              <Image source={{ uri: (item.firstThumbUrl || item.firstPhotoUrl) as string }} style={styles.photo} />
            ) : null}

            {isEditing ? (
              <View style={styles.editRow}>
                <TextInput
                  style={styles.editInput}
                  value={editingCaseName}
                  onChangeText={setEditingCaseName}
                  onSubmitEditing={() => handleRename(item.caseId)}
                  autoFocus
                  selectTextOnFocus
                />
                <Pressable onPress={() => handleRename(item.caseId)} style={styles.iconButton}>
                  <Ionicons color={colors.primary} name="checkmark" size={20} />
                </Pressable>
                <Pressable onPress={() => setEditingCaseId(null)} style={styles.iconButton}>
                  <Ionicons color={colors.textMuted} name="close" size={20} />
                </Pressable>
              </View>
            ) : (
              <Text style={styles.caseName}>
                {item.caseName || t(`caseType.${item.caseType}`)}
              </Text>
            )}

            <View style={styles.actionRow}>
              <Text style={styles.metaText}>{new Date(item.createdAt).toLocaleString()}</Text>
              <View style={styles.actionButtons}>
                <Pressable onPress={() => startEditing(item)} style={styles.iconButton} hitSlop={8}>
                  <Ionicons color={colors.textMuted} name="pencil-outline" size={18} />
                </Pressable>
                <Pressable onPress={() => handleDelete(item.caseId)} style={styles.iconButton} hitSlop={8}>
                  <Ionicons color={colors.warningText} name="trash-outline" size={18} />
                </Pressable>
              </View>
            </View>

            {!isEditing ? (
              <>
                <Text style={styles.previewText}>{item.ocrPreview || t('scanHistoryNoPreview')}</Text>
                <Text style={styles.metaText}>{t('scanHistoryDetectedCount', { count: item.detectedItemCount })}</Text>
              </>
            ) : null}
          </Pressable>
        );
      })}
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
  caseName: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButtons: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  editRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  editInput: {
    backgroundColor: colors.background,
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});

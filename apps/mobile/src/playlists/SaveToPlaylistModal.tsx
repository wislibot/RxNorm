import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { getPlaylists, createPlaylist, addToPlaylist, type Playlist } from '../api/playlists';
import type { DrugSearchResult } from '../api/drugs';
import { colors, radius, spacing, typography } from '../theme/tokens';

type Props = {
  visible: boolean;
  drug: DrugSearchResult | null;
  onSelectSaved: () => void;
  onSelectPlaylist: (playlistId: string) => void;
  onCancel: () => void;
};

type Step = 'choose' | 'playlists';

export function SaveToPlaylistModal({ visible, drug, onSelectSaved, onSelectPlaylist, onCancel }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('choose');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (visible) {
      setStep('choose');
      setPlaylists([]);
      setShowCreate(false);
      setNewName('');
    }
  }, [visible]);

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPlaylists();
      setPlaylists(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAddToPlaylist = useCallback(
    async (playlistId: string) => {
      if (!drug) return;
      setAdding(true);
      try {
        await addToPlaylist(playlistId, drug);
        onSelectPlaylist(playlistId);
      } catch {
        // silently fail
      } finally {
        setAdding(false);
      }
    },
    [drug, onSelectPlaylist],
  );

  const handleCreateAndAdd = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed || !drug) return;
    setCreating(true);
    try {
      const playlist = await createPlaylist(trimmed);
      await addToPlaylist(playlist.id, drug);
      onSelectPlaylist(playlist.id);
    } catch {
      // silently fail
    } finally {
      setCreating(false);
    }
  }, [newName, drug, onSelectPlaylist]);

  const handleChoosePlaylists = useCallback(() => {
    setStep('playlists');
    loadPlaylists();
  }, [loadPlaylists]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <Pressable style={styles.overlay} onPress={onCancel}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {step === 'choose' ? (
            <>
              <Text style={styles.sheetTitle}>{t('saveModalTitle')}</Text>
              <Pressable
                onPress={() => {
                  onSelectSaved();
                }}
                style={({ pressed }) => [styles.optionButton, pressed && styles.optionButtonPressed]}
              >
                <Ionicons color={colors.primary} name="bookmark" size={22} />
                <Text style={styles.optionText}>{t('saveModalToMeds')}</Text>
              </Pressable>
              <Pressable
                onPress={handleChoosePlaylists}
                style={({ pressed }) => [styles.optionButton, pressed && styles.optionButtonPressed]}
              >
                <Ionicons color={colors.primary} name="musical-notes" size={22} />
                <Text style={styles.optionText}>{t('saveModalToPlaylist')}</Text>
              </Pressable>
              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
              >
                <Text style={styles.cancelText}>{t('saveModalCancel')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.sheetTitle}>{t('saveModalChoosePlaylist')}</Text>

              {showCreate ? (
                <View style={styles.createRow}>
                  <TextInput
                    autoFocus
                    onChangeText={setNewName}
                    onSubmitEditing={handleCreateAndAdd}
                    placeholder={t('playlistCreatePrompt')}
                    placeholderTextColor={colors.textMuted}
                    style={styles.createInput}
                    value={newName}
                  />
                  <Pressable
                    disabled={creating || !newName.trim()}
                    onPress={handleCreateAndAdd}
                    style={({ pressed }) => [styles.createButton, pressed && styles.createButtonPressed]}
                  >
                    {creating ? (
                      <ActivityIndicator color={colors.card} size="small" />
                    ) : (
                      <Ionicons color={colors.card} name="checkmark" size={18} />
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setShowCreate(false);
                      setNewName('');
                    }}
                    style={({ pressed }) => [styles.createCancelButton, pressed && styles.createCancelButtonPressed]}
                  >
                    <Ionicons color={colors.textMuted} name="close" size={18} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setShowCreate(true)}
                  style={({ pressed }) => [styles.createNewButton, pressed && styles.createNewButtonPressed]}
                >
                  <Ionicons color={colors.primary} name="add-circle-outline" size={20} />
                  <Text style={styles.createNewText}>{t('playlistCreateNew')}</Text>
                </Pressable>
              )}

              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.primary} size="small" />
                </View>
              ) : (
                <FlatList
                  data={playlists}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <Pressable
                      disabled={adding}
                      onPress={() => handleAddToPlaylist(item.id)}
                      style={({ pressed }) => [styles.playlistRow, pressed && styles.playlistRowPressed]}
                    >
                      <Ionicons color={colors.primary} name="list" size={20} />
                      <View style={styles.playlistRowContent}>
                        <Text style={styles.playlistRowName}>{item.name}</Text>
                        <Text style={styles.playlistRowCount}>
                          {t('playlistDrugCount', { count: item.item_count ?? 0 })}
                        </Text>
                      </View>
                      {adding ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                      ) : (
                        <Ionicons color={colors.textMuted} name="add-circle-outline" size={20} />
                      )}
                    </Pressable>
                  )}
                />
              )}

              <Pressable
                onPress={() => setStep('choose')}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
              >
                <Text style={styles.cancelText}>{t('saveModalCancel')}</Text>
              </Pressable>
            </>
          )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: spacing.sm,
    maxHeight: '70%',
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetContent: {
    gap: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  optionButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  optionButtonPressed: {
    opacity: 0.8,
  },
  optionText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
    lineHeight: 26,
  },
  cancelButton: {
    alignItems: 'center',
    padding: spacing.md,
  },
  cancelButtonPressed: {
    opacity: 0.7,
  },
  cancelText: {
    color: colors.textMuted,
    fontSize: typography.body,
    fontWeight: '600',
  },
  createNewButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  createNewButtonPressed: {
    opacity: 0.8,
  },
  createNewText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  createRow: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  createInput: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    lineHeight: 26,
    paddingHorizontal: spacing.sm,
  },
  createButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonPressed: {
    opacity: 0.8,
  },
  createCancelButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCancelButtonPressed: {
    opacity: 0.7,
  },
  playlistRow: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  playlistRowPressed: {
    opacity: 0.8,
  },
  playlistRowContent: {
    flex: 1,
    gap: 2,
  },
  playlistRowName: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
    lineHeight: 24,
  },
  playlistRowCount: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 20,
  },
  loadingRow: {
    alignItems: 'center',
    padding: spacing.md,
  },
});

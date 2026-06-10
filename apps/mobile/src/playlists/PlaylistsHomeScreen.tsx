import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { getPlaylists, createPlaylist, type Playlist } from '../api/playlists';
import type { MyMedsStackParamList } from '../case/navigationTypes';
import { colors, radius, spacing, typography } from '../theme/tokens';

type Props = NativeStackScreenProps<MyMedsStackParamList, 'PlaylistsHome'>;

export function PlaylistsHomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (pullRefresh = false) => {
    if (pullRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await getPlaylists();
      setPlaylists(data);
    } catch {
      setError(t('searchError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const playlist = await createPlaylist(trimmed);
      setPlaylists((prev) => [playlist, ...prev]);
      setNewName('');
      setShowCreate(false);
    } catch {
      // silently fail
    } finally {
      setCreating(false);
    }
  }, [newName]);

  const renderItem = useCallback(
    ({ item }: { item: Playlist }) => (
      <Pressable
        onPress={() =>
          navigation.navigate('PlaylistDetail', {
            playlistId: item.id,
            playlistName: item.name,
          })
        }
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.cardIcon}>
          <Ionicons color={colors.primary} name="list" size={24} />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.cardSubtitle}>
            {t('playlistDrugCount', { count: item.item_count ?? 0 })}
          </Text>
        </View>
        <Ionicons color={colors.textMuted} name="chevron-forward" size={20} />
      </Pressable>
    ),
    [navigation, t],
  );

  const keyExtractor = useCallback((item: Playlist) => item.id, []);

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t('playlistTitle')}</Text>

      {showCreate ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
        >
          <View style={styles.createRow}>
            <TextInput
              autoFocus
              onChangeText={setNewName}
              onSubmitEditing={handleCreate}
              placeholder={t('playlistCreatePrompt')}
              placeholderTextColor={colors.textMuted}
              style={styles.createInput}
              value={newName}
            />
            <Pressable
              disabled={creating || !newName.trim()}
              onPress={handleCreate}
              style={({ pressed }) => [styles.createButton, pressed && styles.createButtonPressed]}
            >
              {creating ? (
                <ActivityIndicator color={colors.card} size="small" />
              ) : (
                <Ionicons color={colors.card} name="checkmark" size={20} />
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setShowCreate(false);
                setNewName('');
              }}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
            >
              <Ionicons color={colors.textMuted} name="close" size={20} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <Pressable
          onPress={() => setShowCreate(true)}
          style={({ pressed }) => [styles.createCard, pressed && styles.createCardPressed]}
        >
          <Ionicons color={colors.primary} name="add-circle-outline" size={24} />
          <Text style={styles.createCardText}>{t('playlistCreateNew')}</Text>
        </Pressable>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="alert-circle-outline" size={48} />
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : playlists.length === 0 ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="musical-notes-outline" size={48} />
          <Text style={styles.emptyText}>{t('playlistEmpty')}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={playlists}
          keyExtractor={keyExtractor}
          refreshControl={
            <RefreshControl onRefresh={() => load(true)} refreshing={refreshing} />
          }
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  cardPressed: {
    opacity: 0.8,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E9F2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    lineHeight: 26,
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 22,
  },
  createCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  createCardPressed: {
    opacity: 0.8,
  },
  createCardText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '600',
    lineHeight: 26,
  },
  createRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  createInput: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    lineHeight: 26,
    paddingHorizontal: spacing.sm,
  },
  createButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonPressed: {
    opacity: 0.8,
  },
  cancelButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonPressed: {
    opacity: 0.7,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 28,
    textAlign: 'center',
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
});

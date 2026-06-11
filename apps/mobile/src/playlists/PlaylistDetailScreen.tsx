import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  getPlaylistItems,
  removeFromPlaylist,
  deletePlaylist,
  type PlaylistItem,
} from '../api/playlists';
import type { MyMedsStackParamList } from '../case/navigationTypes';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { DeletePlaylistConfirm } from './DeletePlaylistConfirm';

type Props = {
  route: RouteProp<MyMedsStackParamList, 'PlaylistDetail'>;
  navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
};

export function PlaylistDetailScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { playlistId, playlistName } = route.params;
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);

  const load = useCallback(async (pullRefresh = false) => {
    if (pullRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await getPlaylistItems(playlistId);
      setItems(data);
    } catch {
      setError(t('searchError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [playlistId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = useCallback(async (itemId: string) => {
    try {
      await removeFromPlaylist(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch {
      // silently fail
    }
  }, []);

  const handleDelete = useCallback(async () => {
    try {
      await deletePlaylist(playlistId);
      navigation.goBack();
    } catch {
      // silently fail
    }
  }, [playlistId, navigation]);

  const handleItemPress = useCallback(
    (nhiCode: string) => {
      navigation.navigate('DrugDetail', { nhiCode });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: PlaylistItem }) => {
      const ingredientPart = item.ingredient_text
        ? t('savedMedsIngredient', { text: item.ingredient_text })
        : null;

      const formPart = item.dose_form
        ? t('savedMedsForm', { form: item.dose_form })
        : null;

      const strengthPart =
        item.strength_value != null && item.strength_unit
          ? t('savedMedsStrength', { value: item.strength_value, unit: item.strength_unit })
          : null;

      return (
        <Pressable
          onPress={() => handleItemPress(item.nhi_code)}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <View style={styles.cardNames}>
                {item.name_zh ? <Text style={styles.cardNameZh}>{item.name_zh}</Text> : null}
                {item.name_en ? <Text style={styles.cardNameEn}>{item.name_en}</Text> : null}
              </View>
              <Pressable
                onPress={() => handleRemove(item.id)}
                style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
              >
                <Ionicons color={colors.textMuted} name="trash-outline" size={18} />
                <Text style={styles.removeButtonText}>{t('playlistRemove')}</Text>
              </Pressable>
            </View>
            <View style={styles.cardDetails}>
              <Text style={styles.cardLabel}>{t('savedMedsNhiCode', { code: item.nhi_code })}</Text>
              {ingredientPart ? <Text style={styles.cardLabel}>{ingredientPart}</Text> : null}
              <View style={styles.cardMeta}>
                {formPart ? <Text style={styles.cardMetaText}>{formPart}</Text> : null}
                {strengthPart ? <Text style={styles.cardMetaText}>{strengthPart}</Text> : null}
                {item.atc_code ? (
                  <Text style={styles.cardMetaText}>{t('savedMedsAtc', { code: item.atc_code })}</Text>
                ) : null}
              </View>
            </View>
          </View>
        </Pressable>
      );
    },
    [handleItemPress, handleRemove, t],
  );

  const keyExtractor = useCallback((item: PlaylistItem) => item.id, []);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.title}>{playlistName}</Text>
          <Text style={styles.subtitle}>
            {t('playlistDrugCount', { count: items.length })}
          </Text>
        </View>
        <Pressable
          onPress={() => setDeleteVisible(true)}
          style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
        >
          <Ionicons color={colors.textMuted} name="trash-outline" size={20} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="alert-circle-outline" size={48} />
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="medical-outline" size={48} />
          <Text style={styles.emptyText}>{t('playlistEmptyDetail')}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={keyExtractor}
          refreshControl={
            <RefreshControl onRefresh={() => load(true)} refreshing={refreshing} />
          }
          renderItem={renderItem}
        />
      )}

      <DeletePlaylistConfirm
        visible={deleteVisible}
        onConfirm={handleDelete}
        onCancel={() => setDeleteVisible(false)}
      />
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerContent: {
    flex: 1,
    gap: 2,
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
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonPressed: {
    opacity: 0.7,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  cardPressed: {
    opacity: 0.8,
  },
  cardContent: {
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardNames: {
    flex: 1,
    gap: 2,
  },
  cardNameZh: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
    lineHeight: 30,
  },
  cardNameEn: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  cardDetails: {
    gap: spacing.xs,
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardMetaText: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 24,
  },
  removeButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  removeButtonPressed: {
    opacity: 0.7,
  },
  removeButtonText: {
    color: colors.textMuted,
    fontSize: typography.label,
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

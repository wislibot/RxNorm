import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  addHospital,
  getMyHospitals,
  removeHospital,
  searchHospitals,
  type Hospital,
  type HospitalSearchResult,
} from '../api/hospitals';
import { colors, radius, spacing, typography } from '../theme/tokens';

export function CareTeamsScreen() {
  const { t } = useTranslation();
  const [myHospitals, setMyHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HospitalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const loadMyHospitals = useCallback(async (pullRefresh = false) => {
    if (pullRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await getMyHospitals();
      setMyHospitals(data);
    } catch {
      setError(t('searchError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      loadMyHospitals();
    }, [loadMyHospitals])
  );

  // Refresh when the already-active tab is tapped
  const navigation = useNavigation<any>();
  const isFocusedRef = useRef(false);
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', () => {
      if (isFocusedRef.current) {
        loadMyHospitals();
      }
    });
    return unsubscribe;
  }, [navigation, loadMyHospitals]);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => { isFocusedRef.current = false; };
    }, [])
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchHospitals(trimmed);
        setSearchResults(results);
      } catch {
        // silently fail search
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const myHospitalIds = new Set(myHospitals.map((h) => h.id));

  const handleAdd = useCallback(async (hospitalId: string) => {
    try {
      await addHospital(hospitalId);
      await loadMyHospitals();
    } catch {
      // UNIQUE constraint or other error — graceful silence
    }
  }, [loadMyHospitals]);

  const handleRemove = useCallback(async (hospitalId: string) => {
    setMyHospitals((prev) => prev.filter((h) => h.id !== hospitalId));
    try {
      await removeHospital(hospitalId);
    } catch {
      await loadMyHospitals();
    }
  }, [loadMyHospitals]);

  const handleFocus = useCallback(() => {
    setIsSearchFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    if (!query.trim()) {
      setIsSearchFocused(false);
    }
  }, [query]);

  const renderHospitalCard = useCallback(
    ({ item }: { item: Hospital }) => (
      <Pressable
        onPress={() =>
          navigation.navigate('HospitalDetail', {
            hospitalId: item.id,
            hospitalNameZh: item.name_zh,
            hospitalNameEn: item.name_en,
          })
        }
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.cardContent}>
          <Text style={styles.cardTitleZh}>{item.name_zh}</Text>
          <Text style={styles.cardTitleEn}>{item.name_en}</Text>
          {item.address ? (
            <Text style={styles.cardAddress} numberOfLines={2}>
              {item.address}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => handleRemove(item.id)}
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
          hitSlop={8}
        >
          <Ionicons color={colors.textMuted} name="close-circle" size={24} />
        </Pressable>
      </Pressable>
    ),
    [handleRemove, navigation],
  );

  const renderSearchResultCard = useCallback(
    ({ item }: { item: HospitalSearchResult }) => {
      const alreadyAdded = myHospitalIds.has(item.id);
      return (
        <View style={styles.card}>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitleZh}>{item.name_zh}</Text>
            <Text style={styles.cardTitleEn}>{item.name_en}</Text>
            {item.address ? (
              <Text style={styles.cardAddress} numberOfLines={2}>
                {item.address}
              </Text>
            ) : null}
          </View>
          {alreadyAdded ? (
            <View style={styles.addedBadge}>
              <Text style={styles.addedBadgeText}>{t('careTeamsAlreadyAdded')}</Text>
            </View>
          ) : (
            <Pressable
              onPress={() => handleAdd(item.id)}
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              hitSlop={8}
            >
              <Ionicons color={colors.primary} name="add-circle" size={24} />
            </Pressable>
          )}
        </View>
      );
    },
    [handleAdd, myHospitalIds, t],
  );

  const keyExtractor = useCallback((item: Hospital) => item.id, []);

  const renderMyHospitalsContent = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="alert-circle-outline" size={48} />
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      );
    }
    if (myHospitals.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="business-outline" size={48} />
          <Text style={styles.emptyText}>{t('careTeamsNoHospitals')}</Text>
        </View>
      );
    }
    return (
      <FlatList
        contentContainerStyle={styles.list}
        data={myHospitals}
        keyExtractor={keyExtractor}
        refreshControl={
          <RefreshControl onRefresh={() => loadMyHospitals(true)} refreshing={refreshing} />
        }
        renderItem={renderHospitalCard}
      />
    );
  };

  const renderSearchContent = () => {
    if (!query.trim()) {
      return (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="search" size={48} />
          <Text style={styles.emptyText}>{t('careTeamsTypeToSearch')}</Text>
        </View>
      );
    }
    if (searching) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (searchResults.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons color={colors.textMuted} name="search" size={48} />
          <Text style={styles.emptyText}>{t('careTeamsNoResults')}</Text>
        </View>
      );
    }
    return (
      <FlatList
        contentContainerStyle={styles.list}
        data={searchResults}
        keyExtractor={keyExtractor}
        renderItem={renderSearchResultCard}
      />
    );
  };

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t('careTeamsTitle')}</Text>

      <TextInput
        onBlur={handleBlur}
        onChangeText={setQuery}
        onFocus={handleFocus}
        placeholder={t('careTeamsSearchPlaceholder')}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        value={query}
      />

      {isSearchFocused ? (
        <>
          <Text style={styles.sectionTitle}>{t('careTeamsSearchResults')}</Text>
          {renderSearchContent()}
        </>
      ) : (
        <>
          <Text style={styles.sectionTitle}>{t('careTeamsMyHospitals')}</Text>
          {renderMyHospitalsContent()}
        </>
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
  searchInput: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 26,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '600',
    letterSpacing: 0.5,
    lineHeight: 22,
    textTransform: 'uppercase',
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  cardContent: {
    flex: 1,
    gap: 2,
  },
  cardTitleZh: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    lineHeight: 26,
  },
  cardTitleEn: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 22,
  },
  cardAddress: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  actionButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  addedBadge: {
    backgroundColor: '#E9F2FF',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  addedBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
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
  cardPressed: {
    opacity: 0.8,
  },
});

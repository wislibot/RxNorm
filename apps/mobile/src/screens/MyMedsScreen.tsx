import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import type { MyMedsStackParamList } from '../case/navigationTypes';
import { colors, radius, spacing, typography } from '../theme/tokens';

type Props = NativeStackScreenProps<MyMedsStackParamList, 'MyMedsHome'>;

const CARDS = [
  {
    key: 'CaseHistory' as const,
    titleKey: 'scanHistoryTitle',
    subtitleKey: 'scanHistorySubtitle',
    icon: 'time-outline' as const,
    iconBg: '#E8F8EE',
    iconColor: '#00A651',
  },
  {
    key: 'SavedMeds' as const,
    titleKey: 'savedMedsTitle',
    subtitleKey: 'savedMedsSubtitle',
    icon: 'bookmark-outline' as const,
    iconBg: '#E6F4EA',
    iconColor: '#1B8A4A',
  },
  {
    key: 'PlaylistsHome' as const,
    titleKey: 'playlistTitle',
    subtitleKey: 'playlistSubtitle',
    icon: 'list-outline' as const,
    iconBg: '#F0F7F2',
    iconColor: '#2E7D52',
  },
];

export function MyMedsScreen({ navigation }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t('myMedsTitle')}</Text>
      <Text style={styles.text}>{t('myMedsSubtitle')}</Text>

      <View style={styles.cardList}>
        {CARDS.map((card) => (
          <Pressable
            key={card.key}
            onPress={() => navigation.navigate(card.key)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={[styles.iconCircle, { backgroundColor: card.iconBg }]}>
              <Ionicons color={card.iconColor} name={card.icon} size={22} />
            </View>
            <View style={styles.cardCopy}>
              <Text style={styles.cardTitle}>{t(card.titleKey)}</Text>
              <Text style={styles.cardBody}>{t(card.subtitleKey)}</Text>
            </View>
            <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
          </Pressable>
        ))}
      </View>
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
  cardList: {
    gap: spacing.sm,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardPressed: {
    opacity: 0.85,
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardCopy: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 22,
  },
});

import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

import { colors, typography } from '../theme/tokens';

type BilingualLabelProps = {
  zh: string;
  en: string;
  style?: StyleProp<TextStyle>;
  enStyle?: StyleProp<TextStyle>;
};

export function BilingualLabel({ zh, en, style, enStyle }: BilingualLabelProps) {
  return (
    <Text style={[styles.text, style]}>
      {zh}
      <Text style={[styles.englishText, enStyle]}> ({en})</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  englishText: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '500',
  },
});

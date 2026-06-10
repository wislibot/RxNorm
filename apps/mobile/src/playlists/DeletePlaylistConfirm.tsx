import React from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

type Props = {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeletePlaylistConfirm({ visible, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();

  if (!visible) return null;

  Alert.alert(
    t('playlistDelete'),
    t('playlistDelete'),
    [
      { text: t('saveModalCancel'), onPress: onCancel, style: 'cancel' },
      { text: t('playlistDelete'), onPress: onConfirm, style: 'destructive' },
    ],
  );

  return null;
}

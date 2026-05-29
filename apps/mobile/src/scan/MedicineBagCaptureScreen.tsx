import React, { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { CameraCapture } from './CameraCapture';
import type { CapturedPhoto, ScanStackParamList } from './types';

type Props = NativeStackScreenProps<ScanStackParamList, 'MedicineBagCapture'>;

export function MedicineBagCaptureScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  return (
    <CameraCapture
      maxPhotos={4}
      nextLabel={t('nextToCaseDraft')}
      onNext={() => navigation.navigate('CaseDraft', { photos })}
      onPhotosChange={setPhotos}
      photos={photos}
      subtitle={t('medicineBagCaptureSubtitle')}
      title={t('medicineBagCaptureTitle')}
    />
  );
}

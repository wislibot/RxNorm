import React, { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { CameraCapture } from './CameraCapture';
import type { CapturedPhoto, ScanStackParamList } from './types';

type Props = NativeStackScreenProps<ScanStackParamList, 'BrandPackageCapture'>;

export function BrandPackageCaptureScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  return (
    <CameraCapture
      maxPhotos={1}
      nextLabel={t('nextToBrandDraft')}
      onNext={() => {
        if (photos[0]) {
          navigation.navigate('BrandDraft', { photo: photos[0] });
        }
      }}
      onPhotosChange={setPhotos}
      photos={photos}
      subtitle={t('brandPackageCaptureSubtitle')}
      title={t('brandPackageCaptureTitle')}
    />
  );
}

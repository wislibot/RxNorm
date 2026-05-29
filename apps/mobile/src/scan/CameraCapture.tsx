import React, { useMemo, useRef } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { colors, radius, spacing, typography } from '../theme/tokens';
import type { CapturedPhoto } from './types';

type CameraCaptureProps = {
  title: string;
  subtitle: string;
  photos: CapturedPhoto[];
  maxPhotos: number;
  nextLabel: string;
  onNext: () => void;
  onPhotosChange: (photos: CapturedPhoto[]) => void;
};

const DEMO_PROMPTS = [
  'elderly patient medicine packages on a clean table, realistic phone camera photo, natural indoor light, high detail',
  'medicine bag and pill boxes arranged neatly on a light tabletop, realistic product photo, soft daylight, documentary style',
  'single medicine package close-up on a clean surface, realistic healthcare product photo, soft neutral light',
  'prescription medicine package beside a medicine bag, realistic photo, balanced composition, clear readable packaging shapes',
];

function buildDemoPhoto(nextIndex: number): CapturedPhoto {
  const prompt = encodeURIComponent(DEMO_PROMPTS[nextIndex % DEMO_PROMPTS.length]);
  return {
    id: `demo-${Date.now()}-${nextIndex}`,
    uri: `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${prompt}&image_size=landscape_4_3`,
  };
}

export function CameraCapture({
  title,
  subtitle,
  photos,
  maxPhotos,
  nextLabel,
  onNext,
  onPhotosChange,
}: CameraCaptureProps) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const canUseDemoPhoto = __DEV__ && Platform.OS === 'web';
  const hasPhoto = photos.length > 0;
  const atMaxPhotos = photos.length >= maxPhotos;
  const captureButtonLabel = useMemo(() => {
    if (maxPhotos === 1 && hasPhoto) {
      return t('retakePhoto');
    }
    return hasPhoto ? t('addAnotherPhoto') : t('capturePhoto');
  }, [hasPhoto, maxPhotos, t]);

  const handlePhotoCaptured = (uri: string) => {
    const nextPhoto = {
      id: `${Date.now()}-${photos.length}`,
      uri,
    };
    if (maxPhotos === 1) {
      onPhotosChange([nextPhoto]);
      return;
    }
    onPhotosChange([...photos, nextPhoto].slice(0, maxPhotos));
  };

  const handleTakePhoto = async () => {
    const captured = await cameraRef.current?.takePictureAsync({
      quality: 0.7,
    });
    if (captured?.uri) {
      handlePhotoCaptured(captured.uri);
    }
  };

  const handleUseDemoPhoto = () => {
    const nextDemo = buildDemoPhoto(photos.length);
    if (maxPhotos === 1) {
      onPhotosChange([nextDemo]);
      return;
    }
    onPhotosChange([...photos, nextDemo].slice(0, maxPhotos));
  };

  const handleDeletePhoto = (photoId: string) => {
    onPhotosChange(photos.filter((photo) => photo.id !== photoId));
  };

  const handleUploadFromPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });

    if (result.canceled) return;

    const uri = result.assets?.[0]?.uri;
    if (uri) {
      handlePhotoCaptured(uri);
    }
  };

  const renderPermissionState = () => (
    <View style={styles.permissionCard}>
      <Text style={styles.permissionTitle}>{t('cameraPermissionTitle')}</Text>
      <Text style={styles.permissionBody}>{t('cameraPermissionBody')}</Text>
      <Pressable
        onPress={() => void requestPermission()}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>{t('grantCameraPermission')}</Text>
      </Pressable>
      {canUseDemoPhoto ? (
        <Pressable
          onPress={handleUseDemoPhoto}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
        >
          <Text style={styles.secondaryButtonText}>{t('useDemoPhoto')}</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => void handleUploadFromPhotos()}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>{t('scanUploadFromPhotos')}</Text>
      </Pressable>
    </View>  // end of permissionCard
  );

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerCard}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Text style={styles.stepText}>
          {t('photoCountHelper', {
            count: photos.length,
            max: maxPhotos,
          })}
        </Text>
      </View>

      {permission?.granted ? (
        <View style={styles.cameraCard}>
          <CameraView facing="back" ref={cameraRef} style={styles.cameraPreview} />
          <View style={styles.cameraActions}>
            <Pressable
              disabled={atMaxPhotos && maxPhotos > 1}
              onPress={() => void handleTakePhoto()}
              style={({ pressed }) => [
                styles.primaryButton,
                (pressed || (atMaxPhotos && maxPhotos > 1)) && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>{captureButtonLabel}</Text>
            </Pressable>
            {canUseDemoPhoto ? (
              <Pressable
                onPress={handleUseDemoPhoto}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
              >
                <Text style={styles.secondaryButtonText}>{t('useDemoPhoto')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void handleUploadFromPhotos()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            >
              <Text style={styles.primaryButtonText}>{t('scanUploadFromPhotos')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        renderPermissionState()
      )}

      <View style={styles.thumbnailSection}>
        <Text style={styles.sectionTitle}>{t('selectedPhotos')}</Text>
        {photos.length === 0 ? (
          <Text style={styles.emptyStateText}>{t('noPhotosYet')}</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.thumbnailRow} horizontal showsHorizontalScrollIndicator={false}>
            {photos.map((photo, index) => (
              <View key={photo.id} style={styles.thumbnailCard}>
                <Image source={{ uri: photo.uri }} style={styles.thumbnailImage} />
                <Text style={styles.thumbnailLabel}>
                  {t('photoNumberLabel', {
                    number: index + 1,
                  })}
                </Text>
                <Pressable
                  onPress={() => handleDeletePhoto(photo.id)}
                  style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
                >
                  <Text style={styles.deleteButtonText}>{t('deletePhoto')}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <Pressable
        disabled={!hasPhoto}
        onPress={onNext}
        style={({ pressed }) => [
          styles.nextButton,
          (pressed || !hasPhoto) && styles.nextButtonPressed,
        ]}
      >
        <Text style={styles.nextButtonText}>{nextLabel}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
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
    lineHeight: 26,
  },
  stepText: {
    color: colors.primary,
    fontSize: typography.label,
    fontWeight: '700',
  },
  cameraCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cameraPreview: {
    aspectRatio: 4 / 3,
    backgroundColor: '#D9E2EC',
    width: '100%',
  },
  cameraActions: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  permissionCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  permissionTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
  },
  permissionBody: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 60,
    paddingHorizontal: spacing.md,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryPressed,
    opacity: 0.92,
  },
  primaryButtonText: {
    color: colors.card,
    fontSize: typography.body,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonPressed: {
    opacity: 0.82,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  thumbnailSection: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '700',
  },
  emptyStateText: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
  },
  thumbnailRow: {
    gap: spacing.md,
    paddingRight: spacing.md,
  },
  thumbnailCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    gap: spacing.xs,
    padding: spacing.sm,
    width: 180,
  },
  thumbnailImage: {
    backgroundColor: colors.border,
    borderRadius: radius.md,
    height: 120,
    width: '100%',
  },
  thumbnailLabel: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: '600',
  },
  deleteButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  deleteButtonPressed: {
    opacity: 0.8,
  },
  deleteButtonText: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: '600',
  },
  nextButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 60,
  },
  nextButtonPressed: {
    backgroundColor: colors.primaryPressed,
    opacity: 0.92,
  },
  nextButtonText: {
    color: colors.card,
    fontSize: typography.body,
    fontWeight: '700',
  },
});

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { getSharedCaseDetail, type SharedCaseDetail } from '../api/staff';
import { getSupabaseClient } from '../lib/supabase';
import { colors, typography } from '../theme/tokens';

type StaffRecordsStackParamList = {
  StaffRecordsHome: undefined;
  StaffCaseDetail: { caseId: string; caseName: string | null };
  StaffDruglistDetail: { playlistId: string; playlistName: string };
};

type RouteType = RouteProp<StaffRecordsStackParamList, 'StaffCaseDetail'>;

interface DetectedItem {
  display_name?: string;
  nhi_code?: string;
  match_status?: string;
  confidence?: number;
  raw_text?: string;
}

const CASE_PHOTO_BUCKET = 'rx-case-photos';
const SIGNED_URL_EXPIRY = 60 * 60 * 24; // 24h

export function StaffCaseDetailScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteType>();
  const { caseId, caseName } = route.params;
  const [detail, setDetail] = useState<SharedCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [showFullImage, setShowFullImage] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getSharedCaseDetail(caseId);
        setDetail(data);

        // Load photo URLs
        if (data?.photo_paths?.length) {
          const client = getSupabaseClient();
          const firstPath = data.photo_paths[0];

          // Thumbnail
          const thumbPath = firstPath.replace(/\.jpg$/, '_thumb.jpg');
          const { data: thumbData } = await client.storage
            .from(CASE_PHOTO_BUCKET)
            .createSignedUrl(thumbPath, SIGNED_URL_EXPIRY);
          if (thumbData) setThumbUrl(thumbData.signedUrl);

          // Full image
          const { data: fullData } = await client.storage
            .from(CASE_PHOTO_BUCKET)
            .createSignedUrl(firstPath, SIGNED_URL_EXPIRY);
          if (fullData) setFullUrl(fullData.signedUrl);
        }
      } catch (err) {
        console.error('Failed to load case detail:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [caseId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t('staff.records.loadError')}</Text>
      </View>
    );
  }

  const items: DetectedItem[] = detail.detected_items ?? [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>{caseName || t('staff.records.unnamedCase')}</Text>
            <View style={styles.metaRow}>
              <Ionicons name="person-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{detail.patient_email}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{new Date(detail.created_at).toLocaleString()}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="medkit-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{items.length} {t('staff.records.medications')}</Text>
            </View>
          </View>

          {/* Photo Thumbnail */}
          {thumbUrl && (
            <Pressable style={styles.thumbContainer} onPress={() => setShowFullImage(true)}>
              <Image source={{ uri: thumbUrl }} style={styles.thumb} resizeMode="cover" />
              <View style={styles.zoomBadge}>
                <Ionicons name="expand" size={12} color="#fff" />
              </View>
            </Pressable>
          )}
        </View>
      </View>

      {/* Medications List */}
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${item.nhi_code || 'unknown'}-${index}`}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <View style={styles.medCard}>
            <View style={styles.medHeader}>
              <Text style={styles.medIndex}>#{index + 1}</Text>
              <Text style={styles.medName}>{item.display_name || item.raw_text || '—'}</Text>
            </View>
            {item.nhi_code && (
              <Text style={styles.medDetail}>NHI: {item.nhi_code}</Text>
            )}
            {item.match_status && (
              <Text style={styles.medDetail}>
                {t('staff.records.status')}: {item.match_status}
                {item.confidence != null ? ` (${Math.round(item.confidence * 100)}%)` : ''}
              </Text>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('staff.records.noMedications')}</Text>
          </View>
        }
      />

      {/* Fullscreen Image Modal */}
      <Modal visible={showFullImage} transparent animationType="fade" onRequestClose={() => setShowFullImage(false)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalClose} onPress={() => setShowFullImage(false)}>
            <Ionicons name="close-circle" size={36} color="#fff" />
          </Pressable>
          {fullUrl && (
            <Image source={{ uri: fullUrl }} style={styles.fullImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerContent: { flexDirection: 'row', gap: 14 },
  headerLeft: { flex: 1 },
  title: { fontSize: typography.title, fontWeight: '700', color: colors.text, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { fontSize: typography.label, color: colors.textMuted },
  thumbContainer: { width: 90, height: 90, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  thumb: { width: 90, height: 90 },
  zoomBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, padding: 3 },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  medCard: { backgroundColor: colors.card, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  medHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  medIndex: { fontSize: typography.label, fontWeight: '700', color: colors.primary },
  medName: { fontSize: typography.body, fontWeight: '600', color: colors.text, flex: 1 },
  medDetail: { fontSize: typography.label, color: colors.textMuted, marginBottom: 2 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: typography.body, color: colors.textMuted },
  errorText: { fontSize: typography.body, color: colors.textMuted },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  modalClose: { position: 'absolute', top: 50, right: 20, zIndex: 10 },
  fullImage: { width: '100%', height: '80%' },
});

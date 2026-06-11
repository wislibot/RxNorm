import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getMyHospitals, type Hospital } from '../api/hospitals';
import { getSharedHospitalIds, shareRecord, unshareRecord } from '../api/sharing';
import { colors, radius, spacing, typography } from '../theme/tokens';

type Props = {
  visible: boolean;
  recordType: 'case' | 'druglist';
  recordId: string;
  onClose: () => void;
};

export function ShareHospitalModal({ visible, recordType, recordId, onClose }: Props) {
  const { t } = useTranslation();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let isMounted = true;
    async function load() {
      setLoading(true);
      try {
        const [hospitalsData, sharedIdsData] = await Promise.all([
          getMyHospitals(),
          getSharedHospitalIds(recordType, recordId),
        ]);
        if (!isMounted) return;
        setHospitals(hospitalsData);
        setSharedIds(sharedIdsData);
      } catch {
        // silently fail
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => { isMounted = false; };
  }, [visible, recordType, recordId]);

  const handleToggle = useCallback(async (hospitalId: string, currentlyShared: boolean) => {
    setSharedIds((prev) => {
      const next = new Set(prev);
      if (currentlyShared) {
        next.delete(hospitalId);
      } else {
        next.add(hospitalId);
      }
      return next;
    });

    try {
      if (currentlyShared) {
        await unshareRecord(hospitalId, recordType, recordId);
      } else {
        await shareRecord(hospitalId, recordType, recordId);
      }
    } catch {
      setSharedIds((prev) => {
        const next = new Set(prev);
        if (currentlyShared) {
          next.add(hospitalId);
        } else {
          next.delete(hospitalId);
        }
        return next;
      });
    }
  }, [recordType, recordId]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{t('shareModalTitle')}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.modalDoneText}>{t('shareModalDone')}</Text>
          </Pressable>
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : hospitals.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>{t('careTeamsNoHospitals')}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {hospitals.map((hospital) => {
              const isShared = sharedIds.has(hospital.id);
              return (
                <View key={hospital.id} style={styles.hospitalRow}>
                  <View style={styles.hospitalInfo}>
                    <Text style={styles.hospitalNameZh}>{hospital.name_zh}</Text>
                    <Text style={styles.hospitalNameEn}>{hospital.name_en}</Text>
                  </View>
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>
                      {isShared ? t('shareToggleOn') : t('shareToggleOff')}
                    </Text>
                    <Switch
                      value={isShared}
                      onValueChange={() => handleToggle(hospital.id, isShared)}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    backgroundColor: colors.background,
    flex: 1,
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  modalDoneText: {
    color: colors.primary,
    fontSize: typography.body,
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
    gap: 0,
    padding: spacing.lg,
  },
  hospitalRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  hospitalInfo: {
    flex: 1,
    gap: 2,
  },
  hospitalNameZh: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    lineHeight: 26,
  },
  hospitalNameEn: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 22,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
});

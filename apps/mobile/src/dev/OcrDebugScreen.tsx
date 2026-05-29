import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Rect as SvgRect } from 'react-native-svg';

import { getCase, listCases } from '../api/case';
import type { RemoteOcrPage } from '../ocr/types';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { CaseRecord } from '../types/case';

type Props = {
  onBack?: () => void;
};

type RenderSize = {
  width: number;
  height: number;
};

export function mapBboxContain(
  bbox: number[],
  imgW: number,
  imgH: number,
  viewW: number,
  viewH: number,
) {
  const scale = Math.min(viewW / imgW, viewH / imgH);
  const offsetX = (viewW - imgW * scale) / 2;
  const offsetY = (viewH - imgH * scale) / 2;
  const [x1, y1, x2, y2] = bbox;
  return {
    x: x1 * scale + offsetX,
    y: y1 * scale + offsetY,
    w: Math.max(1, (x2 - x1) * scale),
    h: Math.max(1, (y2 - y1) * scale),
  };
}

type ConfidenceFilter = 'all' | '0.5' | '0.8';

export function OcrDebugScreen({ onBack }: Props) {
  const [lastCase, setLastCase] = useState<CaseRecord | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [page, setPage] = useState<RemoteOcrPage | null>(null);
  const [renderSize, setRenderSize] = useState<RenderSize>({ width: 0, height: 0 });
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('0.5');
  const [searchText, setSearchText] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const imgW = page?.width ?? 1;
  const imgH = page?.height ?? 1;

  const allElements = useMemo(() => page?.elements ?? [], [page]);

  const filteredElements = useMemo(() => {
    let els = allElements;
    if (confidenceFilter === '0.5') {
      els = els.filter((e) => e.confidence >= 0.5);
    } else if (confidenceFilter === '0.8') {
      els = els.filter((e) => e.confidence >= 0.8);
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      els = els.filter((e) => e.text.toLowerCase().includes(q));
    }
    return els;
  }, [allElements, confidenceFilter, searchText]);

  const mappedBoxes = useMemo(() => {
    if (!renderSize.width || !renderSize.height || !imgW || !imgH) {
      return [];
    }
    return filteredElements.map((e) => mapBboxContain(e.bbox, imgW, imgH, renderSize.width, renderSize.height));
  }, [filteredElements, imgW, imgH, renderSize]);

  useEffect(() => {
    if (!__DEV__) return;

    let cancelled = false;

    async function loadLatest() {
      try {
        const summaries = await listCases({ limit: 1 });
        if (cancelled) return;

        const latest = summaries[0];
        if (!latest) {
          setLoadError('No cases found. Create a case first.');
          setLoading(false);
          return;
        }

        const detail = await getCase(latest.caseId);
        if (cancelled) return;

        setLastCase(detail);

        const modelData = detail.ocrSections.remoteModel;
        if (!modelData?.pages?.length) {
          setLoadError('No remote model data found in this case.');
          setLoading(false);
          return;
        }

        const firstPage = modelData.pages[0];
        setPage(firstPage);

        if (detail.photoUrls?.[0]) {
          setPhotoUrl(detail.photoUrls[0]);
        }
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load case.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadLatest();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleImageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setRenderSize({ width, height });
  }, []);

  const handleFilterSelect = (f: ConfidenceFilter) => {
    setConfidenceFilter(f);
    setHighlightedIndex(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>DEV: OCR Debug (Remote Model)</Text>
        {onBack ? (
          <Pressable onPress={onBack} style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      ) : loadError ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Case photo + model boxes</Text>
            {photoUrl ? (
              <View style={styles.imageFrame}>
                <Image
                  onLayout={handleImageLayout}
                  resizeMode="contain"
                  source={{ uri: photoUrl }}
                  style={[
                    styles.image,
                    imgW && imgH ? { aspectRatio: imgW / imgH } : null,
                  ]}
                />
                {renderSize.width > 0 && renderSize.height > 0 && (
                  <Svg
                    width={renderSize.width}
                    height={renderSize.height}
                    style={styles.svgOverlay}
                  >
                    {mappedBoxes.map((r, idx) => (
                      <SvgRect
                        key={idx}
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        stroke={highlightedIndex === idx ? '#00ff00' : colors.primary}
                        strokeWidth={highlightedIndex === idx ? 2 : 1}
                        fill="transparent"
                        onPress={() => setHighlightedIndex(idx === highlightedIndex ? null : idx)}
                      />
                    ))}
                  </Svg>
                )}
              </View>
            ) : (
              <Text style={styles.body}>No photo available.</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <Text style={styles.body}>
              Engine: {page?.width ? lastCase?.ocrSections.remoteModel?.engine : 'N/A'}
            </Text>
            <Text style={styles.body}>
              Page: {imgW} × {imgH}
            </Text>
            <Text style={styles.body}>
              Total elements: {allElements.length}
            </Text>
            <Text style={styles.body}>
              Showing: {filteredElements.length}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Filter</Text>
            <View style={styles.filterRow}>
              {(['all', '0.5', '0.8'] as ConfidenceFilter[]).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => handleFilterSelect(f)}
                  style={({ pressed }) => [
                    styles.filterChip,
                    confidenceFilter === f && styles.filterChipActive,
                    pressed && styles.filterChipPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      confidenceFilter === f && styles.filterChipTextActive,
                    ]}
                  >
                    {f === 'all' ? 'All' : `≥ ${f}`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              placeholder="Search text..."
              placeholderTextColor={colors.textMuted}
              onChangeText={setSearchText}
              value={searchText}
              style={styles.searchInput}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Elements ({filteredElements.length})</Text>
            <ScrollView style={styles.elementList} nestedScrollEnabled>
              {filteredElements.map((e, idx) => {
                const isHighlighted = idx === highlightedIndex;
                return (
                  <Pressable
                    key={idx}
                    onPress={() => setHighlightedIndex(isHighlighted ? null : idx)}
                    style={({ pressed }) => [
                      styles.elementRow,
                      isHighlighted && styles.elementRowHighlighted,
                      pressed && styles.elementRowPressed,
                    ]}
                  >
                    <Text style={styles.elementIndex}>{idx + 1}.</Text>
                    <View style={styles.elementContent}>
                      <Text style={styles.elementText} numberOfLines={2}>
                        {e.text}
                      </Text>
                      <Text style={styles.elementMeta}>
                        conf: {e.confidence.toFixed(2)} | bbox: [{e.bbox.join(', ')}]
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {filteredElements.length === 0 && (
                <Text style={styles.body}>No elements match the current filter.</Text>
              )}
            </ScrollView>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: spacing.md,
  },
  backButtonPressed: {
    opacity: 0.8,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: typography.label,
    fontWeight: '700',
  },
  spinner: {
    marginTop: spacing.xl,
  },
  card: {
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
  imageFrame: {
    position: 'relative',
  },
  image: {
    alignSelf: 'stretch',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    width: '100%',
  },
  svgOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipPressed: {
    opacity: 0.8,
  },
  filterChipText: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  searchInput: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: typography.label,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  elementList: {
    maxHeight: 400,
  },
  elementRow: {
    borderBottomColor: colors.background,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  elementRowHighlighted: {
    backgroundColor: 'rgba(0,255,0,0.08)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  elementRowPressed: {
    opacity: 0.7,
  },
  elementIndex: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: '600',
    minWidth: 30,
  },
  elementContent: {
    flex: 1,
  },
  elementText: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: '600',
  },
  elementMeta: {
    color: colors.textMuted,
    fontSize: typography.small,
    marginTop: 2,
  },
  body: {
    color: colors.text,
    fontSize: typography.label,
    lineHeight: 22,
  },
  errorText: {
    color: colors.error,
    fontSize: typography.label,
    lineHeight: 22,
  },
});

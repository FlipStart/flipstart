/**
 * PhotoReview — Vintage parchment confirmation screen
 *
 * Single-screen flex layout — no ScrollView.
 * Everything fits on one iPhone screen using proportional flex allocation.
 *
 * Spacing constants at top for easy tuning.
 */

import {
  View, Text, Pressable, StyleSheet,
  ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native';
import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FONTS } from '@/constants/typography';
import { captureFromCamera, captureFromGallery } from '@/lib/capture';
import type { CapturedPhoto, CapturedPhotoSet, PhotoSlot } from '@/lib/capture';
import { SLOT_LABELS, SLOT_ORDER } from '@/lib/capture';

// ─── Spacing constants (tune these to adjust layout) ─────────────────────────
const SP = {
  headerPadV:      2,
  dividerMT:       5,
  titleMT:         4,
  titleToSub:      1,
  subToImage:      4,
  imageToThumb:    12,
  thumbToHint:     10,
  hintToTips:      10,
  thumbToTips:     10,
  tipsToAnalyze:   12,
  analyzeToBtnGap: 3,
  retakeToPrivacy: 8,
  thumbSize:       50,
  imageFlexGrow:   1,
};

// ─── Palette ──────────────────────────────────────────────────────────────────
const PARCHMENT    = '#ECE0C2';
const PARCHMENT_D  = '#D9C9A3';
const PARCHMENT_DD = '#C4AD82';
const FOREST       = '#1C3820';
const FOREST_BTN   = '#243E28';
const FOREST_MID   = '#2E5233';
const CREAM_TEXT   = '#F5EDD4';
const WARM_BROWN   = '#5A3A1A';
const MUTED_BROWN  = '#7A5A38';
const GOLD         = '#BE9C2C';
const CARD_BG      = 'rgba(250,242,218,0.92)';

// ─── Tips ─────────────────────────────────────────────────────────────────────
const TIPS: { icon: keyof typeof MaterialIcons.glyphMap; label: string }[] = [
  { icon: 'wb-sunny',            label: 'Good\nlighting'    },
  { icon: 'filter-center-focus', label: 'Centered\nsubject' },
  { icon: 'layers',              label: 'Single\nitem'      },
  { icon: 'crop-free',           label: 'Flat,\nclear bg'   },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface PhotoReviewProps {
  photoSet:          CapturedPhotoSet;
  onAnalyze:         () => void;
  onRetake:          () => void;
  isAnalyzing:       boolean;
  onPhotoSetUpdate?: (set: CapturedPhotoSet) => void;
}

export function PhotoReview({
  photoSet, onAnalyze, onRetake, isAnalyzing, onPhotoSetUpdate,
}: PhotoReviewProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [viewingSlot,    setViewingSlot]    = useState<PhotoSlot>('front');
  const [removedPhotos, setRemovedPhotos] = useState<Partial<Record<PhotoSlot, CapturedPhoto>>>({});

  useEffect(() => {
    Asset.loadAsync([
      require('@/assets/images/scan-loading-bg.png'),
      require('@/assets/images/sounds/coin-pour.mp3'),
    ]).catch(() => {});
  }, []);

  const getSlotPhoto = (slot: PhotoSlot): CapturedPhoto | undefined =>
    slot === 'front' ? photoSet.front
    : slot === 'back'  ? photoSet.back
    :                    photoSet.tag;

  const filledSlots  = SLOT_ORDER.filter(sl => !!getSlotPhoto(sl));
  const viewingPhoto = getSlotPhoto(viewingSlot) ?? photoSet.front ?? photoSet.primary;
  const viewingIndex = filledSlots.indexOf(viewingSlot);
  const totalFilled  = filledSlots.length;

  const goNext = () => {
    const i = filledSlots.indexOf(viewingSlot);
    if (i < filledSlots.length - 1) setViewingSlot(filledSlots[i + 1]);
  };
  const goPrev = () => {
    const i = filledSlots.indexOf(viewingSlot);
    if (i > 0) setViewingSlot(filledSlots[i - 1]);
  };

  const handleRemove = (slot: PhotoSlot) => {
    if (slot === 'front') {
      Alert.alert('Remove Front Photo?', 'This is the primary photo.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
            onPhotoSetUpdate?.({ back: photoSet.back, tag: photoSet.tag });
            onRetake();
        }},
      ]);
      return;
    }
    // Save for undo before deleting
    const removed = getSlotPhoto(slot);
    if (removed) {
      setRemovedPhotos(prev => ({ ...prev, [slot]: removed }));
    }
    const next: CapturedPhotoSet = { ...photoSet };
    delete (next as any)[slot];
    onPhotoSetUpdate?.(next);
    if (viewingSlot === slot) setViewingSlot('front');
  };

  const handleUndo = (slot: PhotoSlot) => {
    const photo = removedPhotos[slot];
    if (!photo) return;
    onPhotoSetUpdate?.({ ...photoSet, [slot]: photo });
    setRemovedPhotos(prev => { const n = { ...prev }; delete n[slot]; return n; });
    setViewingSlot(slot);
  };

  const handleAddOrReplace = (slot: PhotoSlot) => {
    Alert.alert(
      `${SLOT_LABELS[slot]} Photo`,
      getSlotPhoto(slot) ? 'Replace this photo?' : 'Add a photo for this slot.',
      [
        { text: 'Take Photo', onPress: async () => {
            const p = await captureFromCamera();
            if (!p) return;
            onPhotoSetUpdate?.({ ...photoSet, [slot]: p });
            setViewingSlot(slot);
        }},
        { text: 'Choose from Library', onPress: async () => {
            const p = await captureFromGallery();
            if (!p) return;
            onPhotoSetUpdate?.({ ...photoSet, [slot]: p });
            setViewingSlot(slot);
        }},
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handleRetakeTap = () => {
    Alert.alert('Photos', 'What would you like to do?', [
      { text: 'Take Photo', onPress: async () => {
          const p = await captureFromCamera();
          if (p) onPhotoSetUpdate?.({ ...photoSet, front: p }) ?? onRetake();
      }},
      { text: 'Choose from Library', onPress: async () => {
          const p = await captureFromGallery();
          if (p) onPhotoSetUpdate?.({ ...photoSet, front: p }) ?? onRetake();
      }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  };


  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 2 }]}>

      {/* ── Header panel ───────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Pressable onPress={onRetake} hitSlop={10}
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.65 }]}>
          <MaterialIcons name="arrow-back" size={20} color={WARM_BROWN} />
        </Pressable>

        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>FlipStart</Text>
          <Text style={s.headerSub}>CONFIRM ITEM</Text>
          <View style={s.headerDivider} />
        </View>

        <Pressable hitSlop={10}
          onPress={() => router.push('/(tabs)/settings' as any)}
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.65 }]}>
          <MaterialIcons name="settings" size={20} color={WARM_BROWN} />
        </Pressable>
      </View>

      {/* ── "Is this the item?" ─────────────────────────────────────────────── */}
      <View style={[s.titleBlock, { marginTop: SP.titleMT }]}>
        <View style={s.titleRow}>
          <Text style={s.titleDeco}>✦</Text>
          <Text style={s.titleText}>Is this the item?</Text>
          <Text style={s.titleDeco}>✦</Text>
        </View>
        <Text style={[s.titleSub, { marginTop: SP.titleToSub }]}>
          Review your photos before analyzing.
        </Text>
      </View>

      {/* ── Main image (flex-grows to fill available height) ───────────────── */}
      <View style={[s.imageWrap, { marginTop: SP.subToImage, height: Math.round(screenH * 0.35) }]}>
        {/* FRONT badge — overlaps top-left of image */}
        <View style={s.slotBadge}>
          <Text style={s.slotBadgeText}>{SLOT_LABELS[viewingSlot].toUpperCase()}</Text>
        </View>

        <View style={s.imageFrame}>
          {viewingPhoto ? (
            <Image
              source={{ uri: viewingPhoto.uri }}
              style={s.imageImg}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={s.imageEmpty}>
              <MaterialIcons name="photo-camera" size={40} color={PARCHMENT_DD} />
            </View>
          )}

          {/* Vignette depth */}
          <View style={s.vignette} pointerEvents="none" />

          {/* Arrows */}
          {viewingIndex > 0 && (
            <Pressable onPress={goPrev}
              style={({ pressed }) => [s.arrow, s.arrowL, pressed && { opacity: 0.7 }]}>
              <MaterialIcons name="chevron-left" size={26} color={WARM_BROWN} />
            </Pressable>
          )}
          {viewingIndex < totalFilled - 1 && (
            <Pressable onPress={goNext}
              style={({ pressed }) => [s.arrow, s.arrowR, pressed && { opacity: 0.7 }]}>
              <MaterialIcons name="chevron-right" size={26} color={WARM_BROWN} />
            </Pressable>
          )}

          {/* Counter */}
          {totalFilled > 1 && (
            <View style={s.counter}>
              <Text style={s.counterText}>{viewingIndex + 1} / {totalFilled}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Thumbnails ──────────────────────────────────────────────────────── */}
      <View style={[s.thumbRow, { marginTop: SP.imageToThumb }]}>
        {SLOT_ORDER.map((slot) => {
          const photo  = getSlotPhoto(slot);
          const active = slot === viewingSlot;
          return (
            <View key={slot} style={s.thumbWrap}>
              {photo && (
                <Pressable onPress={() => handleRemove(slot)}
                  hitSlop={6} style={s.removeBtn}>
                  <MaterialIcons name="close" size={10} color={CREAM_TEXT} />
                </Pressable>
              )}
              {/* Undo button — appears after removing a non-front photo */}
              {!photo && slot !== 'front' && removedPhotos[slot] && (
                <Pressable onPress={() => handleUndo(slot)}
                  hitSlop={6} style={s.undoBtn}>
                  <MaterialIcons name="undo" size={10} color={CREAM_TEXT} />
                </Pressable>
              )}
              <Pressable
                onPress={() => photo ? setViewingSlot(slot) : handleAddOrReplace(slot)}
                style={[s.thumbFrame, active && s.thumbActive, !photo && s.thumbEmpty]}
              >
                {photo
                  ? <Image source={{ uri: photo.uri }} style={s.thumbImg} contentFit="cover" cachePolicy="memory-disk" />
                  : <View style={s.thumbPlaceholder}>
                      <MaterialIcons name="add-a-photo" size={16} color={PARCHMENT_DD} />
                    </View>
                }
              </Pressable>
              <Text style={[s.thumbLabel, active && s.thumbLabelActive]}>
                {SLOT_LABELS[slot]}
                {!photo && slot !== 'front' && (
                  <Text style={s.thumbOptional}>{'\n'}optional</Text>
                )}
              </Text>
            </View>
          );
        })}
      </View>



      {/* ── Tips card ───────────────────────────────────────────────────────── */}
      <View style={[s.tipsCard, { marginTop: SP.thumbToTips }]}>
        <View style={[s.orn, s.ornTL]} /><View style={[s.orn, s.ornTR]} />
        <View style={[s.orn, s.ornBL]} /><View style={[s.orn, s.ornBR]} />
        <Text style={s.tipsTitle}>✦  TIPS FOR THE BEST RESULTS  ✦</Text>
        <View style={s.tipsRow}>
          {TIPS.map((tip, i) => (
            <View key={tip.label} style={s.tipItem}>
              {i > 0 && <View style={s.tipSep} />}
              <MaterialIcons name={tip.icon} size={20} color={FOREST} />
              <Text style={s.tipLabel}>{tip.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Analyze button ──────────────────────────────────────────────────── */}
      <Pressable onPress={onAnalyze} disabled={isAnalyzing}
        style={({ pressed }) => [
          s.analyzeBtn,
          { marginTop: SP.tipsToAnalyze },
          pressed && !isAnalyzing && { transform: [{ scale: 0.97 }], opacity: 0.93 },
          isAnalyzing && { opacity: 0.72 },
        ]}>
        {isAnalyzing
          ? <ActivityIndicator size="small" color={CREAM_TEXT} />
          : <MaterialIcons name="auto-awesome" size={18} color={GOLD} />}
        <Text style={s.analyzeBtnText}>
          {isAnalyzing ? 'Preparing...' : 'Analyze Item'}
        </Text>
      </Pressable>

      {/* ── Retake button ───────────────────────────────────────────────────── */}
      <Pressable onPress={handleRetakeTap} disabled={isAnalyzing}
        style={({ pressed }) => [
          s.retakeBtn,
          { marginTop: SP.analyzeToBtnGap },
          pressed && { opacity: 0.65 },
          isAnalyzing && { opacity: 0.4 },
        ]}>
        <MaterialIcons name="replay" size={13} color={MUTED_BROWN} />
        <Text style={s.retakeBtnText}>Retake Photos</Text>
      </Pressable>

      {/* ── Privacy — pushed to bottom by spacer ─────────────────────────── */}
      <View style={{ flex: 1 }} />
      <View style={s.privacy}>
        <MaterialIcons name="lock-outline" size={10} color={PARCHMENT_DD} />
        <Text style={s.privacyText}>Photos are used only for analysis and never stored.</Text>
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: PARCHMENT,
    paddingHorizontal: 16,
  },

  // Header
  header: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    paddingTop:     SP.headerPadV,
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: PARCHMENT_D, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: PARCHMENT_DD,
    shadowColor: WARM_BROWN, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.10, shadowRadius: 2, elevation: 2,
    marginTop: 4,
  },
  headerCenter:  { alignItems: 'center', flex: 1, paddingHorizontal: 8 },
  headerTitle:   { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: FOREST, letterSpacing: -0.3 },
  headerSub:     { fontFamily: FONTS.serif, fontSize: 9, fontWeight: '700', color: GOLD, letterSpacing: 2.5, marginTop: 1 },
  headerDivider: {
    marginTop:       SP.dividerMT,
    width:           '90%',
    height:          2,
    backgroundColor: FOREST,
    opacity:         0.50,
    borderRadius:    1,
  },

  // Title
  titleBlock: { alignItems: 'center' },
  titleRow:   { flexDirection: 'row', alignItems: 'center', gap: 7 },
  titleDeco:  { fontSize: 16, color: GOLD },
  titleText:  { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: FOREST },
  titleSub:   { fontSize: 11, color: MUTED_BROWN },

  imageWrap: {
    width:    '100%',
    position: 'relative',
  },
  slotBadge: {
    position:          'absolute',
    top:               -1,
    left:              10,
    zIndex:            20,
    backgroundColor:   FOREST_BTN,
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:      6,
    borderWidth:       1,
    borderColor:       FOREST_MID,
  },
  slotBadgeText: { fontFamily: FONTS.serif, fontSize: 10, fontWeight: '700', color: CREAM_TEXT, letterSpacing: 1.4 },

  imageFrame: {
    flex:            1,
    borderRadius:    12,
    overflow:        'hidden',
    backgroundColor: PARCHMENT_D,
    borderWidth:     3,
    borderColor:     PARCHMENT_DD,
    shadowColor:     '#1A0A00',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.22,
    shadowRadius:    10,
    elevation:       6,
    marginTop:       12,   // space for badge to overlap top
  },
  imageImg:   { width: '100%', height: '100%' },
  imageEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  vignette:   {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 14, borderColor: 'rgba(20,10,0,0.10)', borderRadius: 12,
  },

  arrow: {
    position: 'absolute', top: '50%', marginTop: -20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(217,201,163,0.90)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: WARM_BROWN, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15, shadowRadius: 3, elevation: 3,
  },
  arrowL: { left: 8 },
  arrowR: { right: 8 },

  counter: {
    position: 'absolute', bottom: 8,
    left: '50%', marginLeft: -25, width: 50,
    backgroundColor: 'rgba(217,201,163,0.92)',
    borderRadius: 20, paddingVertical: 2, alignItems: 'center',
  },
  counterText: { fontFamily: FONTS.serif, fontSize: 12, fontWeight: '700', color: FOREST },

  // Thumbnails
  thumbRow:  { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  thumbWrap: { alignItems: 'center', gap: 4, position: 'relative' },

  removeBtn: {
    position:        'absolute',
    top:             -8, right: -8,
    zIndex:          20,
    width:           20, height: 20, borderRadius: 10,
    backgroundColor: FOREST_BTN,
    borderWidth:     1.5, borderColor: 'rgba(255,255,255,0.30)',
    justifyContent:  'center', alignItems: 'center',
    shadowColor:     '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity:   0.20, shadowRadius: 2, elevation: 4,
  },
  undoBtn: {
    position:        'absolute',
    top:             -8, right: -8,
    zIndex:          20,
    width:           20, height: 20, borderRadius: 10,
    backgroundColor: '#7A5A38',   // warm brown — distinct from green remove btn
    borderWidth:     1.5, borderColor: 'rgba(255,255,255,0.30)',
    justifyContent:  'center', alignItems: 'center',
    shadowColor:     '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity:   0.20, shadowRadius: 2, elevation: 4,
  },

  thumbFrame: {
    width: SP.thumbSize, height: SP.thumbSize, borderRadius: 8,
    overflow: 'hidden', borderWidth: 2, borderColor: PARCHMENT_DD,
    backgroundColor: PARCHMENT_D,
  },
  thumbActive: {
    borderColor: FOREST, borderWidth: 2.5,
    shadowColor: FOREST, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20, shadowRadius: 4, elevation: 3,
  },
  thumbEmpty:  { borderStyle: 'dashed', opacity: 0.70 },
  thumbImg:    { width: '100%', height: '100%' },
  thumbPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  thumbLabel:       { fontFamily: FONTS.serif, fontSize: 10, fontWeight: '700', color: MUTED_BROWN, textAlign: 'center' },
  thumbLabelActive: { color: FOREST },
  thumbOptional:    { fontSize: 9, fontWeight: '400', color: PARCHMENT_DD },



  // Tips
  tipsCard: {
    backgroundColor: CARD_BG,
    borderRadius: 10, borderWidth: 1, borderColor: PARCHMENT_DD,
    paddingHorizontal: 10, paddingTop: 5, paddingBottom: 5,
    position: 'relative',
  },
  orn:   { position: 'absolute', width: 10, height: 10, borderColor: PARCHMENT_DD },
  ornTL: { top: 4, left: 4,    borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  ornTR: { top: 4, right: 4,   borderTopWidth: 1.5, borderRightWidth: 1.5 },
  ornBL: { bottom: 4, left: 4,  borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
  ornBR: { bottom: 4, right: 4, borderBottomWidth: 1.5, borderRightWidth: 1.5 },

  tipsTitle: {
    fontFamily: FONTS.serif, fontSize: 9, fontWeight: '700',
    color: FOREST, textAlign: 'center', letterSpacing: 1, marginBottom: 6,
  },
  tipsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  tipItem: { alignItems: 'center', gap: 4, flex: 1, position: 'relative' },
  tipSep:  {
    position: 'absolute', left: 0, top: '15%',
    width: 1, height: '70%', backgroundColor: PARCHMENT_DD + '60',
  },
  tipLabel: {
    fontFamily: FONTS.serif, fontSize: 9, fontWeight: '600',
    color: WARM_BROWN, textAlign: 'center', lineHeight: 12,
  },

  // Buttons
  analyzeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 10, borderRadius: 50,
    backgroundColor: FOREST_BTN,
    borderWidth: 1, borderColor: FOREST_MID,
    shadowColor: FOREST, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28, shadowRadius: 7, elevation: 5,
  },
  analyzeBtnText: {
    fontFamily: FONTS.serif, fontSize: 16, fontWeight: '800',
    color: CREAM_TEXT, letterSpacing: 0.2,
  },

  retakeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 50,
    borderWidth: 1, borderColor: PARCHMENT_DD,
    backgroundColor: 'rgba(210,190,150,0.20)',
  },
  retakeBtnText: {
    fontFamily: FONTS.serif, fontSize: 13, fontWeight: '600', color: MUTED_BROWN,
  },

  // Privacy
  privacy:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  privacyText: { fontSize: 9, color: PARCHMENT_DD, textAlign: 'center' },
});
/**
 * app/camera.tsx — FlipStart custom camera screen
 *
 * Multi-slot capture: Front (required) + Tag + Graphic (optional).
 * Done → setPendingScan → navigate directly to /loading (no confirmation screen).
 *
 * Features:
 *   - Done: skips confirmation, goes straight to analysis
 *   - Delete + Undo: 4-second undo snackbar after removing a photo
 *   - Magnify: tap zoom icon on any thumbnail to preview full-size
 *   - Drag-drop: long-press a photo → drag to swap with another slot
 *   - Category carousel: switches slot labels per item type (display only)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, Alert, Platform, ScrollView,
  Modal, Animated, PanResponder, TouchableWithoutFeedback, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { V } from '@/constants/vintage';
import { FONTS } from '@/constants/typography';
import { setPendingScan } from '@/lib/pending-scan';
import {
  captureMultipleFromGallery,
  type CapturedPhoto,
  type PhotoSlot,
  SLOT_ORDER,
} from '@/lib/capture';

// ─── Colors ───────────────────────────────────────────────────────────────────

const GOLD     = '#BE9C2C';
const GOLD_DIM = 'rgba(190,156,44,0.35)';
const CREAM    = '#FFFEFA';
const BG       = '#162D1A';
const GHOST_SIZE = 70;

// ─── Category definitions ─────────────────────────────────────────────────────
// Labels map to fixed PhotoSlot keys: front / tag / detail.
// Only what the USER SEES changes. The AI always receives front/tag/detail.
// Order is based on thrift frequency and resale behavior — do not rearrange.

type CategoryLabels = Record<PhotoSlot, string>;

interface Category {
  name:   string;
  icon?:  string;   // MaterialIcons name (gray)
  emoji?: string;   // emoji — only where no good icon exists
  labels: CategoryLabels;
  badge:  (slot: PhotoSlot) => string;
}

const CATEGORIES: Category[] = [
  {
    name:   'Clothing',
    icon:   'checkroom',
    labels: { front: 'Front', tag: 'Tag', detail: 'Graphic' },
    badge:  (s) => s === 'front' ? 'Front (required)' : s === 'tag' ? 'Tag (optional)' : 'Graphic (optional)',
  },
  {
    name:   'Shoes',
    emoji:  '👟',
    labels: { front: 'Profile', tag: 'Size Tag', detail: 'Sole' },
    badge:  (s) => s === 'front' ? 'Profile (required)' : s === 'tag' ? 'Size Tag (optional)' : 'Sole (optional)',
  },
  {
    name:   'Hats',
    emoji:  '🧢',
    labels: { front: 'Front', tag: 'Tag', detail: 'Detail' },
    badge:  (s) => s === 'front' ? 'Front (required)' : s === 'tag' ? 'Tag (optional)' : 'Detail (optional)',
  },
  {
    name:   'Electronics',
    icon:   'devices',
    labels: { front: 'Front', tag: 'Model #', detail: 'Back' },
    badge:  (s) => s === 'front' ? 'Front (required)' : s === 'tag' ? 'Model # (optional)' : 'Back (optional)',
  },
  {
    name:   'Purses',
    icon:   'shopping-bag',
    labels: { front: 'Front', tag: 'Tag', detail: 'Logo' },
    badge:  (s) => s === 'front' ? 'Front (required)' : s === 'tag' ? 'Tag (optional)' : 'Logo (optional)',
  },
  {
    name:   'Furniture',
    icon:   'weekend',
    labels: { front: 'Full Item', tag: 'Label', detail: 'Extra' },
    badge:  (s) => s === 'front' ? 'Full Item (required)' : s === 'tag' ? 'Label (optional)' : 'Extra (optional)',
  },
];

const NUM_CATS = CATEGORIES.length;

// Carousel scroll constants — defined after NUM_CATS so the reference is valid
const ITEM_W      = 90;
const COPIES      = 20;
const TOTAL_ITEMS = NUM_CATS * COPIES;
const START_V     = NUM_CATS * Math.floor(COPIES / 2);

// ─── Category carousel component ─────────────────────────────────────────────
// Uses a ScrollView with scrollEnabled=false and programmatic scrollTo for
// native-thread smooth sliding. No Animated.Value reset = no jump ever.

// Pre-build the repeated items array once (outside component to avoid recreation)
const CAROUSEL_ITEMS = Array.from(
  { length: TOTAL_ITEMS },
  (_, i) => ({ cat: CATEGORIES[i % NUM_CATS], virtualIndex: i })
);

function CategoryCarousel({
  index, onPrev, onNext,
}: {
  index:  number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const scrollRef    = useRef<ScrollView>(null);
  const virtualRef   = useRef(START_V);  // tracks position in the repeated list
  const isScrolling  = useRef(false);

  // Initial scroll position: show prev | CURR | next
  // scrollX = (virtualRef - 1) * ITEM_W so curr lands in center slot
  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        x: (virtualRef.current - 1) * ITEM_W,
        animated: false,
      });
    }, 0);
  }, []);

  const go = (dir: 1 | -1) => {
    if (isScrolling.current) return;
    isScrolling.current = true;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    virtualRef.current += dir;
    scrollRef.current?.scrollTo({
      x: (virtualRef.current - 1) * ITEM_W,
      animated: true,
    });
    if (dir === 1) onNext(); else onPrev();
    // Re-enable after animation completes (~250ms native scroll)
    setTimeout(() => { isScrolling.current = false; }, 280);
  };

  return (
    <View style={cc.wrap}>
      <Pressable
        onPress={() => go(-1)}
        hitSlop={14}
        style={({ pressed }) => [cc.arrow, pressed && { opacity: 0.4 }]}
      >
        <MaterialIcons name="chevron-left" size={24} color="rgba(236,231,211,0.40)" />
      </Pressable>

      <ScrollView
        ref={scrollRef}
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={cc.scroll}
        contentContainerStyle={cc.track}
      >
        {CAROUSEL_ITEMS.map(({ cat, virtualIndex }) => {
          const isActive = virtualIndex % NUM_CATS === index;
          return (
            <View key={virtualIndex} style={[cc.item, isActive && cc.itemActive]}>
              {cat.emoji ? (
                <Text style={{ fontSize: isActive ? 26 : 20, opacity: isActive ? 1 : 0.40 }}>
                  {cat.emoji}
                </Text>
              ) : (
                <MaterialIcons
                  name={cat.icon as any}
                  size={isActive ? 26 : 21}
                  color={isActive ? 'rgba(236,231,211,0.90)' : 'rgba(236,231,211,0.28)'}
                />
              )}
              <Text style={isActive ? cc.labelActive : cc.labelSide}>
                {cat.name}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={() => go(1)}
        hitSlop={14}
        style={({ pressed }) => [cc.arrow, pressed && { opacity: 0.4 }]}
      >
        <MaterialIcons name="chevron-right" size={24} color="rgba(236,231,211,0.40)" />
      </Pressable>
    </View>
  );
}

const cc = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    width:             '100%',
    paddingHorizontal: 8,
    paddingBottom:     16,
  },
  arrow: {
    flex:           1,          // equal flex on both sides = ScrollView perfectly centered
    alignItems:     'center',
    justifyContent: 'center',
  },
  // ScrollView: fixed width shows exactly 3 items (prev + curr + next)
  scroll: {
    width:    ITEM_W * 3,
    flexGrow: 0,
  },
  track: {
    flexDirection: 'row',
  },
  item: {
    width:          ITEM_W,
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical:6,
    gap:            4,
  },
  // Active item: same size, subtly brighter — confident not loud
  itemActive: {},
  labelActive: {
    fontSize:      12,
    fontWeight:    '800',
    color:         CREAM,
    letterSpacing: 0.4,
    // Subtle text glow approximated via opacity 1 vs side opacity
    textShadowColor:  'rgba(236,231,211,0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  labelSide: {
    fontSize:   11,
    fontWeight: '400',
    color:      'rgba(236,231,211,0.32)',
  },
});

// ─── Main component ────────────────────────────────────────────────────────────

export default function CameraScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  // ── Core photo state (unchanged) ────────────────────────────────────────────
  const [slots, setSlots]           = useState<Partial<Record<PhotoSlot, CapturedPhoto>>>({});
  const [activeSlot, setActiveSlot] = useState<PhotoSlot>('front');
  const [isTaking, setIsTaking]     = useState(false);

  // ── Undo state ──────────────────────────────────────────────────────────────
  // No timer — undo stays until user taps it or takes a new photo in that slot
  const [undoData, setUndoData] = useState<{ slot: PhotoSlot; photo: CapturedPhoto } | null>(null);

  // ── Magnify preview (unchanged) ─────────────────────────────────────────────
  const [previewPhoto, setPreviewPhoto] = useState<CapturedPhoto | null>(null);

  // ── Drag-drop state (unchanged) ─────────────────────────────────────────────
  const [dragSource, setDragSource] = useState<PhotoSlot | null>(null);
  const [dragTarget, setDragTarget] = useState<PhotoSlot | null>(null);
  const dragX          = useRef(new Animated.Value(0)).current;
  const dragY          = useRef(new Animated.Value(0)).current;
  const isDraggingRef  = useRef(false);
  const dragSourceRef  = useRef<PhotoSlot | null>(null);
  const slotsRef       = useRef<Partial<Record<PhotoSlot, CapturedPhoto>>>({});
  const slotLayouts    = useRef<Partial<Record<PhotoSlot, { x: number; y: number; width: number; height: number }>>>({});
  const slotViewRefs   = useRef<Partial<Record<PhotoSlot, View | null>>>({});

  // ── Category carousel state ──────────────────────────────────────────────────
  const [catIndex, setCatIndex] = useState(0); // 0 = Clothing (default)
  const handlePrev = () => setCatIndex(i => (i - 1 + NUM_CATS) % NUM_CATS);
  const handleNext = () => setCatIndex(i => (i + 1) % NUM_CATS);

  const currentCategory = CATEGORIES[catIndex];

  // ── Keep slotsRef in sync ────────────────────────────────────────────────────
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  const haptic = (s: Haptics.ImpactFeedbackStyle) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(s).catch(() => {});
  };

  const getNextEmptySlot = useCallback(
    (current: Partial<Record<PhotoSlot, CapturedPhoto>>): PhotoSlot => {
      for (const slot of SLOT_ORDER) { if (!current[slot]) return slot; }
      return 'tag';
    },
    [],
  );

  // ── Capture (unchanged) ───────────────────────────────────────────────────
  const handleCapture = async () => {
    if (isTaking || !cameraRef.current) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setIsTaking(true);
    try {
      const pic = await cameraRef.current.takePictureAsync({
        base64: true, quality: 0.55, exif: false,
      });
      if (!pic?.base64) return;
      const prefix   = pic.base64.substring(0, 12);
      const mimeType = prefix.startsWith('/9j/') ? 'image/jpeg'
                     : prefix.startsWith('iVBOR') ? 'image/png'
                     : 'image/jpeg';
      const photo: CapturedPhoto = { uri: pic.uri, base64: pic.base64, mimeType };
      if (undoData?.slot === activeSlot) setUndoData(null);
      const next = { ...slots, [activeSlot]: photo };
      setSlots(next);
      setActiveSlot(getNextEmptySlot(next));
      haptic(Haptics.ImpactFeedbackStyle.Light);
      console.log(`[camera] captured ${activeSlot}`);
    } catch (err) {
      console.error('[camera] capture error:', err);
      Alert.alert('Capture Failed', 'Could not take photo. Please try again.');
    } finally {
      setIsTaking(false);
    }
  };

  // ── Gallery (unchanged) ───────────────────────────────────────────────────
  const handleGallery = async () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    const photos = await captureMultipleFromGallery(3);
    if (!photos || photos.length === 0) return;
    const next = { ...slots };
    for (let i = 0; i < photos.length; i++) { next[SLOT_ORDER[i]] = photos[i]; }
    setSlots(next);
    setActiveSlot(getNextEmptySlot(next));
    setUndoData(null); // clear undo on gallery import
  };

  const handleRemove = (slot: PhotoSlot) => {
    const removed = slots[slot];
    if (!removed) return;
    haptic(Haptics.ImpactFeedbackStyle.Light);
    const next = { ...slots };
    delete next[slot];
    setSlots(next);
    setActiveSlot(slot);
    setUndoData({ slot, photo: removed }); // stays until undo pressed or new photo taken
  };

  const handleUndo = () => {
    if (!undoData) return;
    setSlots(prev => ({ ...prev, [undoData.slot]: undoData.photo }));
    setUndoData(null);
    haptic(Haptics.ImpactFeedbackStyle.Light);
  };

  // ── Slot tap (unchanged) ──────────────────────────────────────────────────
  const handleSlotTap = (slot: PhotoSlot) => {
    if (isDraggingRef.current) return;
    if (slots[slot] && slot === activeSlot) {
      handleRemove(slot);
    } else {
      setActiveSlot(slot);
    }
  };

  // ── Done → directly to loading (unchanged) ────────────────────────────────
  const handleDone = () => {
    if (!slots.front) {
      Alert.alert('Front Photo Required', 'Take a Front photo first before analyzing.');
      return;
    }
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    setPendingScan({
      front: { base64: slots.front.base64, mimeType: slots.front.mimeType },
      ...(slots.detail?.base64 ? { detail: { base64: slots.detail.base64, mimeType: slots.detail.mimeType } } : {}),
      ...(slots.tag?.base64    ? { tag:    { base64: slots.tag.base64,    mimeType: slots.tag.mimeType    } } : {}),
    });
    console.log('[camera] analysis start — front✓ detail:', !!slots.detail, 'tag:', !!slots.tag);
    router.replace({
      pathname: '/loading' as any,
      params: { imageUri: slots.front.uri, mimeType: slots.front.mimeType },
    });
  };

  // ── Drag-drop (unchanged) ─────────────────────────────────────────────────
  const handleLongPress = (slot: PhotoSlot) => {
    if (!slots[slot]) return;
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    SLOT_ORDER.forEach(s => {
      const ref = slotViewRefs.current[s];
      if (ref) {
        (ref as any).measure(
          (_fx: number, _fy: number, width: number, height: number, px: number, py: number) => {
            slotLayouts.current[s] = { x: px, y: py, width, height };
          }
        );
      }
    });
    setTimeout(() => {
      const layout = slotLayouts.current[slot];
      if (layout) {
        dragX.setValue(layout.x + layout.width / 2);
        dragY.setValue(layout.y + layout.height / 2);
      }
      isDraggingRef.current = true;
      dragSourceRef.current = slot;
      setDragSource(slot);
    }, 10);
  };

  const dragPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isDraggingRef.current,
      onMoveShouldSetPanResponder:  () => isDraggingRef.current,
      onPanResponderMove: (_, gs) => {
        dragX.setValue(gs.moveX);
        dragY.setValue(gs.moveY);
        let nearest: PhotoSlot | null = null;
        let minDist = Infinity;
        for (const s of SLOT_ORDER) {
          if (s === dragSourceRef.current) continue;
          const layout = slotLayouts.current[s];
          if (!layout) continue;
          const dist = Math.abs(gs.moveX - (layout.x + layout.width / 2));
          if (dist < minDist) { minDist = dist; nearest = s; }
        }
        setDragTarget(minDist < 60 ? nearest : null);
      },
      onPanResponderRelease: (_, gs) => {
        const src = dragSourceRef.current;
        if (src) {
          let target: PhotoSlot | null = null;
          let minDist = Infinity;
          for (const s of SLOT_ORDER) {
            if (s === src) continue;
            const layout = slotLayouts.current[s];
            if (!layout) continue;
            const dist = Math.abs(gs.moveX - (layout.x + layout.width / 2));
            if (dist < minDist) { minDist = dist; target = s; }
          }
          if (target && minDist < 70) {
            setSlots(prev => {
              const next = { ...prev };
              const srcPhoto = next[src];
              const tgtPhoto = next[target!];
              if (tgtPhoto) next[src]    = tgtPhoto; else delete next[src];
              if (srcPhoto) next[target!] = srcPhoto; else delete next[target!];
              return next;
            });
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            }
            console.log(`[camera] drag swap: ${src} ↔ ${target}`);
          }
        }
        isDraggingRef.current = false;
        dragSourceRef.current = null;
        setDragSource(null);
        setDragTarget(null);
      },
      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
        dragSourceRef.current = null;
        setDragSource(null);
        setDragTarget(null);
      },
    })
  ).current;

  // ── Permission screen ───────────────────────────────────────────────────────
  if (!permission) return <View style={s.root} />;

  if (!permission.granted) {
    const canAsk = permission.canAskAgain;
    return (
      <View style={[s.root, s.permWrap]}>
        {/* No X or Go Back before the native prompt — Apple Guideline 5.1.1(iv) */}
        <View style={s.permIconCircle}>
          <MaterialIcons name="camera-alt" size={36} color={GOLD} />
        </View>
        <Text style={s.permTitle}>Camera Access</Text>
        <Text style={s.permBody}>
          FlipStart uses your camera to photograph thrifted items and estimate their resale value.
        </Text>
        {canAsk ? (
          // Pre-permission state: neutral "Continue" only — no Allow/Grant/Enable wording
          <Pressable onPress={requestPermission} style={s.permPrimaryBtn}>
            <Text style={s.permPrimaryBtnText}>Continue</Text>
          </Pressable>
        ) : (
          // Denied state: native prompt can no longer appear, so Settings redirect is allowed
          <>
            <View style={s.permDeniedCard}>
              <MaterialIcons name="info-outline" size={16} color={GOLD} />
              <Text style={s.permDeniedText}>
                Camera access was denied. You can enable it in your iPhone Settings.
              </Text>
            </View>
            <Pressable onPress={() => Linking.openSettings()} style={s.permPrimaryBtn}>
              <Text style={s.permPrimaryBtnText}>Open Settings</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
              <Text style={s.permBackText}>Go Back</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const filledCount = SLOT_ORDER.filter(sl => slots[sl]).length;
  const canDone     = !!slots.front;

  return (
    <View style={s.root} {...(dragSource ? dragPan.panHandlers : {})}>

      {/* ── Header (unchanged) ── */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerIcon}>
          <MaterialIcons name="close" size={24} color={CREAM} />
        </Pressable>
        <Text style={s.headerTitle}>FlipStart</Text>
        <View style={s.headerIcon} />
      </View>

      {/* ── Viewfinder (unchanged) ── */}
      <View style={s.viewfinderWrap}>
        <View style={s.viewfinderFrame}>
          <CameraView ref={cameraRef} style={s.camera} facing="back" />
          <View style={[s.corner, s.cTL]} />
          <View style={[s.corner, s.cTR]} />
          <View style={[s.corner, s.cBL]} />
          <View style={[s.corner, s.cBR]} />
        </View>
        {/* Badge uses category-specific text */}
        <View style={s.slotBadge}>
          <Text style={s.slotBadgeText}>
            {currentCategory.badge(activeSlot)}
          </Text>
        </View>
      </View>

      {/* ── Slot strip — labels from active category ── */}
      <View style={s.slotStrip}>
        {SLOT_ORDER.map((slot) => {
          const photo     = slots[slot];
          const isActive  = slot === activeSlot;
          const isDragSrc = slot === dragSource;
          const isDragTgt = slot === dragTarget;
          return (
            <View
              key={slot}
              style={s.slotItem}
              ref={el => { slotViewRefs.current[slot] = el as any; }}
            >
              <Pressable
                onPress={() => handleSlotTap(slot)}
                onLongPress={() => handleLongPress(slot)}
                delayLongPress={350}
                style={s.slotPressable}
              >
                {photo ? (
                  <View style={{ position: 'relative' }}>
                    <Image
                      source={{ uri: photo.uri }}
                      style={[
                        s.slotThumb,
                        isActive  && s.slotThumbActive,
                        isDragSrc && s.slotThumbDragging,
                        isDragTgt && s.slotThumbTarget,
                      ]}
                      contentFit="cover"
                    />
                    {/* Always show ✕ when photo is present */}
                    <Pressable onPress={() => handleRemove(slot)} style={s.removeBtn} hitSlop={6}>
                      <View style={s.removeBtnInner}>
                        <MaterialIcons name="close" size={11} color="#FFF" />
                      </View>
                    </Pressable>
                    <Pressable onPress={() => setPreviewPhoto(photo)} style={s.magnifyBtn} hitSlop={4}>
                      <View style={s.magnifyBtnInner}>
                        <MaterialIcons name="zoom-in" size={10} color="#FFF" />
                      </View>
                    </Pressable>
                    {isDragSrc && <View style={s.dragSourceOverlay} />}
                    {isDragTgt && <View style={s.dragTargetOverlay} />}
                  </View>
                ) : undoData?.slot === slot ? (
                  // Slot was just deleted — show undo button in place of empty slot
                  <Pressable onPress={handleUndo} style={s.undoSlot} hitSlop={4}>
                    <MaterialIcons name="undo" size={18} color={GOLD} />
                    <Text style={s.undoSlotText}>Undo</Text>
                  </Pressable>
                ) : (
                  <View style={[
                    s.slotEmpty,
                    isActive  && s.slotEmptyActive,
                    isDragTgt && s.slotEmptyTarget,
                  ]}>
                    <MaterialIcons
                      name="add"
                      size={20}
                      color={isDragTgt ? GOLD : isActive ? GOLD : 'rgba(200,180,100,0.35)'}
                    />
                  </View>
                )}
              </Pressable>
              {/* Label from current category */}
              <Text style={[s.slotLabel, isActive && s.slotLabelActive]}>
                {currentCategory.labels[slot]}
              </Text>
              {slot === 'front' && !photo && <View style={s.reqDot} />}
            </View>
          );
        })}
      </View>

      {/* ── Controls (unchanged) ── */}
      <View style={s.controls}>
        <Pressable
          onPress={handleGallery}
          style={({ pressed }) => [s.sideBtn, pressed && { opacity: 0.7 }]}
        >
          <MaterialIcons name="photo-library" size={26} color={CREAM} />
          <Text style={s.sideBtnLabel}>Library</Text>
        </Pressable>

        <Pressable
          onPress={handleCapture}
          disabled={isTaking || filledCount >= 3}
          style={({ pressed }) => [
            s.captureBtn,
            pressed && { transform: [{ scale: 0.93 }] },
            (isTaking || filledCount >= 3) && { opacity: 0.45 },
          ]}
        >
          <View style={s.captureBtnInner} />
        </Pressable>

        <Pressable
          onPress={handleDone}
          disabled={!canDone}
          style={({ pressed }) => [
            s.sideBtn,
            !canDone && { opacity: 0.3 },
            pressed && canDone && { opacity: 0.8 },
          ]}
        >
          <MaterialIcons name="check" size={26} color={CREAM} />
          <Text style={s.sideBtnLabel}>Done</Text>
        </Pressable>
      </View>

      {/* ── hint + category carousel — flex spacer fills empty bottom space ── */}
      <View style={s.bottomZone}>
        <Text style={s.hint}>
          {filledCount === 0
            ? `Take a ${currentCategory.labels.front} photo to get started`
            : filledCount === 3
            ? 'All 3 photos — tap Done to analyze'
            : `${filledCount}/3 — add more or tap Done`}
        </Text>

        <CategoryCarousel
          index={catIndex}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      </View>

      {/* ── Drag ghost (unchanged) ── */}
      {dragSource && slots[dragSource] && (
        <Animated.Image
          source={{ uri: slots[dragSource]!.uri }}
          style={[
            s.dragGhost,
            {
              transform: [
                { translateX: Animated.subtract(dragX, GHOST_SIZE / 2) },
                { translateY: Animated.subtract(dragY, GHOST_SIZE / 2) },
              ],
            },
          ]}
        />
      )}

      {/* ── Magnify preview modal (unchanged) ── */}
      <Modal
        visible={!!previewPhoto}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreviewPhoto(null)}
      >
        <TouchableWithoutFeedback onPress={() => setPreviewPhoto(null)}>
          <View style={s.previewBg}>
            <View style={s.previewContent}>
              {previewPhoto && (
                <Image
                  source={{ uri: previewPhoto.uri }}
                  style={s.previewImage}
                  contentFit="contain"
                />
              )}
              <Pressable onPress={() => setPreviewPhoto(null)} style={s.previewClose}>
                <MaterialIcons name="close" size={22} color={CREAM} />
              </Pressable>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CORNER = 20;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 10,
  },
  headerIcon:  { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '700', color: CREAM },

  viewfinderWrap:  { width: '93%', aspectRatio: 1, marginBottom: 10, position: 'relative' },
  viewfinderFrame: { flex: 1, borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderColor: GOLD, position: 'relative' },
  camera:          { flex: 1 },
  corner:          { position: 'absolute', width: CORNER, height: CORNER, borderColor: GOLD },
  cTL: { top: -1, left: -1, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 16 },
  cTR: { top: -1, right: -1, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 16 },
  cBL: { bottom: -1, left: -1, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 16 },
  cBR: { bottom: -1, right: -1, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 16 },

  slotBadge: {
    position: 'absolute', bottom: 10, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.52)', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
  },
  slotBadgeText: { fontSize: 12, fontWeight: '600', color: CREAM, letterSpacing: 0.3 },

  slotStrip:    { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingVertical: 6 },
  slotItem:     { alignItems: 'center', gap: 4, position: 'relative' },
  slotPressable:{},

  slotThumb:         { width: 58, height: 58, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(190,156,44,0.35)' },
  slotThumbActive:   { borderColor: GOLD, borderWidth: 2 },
  slotThumbDragging: { opacity: 0.45, transform: [{ scale: 0.9 }] },
  slotThumbTarget:   { borderColor: GOLD, borderWidth: 2.5, opacity: 0.8 },

  slotEmpty:       { width: 58, height: 58, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(200,180,100,0.25)', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  slotEmptyActive: { borderColor: GOLD_DIM },
  slotEmptyTarget: { borderColor: GOLD, borderWidth: 2, backgroundColor: 'rgba(190,156,44,0.10)' },

  removeBtn:      { position: 'absolute', top: -7, right: -7 },
  removeBtnInner: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(80,20,20,0.88)', borderWidth: 1.5, borderColor: '#FF6B6B', justifyContent: 'center', alignItems: 'center' },

  magnifyBtn:      { position: 'absolute', top: -6, left: -6 },
  magnifyBtnInner: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(20,40,20,0.80)', borderWidth: 1.5, borderColor: GOLD + '80', justifyContent: 'center', alignItems: 'center' },

  dragSourceOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 10, backgroundColor: 'rgba(190,156,44,0.18)', borderWidth: 2, borderColor: GOLD },
  dragTargetOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 10, backgroundColor: 'rgba(190,156,44,0.25)', borderWidth: 2.5, borderColor: GOLD },

  slotLabel:       { fontSize: 10, fontWeight: '600', color: 'rgba(236,231,211,0.50)' },
  slotLabelActive: { color: GOLD },
  reqDot:          { position: 'absolute', top: -3, right: -3, width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#C0392B' },

  controls:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '80%', marginTop: 16 },
  sideBtn:        { alignItems: 'center', gap: 4, width: 60 },
  sideBtnLabel:   { fontSize: 10, fontWeight: '600', color: CREAM },
  captureBtn:     { width: 70, height: 70, borderRadius: 35, borderWidth: 3, borderColor: CREAM, justifyContent: 'center', alignItems: 'center' },
  captureBtnInner:{ width: 54, height: 54, borderRadius: 27, backgroundColor: CREAM },

  hint: { fontSize: 12, color: 'rgba(236,231,211,0.45)', marginTop: 16, textAlign: 'center' },

  // Flex container — hint near top, carousel at roughly the midpoint.
  // paddingBottom lifts carousel off the absolute bottom edge.
  bottomZone: {
    flex:           1,
    width:          '100%',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingBottom:  52,
  },

  // Undo slot — replaces the empty slot after deletion, same size as slotEmpty
  undoSlot: {
    width:           58,
    height:          58,
    borderRadius:    10,
    borderWidth:     1.5,
    borderColor:     GOLD + '70',
    borderStyle:     'dashed',
    backgroundColor: 'rgba(190,156,44,0.08)',
    justifyContent:  'center',
    alignItems:      'center',
    gap:             3,
  },
  undoSlotText: {
    fontSize:   8,
    fontWeight: '700',
    color:      GOLD,
    letterSpacing: 0.5,
  },

  dragGhost: {
    position: 'absolute', width: GHOST_SIZE, height: GHOST_SIZE,
    borderRadius: 12, borderWidth: 2, borderColor: GOLD,
    opacity: 0.9, zIndex: 999,
    pointerEvents: 'none' as any,
  },

  previewBg:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  previewContent: { width: '92%', aspectRatio: 1, position: 'relative' },
  previewImage:   { width: '100%', height: '100%', borderRadius: 16 },
  previewClose:   { position: 'absolute', top: -16, right: -16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(40,40,40,0.90)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },

  permWrap:          { justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32, flex: 1 },
  permBackBtn:       { position: 'absolute', left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.10)', justifyContent: 'center', alignItems: 'center' },
  permIconCircle:    { width: 80, height: 80, borderRadius: 40, backgroundColor: GOLD + '18', borderWidth: 1.5, borderColor: GOLD + '40', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  permTitle:         { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '800', color: CREAM, letterSpacing: -0.3 },
  permBody:          { fontSize: 15, color: 'rgba(236,231,211,0.70)', textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  permDeniedCard:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: GOLD + '14', borderWidth: 1, borderColor: GOLD + '30', borderRadius: 12, padding: 12, marginTop: 4 },
  permDeniedText:    { flex: 1, fontSize: 13, color: 'rgba(236,231,211,0.75)', lineHeight: 19 },
  permPrimaryBtn:    { backgroundColor: GOLD, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 50, marginTop: 4 },
  permPrimaryBtnText:{ color: '#1A2A1A', fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },
  permBackText:      { fontSize: 14, color: 'rgba(236,231,211,0.45)', marginTop: 4 },
});
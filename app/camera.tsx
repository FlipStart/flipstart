/**
 * app/camera.tsx — FlipStart custom camera screen
 *
 * Multi-slot capture: Front (required) + Back + Tag (optional).
 * Tap slot thumbnail to select it as active, or tap ✕ to remove that photo.
 * Tap active slot thumbnail to retake it.
 * Done stores the photo set via pending-capture-set and router.back().
 */

import { useState, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, Alert, Platform, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { V } from '@/constants/vintage';
import { FONTS } from '@/constants/typography';
import { setPendingCaptureSet } from '@/lib/pending-capture-set';
import {
  captureMultipleFromGallery,
  CapturedPhoto,
  CapturedPhotoSet,
  PhotoSlot,
  SLOT_ORDER,
  SLOT_LABELS,
} from '@/lib/capture';

// ─── Colors ──────────────────────────────────────────────────────────────────
const GOLD     = '#BE9C2C';
const GOLD_DIM = 'rgba(190,156,44,0.35)';
const CREAM    = '#ECE7D3';
const BG       = '#162D1A';   // deep eerie green

// ─── Component ────────────────────────────────────────────────────────────────

export default function CameraScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [slots, setSlots]           = useState<Partial<Record<PhotoSlot, CapturedPhoto>>>({});
  const [activeSlot, setActiveSlot] = useState<PhotoSlot>('front');
  const [isTaking, setIsTaking]     = useState(false);

  const haptic = (s: Haptics.ImpactFeedbackStyle) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(s).catch(() => {});
  };

  const getNextEmptySlot = useCallback(
    (current: Partial<Record<PhotoSlot, CapturedPhoto>>): PhotoSlot => {
      for (const slot of SLOT_ORDER) {
        if (!current[slot]) return slot;
      }
      return 'tag';
    },
    [],
  );

  // ── Capture ───────────────────────────────────────────────────────────────
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

  // ── Gallery ───────────────────────────────────────────────────────────────
  const handleGallery = async () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    const photos = await captureMultipleFromGallery(3);
    if (!photos || photos.length === 0) return;
    const next = { ...slots };
    for (let i = 0; i < photos.length; i++) {
      next[SLOT_ORDER[i]] = photos[i];
    }
    setSlots(next);
    setActiveSlot(getNextEmptySlot(next));
  };

  // ── Remove a slot ─────────────────────────────────────────────────────────
  const handleRemove = (slot: PhotoSlot) => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    const next = { ...slots };
    delete next[slot];
    setSlots(next);
    setActiveSlot(slot);  // jump back to that slot
  };

  // ── Tap slot: select or retake ────────────────────────────────────────────
  const handleSlotTap = (slot: PhotoSlot) => {
    if (slots[slot] && slot === activeSlot) {
      // Already active + filled → retake: clear and keep active
      handleRemove(slot);
    } else {
      setActiveSlot(slot);
    }
  };

  // ── Done ──────────────────────────────────────────────────────────────────
  const handleDone = () => {
    if (!slots.front) {
      console.log('[camera] done pressed with no front — returning');
      router.back();
      return;
    }
    const photoSet: CapturedPhotoSet = {
      front:   slots.front,
      primary: slots.front,
      detail:  slots.detail,
      tag:     slots.tag,
    };
    setPendingCaptureSet(photoSet);
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    console.log('[camera] saved photo set — front✓ detail:', !!slots.detail, 'tag:', !!slots.tag);
    // Always navigate to home tab so useFocusEffect fires and shows photo
    // confirmation — regardless of which tab the user started the scan from.
    // router.back() only works when camera was opened from home; this fixes
    // History / Profile / Settings → camera → done → black hole bug.
    router.replace('/(tabs)' as any);
  };

  // ── Permission screens ────────────────────────────────────────────────────
  if (!permission) return <View style={s.root} />;

  if (!permission.granted) {
    const canAsk = permission.canAskAgain;
    return (
      <View style={[s.root, s.permWrap]}>
        {/* Back button */}
        <Pressable
          onPress={() => router.back()}
          style={s.permBackBtn}
          hitSlop={10}
        >
          <MaterialIcons name="close" size={22} color={CREAM} />
        </Pressable>

        {/* Icon */}
        <View style={s.permIconCircle}>
          <MaterialIcons name="camera-alt" size={36} color={GOLD} />
        </View>

        {/* Title + explanation */}
        <Text style={s.permTitle}>Camera Access</Text>
        <Text style={s.permBody}>
          FlipStart uses your camera to photograph thrifted items and estimate their resale value.
        </Text>

        {canAsk ? (
          /* First ask — show request button */
          <Pressable
            onPress={requestPermission}
            style={({ pressed }) => [s.permPrimaryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.permPrimaryBtnText}>Allow Camera Access</Text>
          </Pressable>
        ) : (
          /* Already denied — guide to Settings */
          <>
            <View style={s.permDeniedCard}>
              <MaterialIcons name="info-outline" size={16} color={GOLD} />
              <Text style={s.permDeniedText}>
                Camera access was denied. You can enable it in your iPhone Settings.
              </Text>
            </View>
            <Pressable
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => [s.permPrimaryBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={s.permPrimaryBtnText}>Open Settings</Text>
            </Pressable>
          </>
        )}

        <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={s.permBackText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const filledCount = SLOT_ORDER.filter(sl => slots[sl]).length;
  const canDone     = !!slots.front;

  return (
    <View style={s.root}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerIcon}>
          <MaterialIcons name="close" size={24} color={CREAM} />
        </Pressable>
        <Text style={s.headerTitle}>FlipStart</Text>
        <View style={s.headerIcon} />
      </View>

      {/* ── Viewfinder ── */}
      <View style={s.viewfinderWrap}>
        <View style={s.viewfinderFrame}>
          <CameraView ref={cameraRef} style={s.camera} facing="back" />
          <View style={[s.corner, s.cTL]} />
          <View style={[s.corner, s.cTR]} />
          <View style={[s.corner, s.cBL]} />
          <View style={[s.corner, s.cBR]} />
        </View>
        {/* Active slot badge */}
        <View style={s.slotBadge}>
          <Text style={s.slotBadgeText}>
            {SLOT_LABELS[activeSlot]}
            {activeSlot !== 'front' ? ' (optional)' : ' (required)'}
          </Text>
        </View>
      </View>

      {/* ── Slot strip ── */}
      <View style={s.slotStrip}>
        {SLOT_ORDER.map((slot) => {
          const photo    = slots[slot];
          const isActive = slot === activeSlot;
          return (
            <View key={slot} style={s.slotItem}>
              <Pressable onPress={() => handleSlotTap(slot)} style={s.slotPressable}>
                {photo ? (
                  <>
                    <Image source={{ uri: photo.uri }} style={[s.slotThumb, isActive && s.slotThumbActive]} contentFit="cover" />
                    {/* ✕ remove button */}
                    <Pressable
                      onPress={() => handleRemove(slot)}
                      style={s.removeBtn}
                      hitSlop={6}
                    >
                      <View style={s.removeBtnInner}>
                        <MaterialIcons name="close" size={11} color="#FFF" />
                      </View>
                    </Pressable>
                  </>
                ) : (
                  <View style={[s.slotEmpty, isActive && s.slotEmptyActive]}>
                    <MaterialIcons name="add" size={20} color={isActive ? GOLD : 'rgba(200,180,100,0.35)'} />
                  </View>
                )}
              </Pressable>
              <Text style={[s.slotLabel, isActive && s.slotLabelActive]}>
                {SLOT_LABELS[slot]}
              </Text>
              {/* Required indicator dot */}
              {slot === 'front' && !photo && (
                <View style={s.reqDot} />
              )}
            </View>
          );
        })}
      </View>

      {/* ── Controls ── */}
      <View style={s.controls}>
        <Pressable onPress={handleGallery} style={({ pressed }) => [s.sideBtn, pressed && { opacity: 0.7 }]}>
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
          style={({ pressed }) => [s.sideBtn, !canDone && { opacity: 0.3 }, pressed && canDone && { opacity: 0.8 }]}
        >
          <MaterialIcons name="check" size={26} color={CREAM} />
          <Text style={s.sideBtnLabel}>Done</Text>
        </Pressable>
      </View>

      {/* ── Hint / progress ── */}
      <Text style={s.hint}>
        {filledCount === 0
          ? 'Take a Front photo to get started'
          : filledCount === 3
          ? 'All 3 photos captured — tap Done'
          : `${filledCount}/3 — add more or tap Done`}
      </Text>

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

  slotStrip: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingVertical: 6 },
  slotItem:  { alignItems: 'center', gap: 4, position: 'relative' },
  slotPressable: {},

  slotThumb:       { width: 58, height: 58, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(190,156,44,0.35)' },
  slotThumbActive: { borderColor: GOLD, borderWidth: 2 },
  slotEmpty:       { width: 58, height: 58, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(200,180,100,0.25)', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  slotEmptyActive: { borderColor: GOLD_DIM, borderStyle: 'dashed' },

  removeBtn: { position: 'absolute', top: -7, right: -7 },
  removeBtnInner: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(80,20,20,0.88)',
    borderWidth: 1.5, borderColor: '#FF6B6B',
    justifyContent: 'center', alignItems: 'center',
  },

  slotLabel:       { fontSize: 10, fontWeight: '600', color: 'rgba(236,231,211,0.50)' },
  slotLabelActive: { color: GOLD },
  reqDot:          { position: 'absolute', top: -3, right: -3, width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#C0392B' },

  controls:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '80%', marginTop: 8 },
  sideBtn:        { alignItems: 'center', gap: 4, width: 60 },
  sideBtnLabel:   { fontSize: 10, fontWeight: '600', color: CREAM },
  captureBtn:     { width: 70, height: 70, borderRadius: 35, borderWidth: 3, borderColor: CREAM, justifyContent: 'center', alignItems: 'center' },
  captureBtnInner:{ width: 54, height: 54, borderRadius: 27, backgroundColor: CREAM },

  hint: { fontSize: 12, color: 'rgba(236,231,211,0.45)', marginTop: 10, textAlign: 'center' },

  // ── Permission screen ──────────────────────────────────────────────────────
  permWrap: {
    justifyContent: 'center', alignItems: 'center',
    gap: 14, padding: 32, backgroundColor: BG, flex: 1,
  },
  permBackBtn: {
    position: 'absolute', top: Platform.OS === 'ios' ? 56 : 16, left: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.10)',
    justifyContent: 'center', alignItems: 'center',
  },
  permIconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: GOLD + '18',
    borderWidth: 1.5, borderColor: GOLD + '40',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  permTitle: {
    fontFamily: FONTS.serif, fontSize: 24, fontWeight: '800',
    color: CREAM, letterSpacing: -0.3,
  },
  permBody: {
    fontSize: 15, color: 'rgba(236,231,211,0.70)',
    textAlign: 'center', lineHeight: 22,
    paddingHorizontal: 8,
  },
  permDeniedCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: GOLD + '14',
    borderWidth: 1, borderColor: GOLD + '30',
    borderRadius: 12, padding: 12,
    marginTop: 4,
  },
  permDeniedText: {
    flex: 1, fontSize: 13, color: 'rgba(236,231,211,0.75)', lineHeight: 19,
  },
  permPrimaryBtn: {
    backgroundColor: GOLD,
    paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 50, marginTop: 4,
  },
  permPrimaryBtnText: {
    color: '#1A2A1A', fontWeight: '800', fontSize: 15, letterSpacing: 0.2,
  },
  permBackText: { fontSize: 14, color: 'rgba(236,231,211,0.45)', marginTop: 4 },
});
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
  KeyboardAvoidingView, Keyboard,
} from 'react-native';
import { InteractionManager } from 'react-native';
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
  pickMultipleFromGallery,
  normalizeGalleryAsset,
  type CapturedPhoto,
  type PhotoSlot,
  SLOT_ORDER, normalizeCameraCapture } from '@/lib/capture';
import { ProCameraContextInput,
         type ProCameraContextInputHandle } from '@/components/camera/ProCameraContextInput';
import { useEntitlement } from '@/lib/useEntitlement';
// ProGateHost stays mounted: harmless, and the camera is the one screen where
// a fullScreenModal host is genuinely needed if any gate returns here.
import { ProGateHost } from '@/components/monetization/ProGate';
import { useProPaywall, ProPaywallHost }
  from '@/components/monetization/paywall/ProPaywallProvider';
import { planSelection, decideCameraTap, decidePromotion, MAX_SLOTS }
  from '@/lib/thirdPhotoDecision';
import { useAuth } from '@/lib/auth-context';
import { PremiumGlimmer } from '@/components/monetization/PremiumGlimmer';
import { normalizeUserContext } from '@shared/userContext';

// ─── Colors ───────────────────────────────────────────────────────────────────

const GOLD     = '#BE9C2C';
const GOLD_DIM = 'rgba(190,156,44,0.35)';
const CREAM    = '#FFFEFA';
const BG       = '#162D1A';
const GHOST_SIZE = 70;

// ─── Photo slot labels ───────────────────────────────────────────────────────
//
// The category carousel was removed: it was display-only (it never reached the
// scan payload or the AI), and the new prompt self-classifies the item, so
// asking the user to pick a category first was work with no effect.
//
// These are the labels the carousel's "Clothing" preset used. They are frozen
// as the neutral default because they match the slot semantics the server
// actually uses — front / tag / detail — and clothing is the launch category.
// Kept as a named constant rather than inlined so the strings stay in one place
// if per-category labelling ever returns.
const SLOT_LABELS: Record<PhotoSlot, string> = {
  front:  'Front',
  tag:    'Tag',
  detail: 'Graphic',
};

/**
 * Exactly what the gallery picker hands back.
 *
 * DERIVED, never re-declared. The first attempt spelled this out by hand as
 * `{ uri: string; base64?: string; mimeType?: string }` and it did not compile:
 * ImagePickerAsset.base64 is `string | null | undefined`, so `null` had nowhere
 * to go. Deriving it from the function's own return type means the shape cannot
 * drift from the library again, whatever expo changes.
 */
type PickedAsset = NonNullable<Awaited<ReturnType<typeof pickMultipleFromGallery>>>[number];

const SLOT_BADGE = (s: PhotoSlot): string =>
  s === 'front' ? 'Front (required)'
  : s === 'tag' ? 'Tag (optional)'
  : 'Graphic (optional)';

export default function CameraScreen() {
  /**
   * Entitlement drives the SHAPE of the camera: how many slots exist, and
   * whether the context box is offered. Server-enforced regardless — this is
   * presentation, not authorization.
   */
  const ent = useEntitlement();


  const { openProPaywall } = useProPaywall();
  const { user } = useAuth();

  /**
   * ── Pending third photo (library origin) ───────────────────────────────
   *
   * A library image the user picked for the third slot while still Free.
   *
   * A REF, not state, and deliberately NOT part of `slots`. Anything in `slots`
   * is an attached photo: it renders as filled, it is read by handleDone, and
   * it goes into the analyze payload. This image must do none of those things
   * until the server confirms Pro, so it is held completely outside that
   * structure and only ever moves in via promotePendingThird().
   *
   * A ref also means no re-render, which matters: a pending image is not a
   * visual state, it is an intent waiting on a purchase.
   */
  const pendingThirdRef = useRef<{
    asset: PickedAsset;
    /** Who was signed in when the intent was created. */
    uid: string | null;
    /** Which camera session — an old intent must never reach a new scan. */
    session: number;
  } | null>(null);

  /**
   * Camera session identity.
   *
   * Bumped whenever the photo set is cleared for a new scan. Cheap, local, and
   * enough to satisfy the "old third-photo intent must never attach to a new
   * scan" requirement without inventing persistence.
   */
  const sessionRef = useRef(0);

  /**
   * Stable handle on handleCapture.
   *
   * Declared HERE, with the other refs and above every consumer: the camera
   * continuation is built before handleCapture exists, and it must call
   * whatever the CURRENT render's capture is rather than a closure captured
   * before the purchase started.
   */
  const handleCaptureRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Imperative handle on the context editor.
   *
   * Only used to RESUME the action after an unlock. Every ordinary tap still
   * goes through the component's own Pressable.
   */
  const contextInputRef = useRef<ProCameraContextInputHandle | null>(null);

  const uidRef = useRef<string | null>(user?.id ?? null);
  uidRef.current = user?.id ?? null;

  /** Drops the pending intent. Called on dismissal, account switch and unmount. */
  const clearPendingThird = useCallback(() => { pendingThirdRef.current = null; }, []);

  /**
   * Account switch invalidates any pending third photo immediately.
   *
   * Attaching account A's image to account B is a data-integrity failure, not a
   * minor inconvenience — and B has not paid for it either.
   */
  const lastUidRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (lastUidRef.current === uid) return;
    lastUidRef.current = uid;
    sessionRef.current += 1;   // invalidate any in-flight continuation too
    clearPendingThird();
  }, [user?.id, clearPendingThird]);

  /** Leaving the camera abandons the intent — it can have no meaning elsewhere. */
  useEffect(() => clearPendingThird, [clearPendingThird]);
  const canContext    = ent.status === 'ready' && ent.can('camera_context');
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
  // ── Additional-information context (Phase 1: local only) ────────────────────
  // Lives for ONE camera session. Survives taking photos and switching slots;
  // resets on unmount. Deliberately not added to the scan payload yet — Phase 2
  // wires it into the analysis request.
  const [contextText, setContextText]           = useState('');
  const [contextConfirmed, setContextConfirmed] = useState(false);

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
      // base64:false on purpose — the raw 12MP encode is ~2.9MB and would be
      // thrown away by the resize below. normalizeCameraCapture reads the URI
      // and returns base64 at the final size instead.
      const pic = await cameraRef.current.takePictureAsync({
        base64: false, quality: 0.55, exif: false,
      });
      if (!pic?.uri) return;

      // Resize to the model's effective ceiling (1440px long edge). A raw
      // capture and a 1440px capture look identical to the AI — the API
      // downscales anything larger before the model sees it — so this is pure
      // upload savings with no loss of detail. See AI_MAX_PX in lib/capture.ts.
      // activeSlot decides the resize target: the front photo does not need
      // tag-reading resolution, so it is captured smaller.
      const photo = await normalizeCameraCapture(pic.uri, pic.width, pic.height, 'camera', activeSlot);
      if (!photo) {
        Alert.alert('Photo failed', 'Could not process that photo. Please try again.');
        return;
      }
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

  // ── Gallery — instant thumbnails, background normalization ────────────────
  // The old flow base64-encoded every full-res photo (in the picker AND again
  // in the manipulator, sequentially) before showing anything — 3-9s of blank
  // slots. Now: the picker returns raw asset uris immediately, thumbnails
  // render from those at once, and each photo's AI-ready base64 JPEG is
  // prepared in parallel in the background, swapping in as it finishes.
  /**
   * Promote the pending library image into the third slot.
   *
   * Every precondition is re-checked HERE, immediately before attaching —
   * never at the moment the paywall opened. A purchase takes seconds, and any
   * of these can change in that window.
   */
  const promotePendingThird = useCallback(() => {
    const pending = pendingThirdRef.current;
    if (!pending) return;

    const slotsNow = slotsRef.current;
    const thirdSlot = SLOT_ORDER[2];

    const result = decidePromotion({
      // The gate only fires onUnlocked after the server confirms the plan, so
      // reaching this line already means authoritative Pro.
      isAuthoritativelyPro: true,
      sameUid: (uidRef.current ?? null) === pending.uid,
      sameSession: sessionRef.current === pending.session,
      assetUsable: Boolean(pending.asset?.uri),
      slotStillEmpty: !slotsNow[thirdSlot],
    });

    // Consumed either way: an intent that has been acted on must not linger and
    // fire again on a later unlock.
    clearPendingThird();

    if (result !== 'promote') {
      /**
       * "unlocked_without_asset" is NOT a purchase failure and must never be
       * surfaced as one. The subscription is real; only the image is gone. The
       * user keeps Pro and an empty third slot they can fill normally.
       */
      return;
    }

    setSlots(prev => {
      if (prev[thirdSlot]) return prev; // filled in the meantime — leave it
      return { ...prev, [thirdSlot]: {
        uri: pending.asset.uri,
        base64: pending.asset.base64 ?? '',
        mimeType: pending.asset.mimeType ?? 'image/jpeg',
      } };
    });

    // Normalize in the background, exactly as the gallery path does.
    normalizeGalleryAsset(pending.asset, 'gallery-detail')
      .then(photo => {
        if (!photo) return;
        setSlots(prev => {
          const current = prev[thirdSlot];
          if (!current || current.uri !== pending.asset.uri) return prev;
          return { ...prev, [thirdSlot]: photo };
        });
      })
      .catch(() => { /* keeps its preview; handleDone guards on base64 */ });
  }, [clearPendingThird]);

  /** Camera origin: reopen the capture flow, nothing more. Never auto-shoot. */
  const openThirdPhotoPaywallForCamera = useCallback(() => {
    clearPendingThird(); // a camera intent supersedes any stale library one
    openProPaywall('third_photo', { onUnlocked: () => { void handleCaptureRef.current?.(); } });
  }, [openProPaywall, clearPendingThird]);

  /**
   * AI Context: open the paywall, and resume the editor once Pro is real.
   *
   * ── Why the continuation is deferred ─────────────────────────────────
   * The editor is itself a React Native <Modal> with an autoFocus TextInput.
   * Opening it while the paywall modal is still dismissing means two modals
   * transitioning at once, which on iOS produces a lost focus or a keyboard
   * that never appears. InteractionManager waits for the dismissal animation
   * to finish, then opens — a UI-frame deferral, not an arbitrary timeout.
   *
   * ── Why there is no .focus() call ────────────────────────────────────
   * The TextInput already carries autoFocus, so focus follows the editor
   * mounting. An imperative focus on top of that would be a second focus
   * request for the same field and is exactly the keyboard flicker the brief
   * warns about.
   */
  const openAiContextPaywall = useCallback(() => {
    const openedUid = uidRef.current ?? null;
    const openedSession = sessionRef.current;
    let fired = false;

    openProPaywall('camera_context', {
      onUnlocked: () => {
        // Local exactly-once guard, on top of the provider's one-shot claim.
        if (fired) return;
        fired = true;

        /**
         * Identity and session re-checked at RESUME time, not at open time.
         * A purchase takes seconds: the account can change, or the user can
         * start a new scan. Neither may inherit this intent.
         */
        if ((uidRef.current ?? null) !== openedUid) return;
        if (sessionRef.current !== openedSession) return;

        InteractionManager.runAfterInteractions(() => {
          // Re-checked again after the wait — the screen may have unmounted.
          if ((uidRef.current ?? null) !== openedUid) return;
          if (sessionRef.current !== openedSession) return;
          contextInputRef.current?.openEditor();
        });
      },
    });
  }, [openProPaywall]);

  /** Library origin: promote the exact image they already chose. */
  const openThirdPhotoPaywallForLibrary = useCallback(() => {
    openProPaywall('third_photo', { onUnlocked: promotePendingThird });
  }, [openProPaywall, promotePendingThird]);

  // Kept current every render so a continuation created before this
  // declaration still calls the live capture, not a stale closure.
  handleCaptureRef.current = handleCapture;

  const handleGallery = async () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    /**
     * The picker still offers THREE, deliberately.
     *
     * Limiting it to two for Free would mean the user never discovers the third
     * photo exists. Letting them select it and gating afterwards means they
     * have already shown intent — a far stronger place for the paywall to land.
     */
    const picked = await pickMultipleFromGallery(MAX_SLOTS);
    if (!picked || picked.length === 0) return;

    /**
     * ── Fill EMPTY slots, never overwrite ────────────────────────────────
     *
     * The previous version did `picked.slice(0, maxAllowed)` and assigned
     * `SLOT_ORDER[i]` from index 0, which silently destroyed photos the user
     * had already taken:
     *
     *   existing front = A, picker returns B, C
     *   → B overwrote A, C became the tag, and nothing gated at all
     *
     * planSelection() assigns into the empty slots in order and computes the
     * premium threshold from the resulting ACTIVE COUNT rather than the picker
     * index, which is what makes the partially-filled case behave.
     */
    const plan = planSelection(picked, slotsRef.current, ent.status, ent.maxPhotoSlots);

    if (plan.assignments.length > 0) {
      const next = { ...slotsRef.current };
      for (const { slot, asset } of plan.assignments) {
        next[slot] = { uri: asset.uri, base64: '', mimeType: 'image/jpeg' };
      }
      setSlots(next);
      setActiveSlot(getNextEmptySlot(next));
      setUndoData(null); // clear undo on gallery import
    }

    /**
     * The would-be third photo is held as INTENT ONLY.
     *
     * It never enters `slots`, so it cannot render as attached, cannot be read
     * by handleDone, and cannot reach the analyze payload or the model. It
     * exists solely so the purchase can resume without making the user hunt
     * for the same image again.
     */
    if (plan.pendingThird) {
      pendingThirdRef.current = {
        asset: plan.pendingThird,
        uid: uidRef.current ?? null,
        session: sessionRef.current,
      };
      openThirdPhotoPaywallForLibrary();
    }

    // Normalize the ACCEPTED photos in the background; swap each in when ready.
    // Guarded so we never clobber a slot the user has since changed.
    plan.assignments.forEach(({ slot, asset }, i) => {
      const label = ['gallery-front', 'gallery-tag', 'gallery-detail'][SLOT_ORDER.indexOf(slot)]
        ?? `gallery-${i}`;
      normalizeGalleryAsset(asset, label)
        .then(photo => {
          if (!photo) return;
          setSlots(prev => {
            const current = prev[slot];
            if (!current || current.uri !== asset.uri) return prev; // user changed it
            return { ...prev, [slot]: photo };
          });
        })
        .catch(() => { /* photo keeps its preview; Done guard catches the miss */ });
    });
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
    if (!slots.front.base64) {
      // Gallery import still preparing this photo (background normalization).
      Alert.alert('One moment', 'Your photo is still being prepared \u2014 try again in a second.');
      return;
    }
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    // Only CONFIRMED context travels. contextConfirmed is reset to false by the
    // onChangeText handler on any edit, so text typed after confirming cannot
    // ride along unconfirmed.
    const ctx = contextConfirmed ? normalizeUserContext(contextText) : '';

    setPendingScan({
      front: { base64: slots.front.base64, mimeType: slots.front.mimeType },
      ...(slots.detail?.base64 ? { detail: { base64: slots.detail.base64, mimeType: slots.detail.mimeType } } : {}),
      ...(slots.tag?.base64    ? { tag:    { base64: slots.tag.base64,    mimeType: slots.tag.mimeType    } } : {}),
      ...(ctx ? { userContext: ctx } : {}),
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
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      // The camera preview is flex-sized, so lifting the column shrinks the
      // preview instead of pushing controls off-screen.
      keyboardVerticalOffset={0}
      {...(dragSource ? dragPan.panHandlers : {})}
    >

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
            {SLOT_BADGE(activeSlot)}
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
            /**
             * The third slot becomes the premium surface once the first two
             * are filled — that is when it turns into the natural next action.
             * Glimmering before then would just be decoration.
             *
             * Applied for Pro users too: it signals they are actively using a
             * premium capability rather than marking the slot as locked.
             */
            /**
             * Follows the NEXT EMPTY slot, not a fixed position.
             *
             * Previously hardcoded to SLOT_ORDER[2], so filling front + detail
             * left the shine on an already-filled tile while the actual next
             * action — tag — sat plain. Whichever slot the third photo would go
             * into is the one that shines.
             */
            const glimmer = filledCount === 2 && !photo && slot === getNextEmptySlot(slots);
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
                  /* Normal empty slot, unchanged — the shine is an overlay,
                     not a different box. 58/10 match s.slotEmpty. */
                  <PremiumGlimmer active={glimmer} size={58} radius={10}>
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
                  </PremiumGlimmer>
                )}
              </Pressable>
              {/* Label from current category */}
              <Text style={[s.slotLabel, isActive && s.slotLabelActive]}>
                {SLOT_LABELS[slot]}
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
          /**
           * Gate BEFORE capture, never after.
           *
           * The camera must not open for photo 3 on a Free plan — taking the
           * shot and then rejecting it would waste the user's time and leave a
           * discarded image in memory. Photos 1 and 2 are untouched either way.
           */
          onPress={() => {
            /**
             * Gate BEFORE capture, never after.
             *
             * decideCameraTap fails closed while entitlement is unresolved, so
             * a loading state can never open the third capture — and no camera
             * permission prompt fires merely because a Free user touched a
             * locked slot.
             */
            const action = decideCameraTap(filledCount, ent.status, ent.maxPhotoSlots);
            if (action === 'at_capacity') return;
            if (action === 'paywall') { openThirdPhotoPaywallForCamera(); return; }
            handleCapture();
          }}
          // Deliberately NOT disabled at 2 photos: the button must stay
          // pressable so the gate can fire and explain why.
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
      {/* Tapping anywhere in the bottom zone outside the field dismisses the
          keyboard. Text is untouched — dismissing is not cancelling. */}
      <Pressable style={s.bottomZone} onPress={() => Keyboard.dismiss()}>
        <Text style={s.hint}>
          {filledCount === 0
            ? `Take a ${SLOT_LABELS.front} photo to get started`
            : filledCount === 3
            ? 'All 3 photos — tap Done to analyze'
            : `${filledCount}/3 — add more or tap Done`}
        </Text>

        {/* Replaces the category carousel. Phase 1 is local state only —
            nothing here reaches the scan payload or the AI yet. */}
        {/* Pro-only. Hidden rather than shown-and-disabled: a permanently
            greyed field on every scan is noise for a Free user, and the server
            strips unentitled context anyway. */}
        {/* ALWAYS visible, including on Free.
            Hiding it meant a Free user never learned the feature existed. It
            now presents as premium and gates at the moment of intent, which is
            both more honest and a far better conversion surface. */}
        <ProCameraContextInput
          ref={contextInputRef}
          value={contextText}
          onChangeText={(txt) => {
            setContextText(txt);
            // Editing after confirming returns to unconfirmed: the user must
            // re-confirm what they actually want sent.
            if (contextConfirmed) setContextConfirmed(false);
          }}
          confirmed={contextConfirmed}
          onConfirm={() => setContextConfirmed(true)}
          /* The component already supported these — they were never wired.
             disabled keeps the input inert for Free, and onUpgradePress routes
             the tap to the shared gate instead of silently doing nothing. */
          disabled={!canContext}
          /* Phase 6: the contextual paywall replaces the temporary gate.
             disabled fails closed while entitlement is unresolved, and the
             component checks it BEFORE setOpen — so no TextInput is mounted,
             no keyboard appears and no draft state is created for a Free tap. */
          onUpgradePress={openAiContextPaywall}
        />
      </Pressable>

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


      {/* Gate host.
          The camera is presented as a fullScreenModal, which lives in its own
          native window ABOVE the root. A root-level gate modal therefore stayed
          hidden underneath and only surfaced once the camera was dismissed.
          Mounting a host here renders it in the window the user is looking at. */}
      <ProGateHost />

      {/*
       * Local paywall host — REQUIRED here.
       *
       * This screen is registered with presentation: 'fullScreenModal', and a
       * React Native <Modal> rendered at the root cannot appear above a
       * modally-presented screen: it renders underneath and only surfaces once
       * this screen is dismissed. ProGateHost sits here for the same reason.
       *
       * This is a HOST, not a provider. The single ProPaywallProvider in
       * app/_layout.tsx still owns all state and the one purchase engine; the
       * host registry simply renders the modal in the window the user is
       * actually looking at.
       */}
      <ProPaywallHost />
    </KeyboardAvoidingView>
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
    // 'center' rather than 'space-between': space-between pinned the context
    // row to the very bottom edge, which read as an afterthought below the
    // controls. Centering floats hint + row in the gap between the shutter and
    // the home indicator, which is where the sketch puts it.
    justifyContent: 'center',
    gap:            26,
    paddingBottom:  46,
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
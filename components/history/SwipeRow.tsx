/**
 * SwipeRow — swipe-left-to-delete, shared by every history row.
 *
 * Replaces two near-identical PanResponder blocks that were duplicated in
 * history.tsx. Four things were making the old one feel unreliable:
 *
 *  1. The FlatList could steal the gesture mid-swipe. PanResponder hands the
 *     responder back on request by default, so a slight vertical drift partway
 *     through a swipe cancelled it. `onPanResponderTerminationRequest: false`
 *     is the actual fix for "works half the time".
 *
 *  2. Release only looked at distance, so a fast flick that travelled 30px did
 *     nothing. Velocity is now considered, which is what makes a flick feel
 *     like it worked.
 *
 *  3. Hard clamping at the open width killed the gesture dead at the limit.
 *     Now it rubber-bands, so the row stays alive under your finger.
 *
 *  4. Rows never closed each other, so you could leave a trail of open rows.
 *     One open row at a time now, tracked module-level.
 *
 * Visually: the delete pill is inset from the card rather than being a
 * full-bleed block the card sits directly on top of.
 */
import { useRef, useEffect, useCallback, type ReactNode } from 'react';
import { View, Text, Pressable, Animated, PanResponder, Platform, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { dismissHint } from '@/lib/uiHints';

export const SWIPE_ACTION_WIDTH = 88;

/** Gap between the sliding card and the delete pill. */
const GUTTER = 10;
/** Horizontal travel before we claim the gesture from the list. */
const ACTIVATE_PX = 8;
/** Horizontal movement must beat vertical by this much to count as a swipe. */
const DIRECTION_BIAS = 1.2;
/** A flick this fast opens or closes regardless of distance. */
const FLICK_VELOCITY = 0.35;
/** How far past the stop the row will stretch, with resistance. */
const OVERSHOOT = 28;

/** Only one row open at a time. */
let closeOpenRow: (() => void) | null = null;

export interface SwipeRowProps {
  children: ReactNode;
  onDelete: () => void;
  /** Wrapper style — pass the card's marginBottom etc. */
  style?: object;
  deleteLabel?: string;
}

export function SwipeRow({ children, onDelete, style, deleteLabel = 'Delete' }: SwipeRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen     = useRef(false);
  const startX     = useRef(0);

  const close = useCallback((animate = true) => {
    isOpen.current = false;
    if (closeOpenRow === close) closeOpenRow = null;
    if (!animate) { translateX.setValue(0); return; }
    Animated.spring(translateX, {
      toValue: 0, useNativeDriver: true,
      speed: 18, bounciness: 0,
    }).start();
  }, [translateX]);

  const open = useCallback(() => {
    // Close whichever row was open first, so two rows are never open at once.
    if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
    isOpen.current = true;
    closeOpenRow = close;
    // The user has now performed the gesture, so the tip has done its job.
    // Dismissing on the swipe rather than on the delete means someone who
    // discovers it but never deletes anything stops being told about it.
    dismissHint('swipeToDelete');
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    Animated.spring(translateX, {
      toValue: -SWIPE_ACTION_WIDTH, useNativeDriver: true,
      speed: 18, bounciness: 0,
    }).start();
  }, [translateX, close]);

  // Leaving the screen with a row open would strand the module-level ref.
  useEffect(() => () => { if (closeOpenRow === close) closeOpenRow = null; }, [close]);

  const pan = useRef(
    PanResponder.create({
      // Tap alone must never claim the responder, or the row stops being tappable.
      onStartShouldSetPanResponder: () => false,

      onMoveShouldSetPanResponder: (_, g) => {
        const horizontal = Math.abs(g.dx) > ACTIVATE_PX &&
                           Math.abs(g.dx) > Math.abs(g.dy) * DIRECTION_BIAS;
        if (!horizontal) return false;
        // Only meaningful directions: left when closed, right when open.
        return isOpen.current ? g.dx > 0 : g.dx < 0;
      },

      onPanResponderGrant: () => {
        startX.current = isOpen.current ? -SWIPE_ACTION_WIDTH : 0;
      },

      // THE fix for "works half the time": once we own the gesture, the
      // enclosing FlatList cannot take it back mid-swipe.
      onPanResponderTerminationRequest: () => false,

      onPanResponderMove: (_, g) => {
        let next = startX.current + g.dx;
        if (next > 0) {
          next = next * 0.25;                       // resist pulling right of closed
        } else if (next < -SWIPE_ACTION_WIDTH) {
          const past = -SWIPE_ACTION_WIDTH - next;  // resist past fully open
          next = -SWIPE_ACTION_WIDTH - Math.min(OVERSHOOT, past * 0.35);
        }
        translateX.setValue(next);
      },

      onPanResponderRelease: (_, g) => {
        const travelled = startX.current + g.dx;
        // Velocity first: a decisive flick should win even over a short distance.
        if (g.vx < -FLICK_VELOCITY) return open();
        if (g.vx >  FLICK_VELOCITY) return close();
        travelled < -SWIPE_ACTION_WIDTH / 2 ? open() : close();
      },

      onPanResponderTerminate: () => { isOpen.current ? open() : close(); },
    }),
  ).current;

  const handleDelete = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    close();
    // Let the row settle before the list mutates, so the removal does not
    // visually collide with the spring.
    setTimeout(onDelete, 160);
  };

  return (
    <View style={[s.wrapper, style]}>
      {/* Delete pill, revealed as the card slides. Fades and scales in so it
          does not simply appear fully-formed under the card. */}
      <Animated.View
        pointerEvents={'box-none'}
        style={[
          s.actionZone,
          {
            opacity: translateX.interpolate({
              inputRange: [-SWIPE_ACTION_WIDTH, -SWIPE_ACTION_WIDTH * 0.35, 0],
              outputRange: [1, 0.55, 0],
              extrapolate: 'clamp',
            }),
            transform: [{
              scale: translateX.interpolate({
                inputRange: [-SWIPE_ACTION_WIDTH, -SWIPE_ACTION_WIDTH * 0.4, 0],
                outputRange: [1, 0.94, 0.88],
                extrapolate: 'clamp',
              }),
            }],
          },
        ]}
      >
        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [s.deleteBtn, pressed && { opacity: 0.82 }]}
          hitSlop={6}
        >
          <MaterialIcons name="delete-outline" size={21} color="#F4EED8" />
          <Text style={s.deleteText}>{deleteLabel}</Text>
        </Pressable>
      </Animated.View>

      <Animated.View style={[s.surface, { transform: [{ translateX }] }]} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

/** Tap handler for row content: first tap closes an open row instead of navigating. */
export function useSwipeAwarePress(onPress: () => void) {
  return useCallback(() => {
    if (closeOpenRow) { closeOpenRow(); return; }
    onPress();
  }, [onPress]);
}

const s = StyleSheet.create({
  // overflow visible so the card keeps its shadow; the pill is clipped by
  // sitting underneath instead.
  wrapper: { marginBottom: 10, position: 'relative' },
  actionZone: {
    position: 'absolute', top: 0, bottom: 0, right: 0,
    width: SWIPE_ACTION_WIDTH - GUTTER,
    marginLeft: GUTTER,
  },
  deleteBtn: {
    flex: 1, borderRadius: 16, backgroundColor: '#7A2E2A',
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  deleteText: { fontSize: 10.5, fontWeight: '800', color: '#F4EED8', letterSpacing: 0.3 },
  surface: { backgroundColor: 'transparent', borderRadius: 16 },
});
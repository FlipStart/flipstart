/**
 * ProCameraContextInput
 *
 * Lets the user type a short fact the camera cannot see — a stain on the back,
 * a tag reading 1998, a broken zipper — and confirm it before scanning.
 *
 * PHASE 1: UI and local state only. The confirmed text is NOT sent to the AI,
 * not persisted, and not added to any payload. Phase 2 wires it into the
 * analysis request.
 *
 * ── Two surfaces ──────────────────────────────────────────────────────────────
 * Collapsed: a compact row on the camera screen showing the rotating example,
 * or the user's confirmed text.
 * Expanded: tapping the row opens a focused editor floating above the keyboard.
 * Typing into a 54px strip while the keyboard covers half the screen is
 * unpleasant; the editor gives the text room and puts Cancel and Confirm where
 * a thumb reaches them.
 *
 * ── The placeholder is not the value ──────────────────────────────────────────
 * The rotating example types itself character by character, so it looks exactly
 * like real input. It is a plain Text layer, never the TextInput's `value`, so
 * it cannot be confirmed, submitted, or saved by accident.
 *
 * ── Future gating (not implemented) ───────────────────────────────────────────
 * `disabled` and `onUpgradePress` already exist. When entitlements land the
 * camera passes `disabled={!isProOrTrial}` plus an upgrade handler; the row
 * renders greyed, the editor never opens, and the typewriter never mounts.
 *   Pro subscriber   -> disabled=false
 *   Active trial     -> disabled=false
 *   Free (permanent) -> disabled=true, onUpgradePress set
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Platform, Modal,
  AccessibilityInfo, Keyboard, KeyboardAvoidingView, TouchableWithoutFeedback,
} from 'react-native';
import * as Haptics from 'expo-haptics';

const GOLD   = '#BE9C2C';
const CREAM  = '#FFFEFA';
const INK    = '#2B2118';
const FOREST = '#162D1A';
const DANGER = '#B04A3F';
const MUTED  = '#7A6A55';

/** Facts a camera genuinely cannot determine on its own — hidden damage,
 *  readable tag text, dates, sizes, materials, included pieces, faults. */
export const CONTEXT_EXAMPLES: string[] = [
  'Big stain on right sleeve',
  'Size XL, color navy blue',
  'Tag says Made in USA',
  'Small hole near bottom hem',
  'Graphic is dated 1998',
  'Zipper is broken',
  'Missing one button',
  'Genuine leather',
  'No size tag',
  'Brand tag is faded',
  'Model number is 559',
  'Includes a matching belt',
  'Feels like heavy wool',
  'Light cracking on the graphic',
  // Odour and feel — the camera has no way to know these, and smoke smell is a
  // real value killer that only shows up after purchase.
  'Smells strongly of smoke',
  'Fabric is thin and pilled',
  // Measurements and fit. Resellers list these; a photo cannot supply them, and
  // a tagged size is frequently wrong on older garments.
  'Measures 22 inches pit to pit',
  'Tagged medium but fits small',
  // Construction and label details that feed era detection directly — these are
  // exactly the physical clues Route B looks for.
  'Single stitch on the sleeves',
  'Union label inside the seam',
  // Condition hidden from the lens.
  'Lining is torn but hidden',
  'Repaired at the shoulder seam',
  'Sole is separating at the toe',
  // Colour correction. Store lighting routinely turns forest green into black,
  // and a wrong colour in a listing title costs a sale.
  'Color is forest green, not black',
  // Identification the AI can act on.
  'RN number is 56323',
];

const TYPE_MS   = 42;
const HOLD_MS   = 2000;
const DELETE_MS = 26;
const PAUSE_MS  = 550;
const MAX_LEN   = 190;

/** Fisher-Yates. Returns a new array; never mutates the source. */
function shuffled<T>(src: readonly T[]): T[] {
  const a = [...src];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ProCameraContextInputProps {
  value: string;
  onChangeText: (t: string) => void;
  confirmed: boolean;
  onConfirm: () => void;
  disabled?: boolean;
  onUpgradePress?: () => void;
  examples?: string[];
}

export function ProCameraContextInput({
  value,
  onChangeText,
  confirmed,
  onConfirm,
  disabled = false,
  onUpgradePress,
  examples = CONTEXT_EXAMPLES,
}: ProCameraContextInputProps) {
  const [open, setOpen]   = useState(false);
  const [draft, setDraft] = useState('');
  const [ghost, setGhost] = useState('');
  const [reduceMotion, setReduceMotion] = useState(false);

  // Shuffled deck, reshuffled when exhausted.
  //
  // Randomising only the START index — the obvious approach — leaves the ORDER
  // fixed: every session walks the same sequence, just entered at a different
  // point. A deck gives a genuinely different order each time and shows every
  // example once before repeating any.
  const deck = useRef<string[]>(shuffled(examples));
  const deckPos = useRef(0);
  const nextExample = useCallback((): string => {
    if (deckPos.current >= deck.current.length) {
      // Reshuffle, but never let the new deck open with the example that just
      // finished — a back-to-back repeat reads as the animation being stuck.
      const last = deck.current[deck.current.length - 1];
      const next = shuffled(examples);
      if (next.length > 1 && next[0] === last) {
        [next[0], next[next.length - 1]] = [next[next.length - 1], next[0]];
      }
      deck.current = next;
      deckPos.current = 0;
    }
    return deck.current[deckPos.current++];
  }, [examples]);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (alive) setReduceMotion(v); })
      .catch(() => { /* default false */ });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  /** Animate only while the row is empty, closed, and enabled. */
  const idle = value.length === 0 && !open && !disabled;

  useEffect(() => {
    clearTimers();
    if (!idle) { setGhost(''); return; }

    if (reduceMotion) {
      setGhost(nextExample());
      const tick = () => { setGhost(nextExample()); later(tick, 3800); };
      later(tick, 3800);
      return clearTimers;
    }

    let text = nextExample();
    let ch = 0;
    let deleting = false;
    const step = () => {
      if (!deleting) {
        ch++;
        setGhost(text.slice(0, ch));
        if (ch >= text.length) { deleting = true; later(step, HOLD_MS); }
        else later(step, TYPE_MS);
      } else {
        ch--;
        setGhost(text.slice(0, Math.max(0, ch)));
        if (ch <= 0) { deleting = false; text = nextExample(); later(step, PAUSE_MS); }
        else later(step, DELETE_MS);
      }
    };
    later(step, PAUSE_MS);
    return clearTimers;
  }, [idle, reduceMotion, nextExample, clearTimers, later]);

  useEffect(() => clearTimers, [clearTimers]);

  const openEditor = () => {
    if (disabled) { onUpgradePress?.(); return; }
    setDraft(value);
    setOpen(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  /** Discards this edit. Anything previously confirmed stays confirmed —
   *  Cancel means "forget what I just typed", not "delete what I saved". */
  const cancel = () => {
    Keyboard.dismiss();
    setOpen(false);
    setDraft('');
  };

  /**
   * Commits whatever is in the editor — including nothing.
   *
   * Confirm is never disabled. Blocking it on an empty field trapped anyone who
   * had already confirmed text and then wanted to remove it: Confirm was greyed
   * out and Cancel restored the very text they were deleting, so the context
   * could not be cleared once set.
   */
  const confirmDraft = () => {
    const clean = draft.trim();

    if (!clean) {
      // Empty draft. If something was confirmed, this is a deliberate deletion;
      // if nothing was, there is simply nothing to commit and we just close.
      if (value.length > 0) {
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onChangeText('');
        if (__DEV__) console.log('[context] cleared');
      }
      Keyboard.dismiss();
      setOpen(false);
      setDraft('');
      return;
    }

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    onChangeText(clean);
    onConfirm();
    Keyboard.dismiss();
    setOpen(false);
    if (__DEV__) console.log('[context] confirmed (Phase 1 — not sent to AI):', clean);
  };

  // Empty draft over existing text means the tap will DELETE, so the button
  // says so. "Confirm" on an empty box that wipes your note reads wrong.
  const willClear = draft.trim().length === 0 && value.length > 0;
  const charsLeft = MAX_LEN - draft.length;

  return (
    <>
      {/* ── Collapsed row ─────────────────────────────────────────────────── */}
      <View style={s.wrap}>
        <View style={s.row}>
          <Pressable
            style={[s.field, disabled && s.dim, confirmed && s.fieldConfirmed]}
            onPress={openEditor}
            accessibilityRole="button"
            accessibilityLabel="Add additional information about this item"
          >
            {value.length > 0 ? (
              <Text style={s.fieldValue} numberOfLines={1}>{value}</Text>
            ) : (
              <Text style={s.ghost} numberOfLines={1}>
                {ghost}
                {ghost.length > 0 ? <Text style={s.caret}>|</Text> : null}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={openEditor}
            disabled={disabled}
            style={({ pressed }) => [
              s.btn,
              confirmed ? s.btnConfirmed : s.btnDefault,
              disabled && s.dim,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={[s.btnText, confirmed && s.btnTextConfirmed]} numberOfLines={1}>
              {confirmed ? 'Confirmed' : 'Confirm'}
            </Text>
          </Pressable>
        </View>

        <Text style={s.caption}>Send additional information to FlipStart's AI.</Text>
      </View>

      {/* ── Focused editor ────────────────────────────────────────────────── */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={cancel}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback onPress={cancel}>
          <View style={s.scrim} />
        </TouchableWithoutFeedback>

        <KeyboardAvoidingView
          style={s.sheetWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents="box-none"
        >
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Additional Information</Text>
            <Text style={s.sheetSub}>
              Anything the photos can't show — damage, tag text, size, or what's included.
            </Text>

            <TextInput
              value={draft}
              onChangeText={t => setDraft(t.slice(0, MAX_LEN))}
              autoFocus
              multiline
              maxLength={MAX_LEN}
              placeholder="e.g. Small hole near bottom hem"
              placeholderTextColor="rgba(43,33,24,0.35)"
              style={s.sheetInput}
              selectionColor={GOLD}
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={confirmDraft}
            />

            <Text style={[s.counter, charsLeft <= 25 ? { color: DANGER } : null]}>
              {charsLeft} characters left
            </Text>

            <View style={s.sheetBtns}>
              <Pressable
                onPress={cancel}
                style={({ pressed }) => [s.sheetBtn, s.cancelBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={confirmDraft}
                style={({ pressed }) => [s.sheetBtn, s.confirmBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.confirmText}>{willClear ? 'Clear' : 'Confirm'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const FIELD_H = 54;

const s = StyleSheet.create({
  wrap: { width: '90%', alignSelf: 'center', gap: 7 },
  row:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dim:  { opacity: 0.45 },

  field: {
    flex: 1, height: FIELD_H, justifyContent: 'center',
    backgroundColor: CREAM, borderRadius: 14,
    borderWidth: 1.25, borderColor: GOLD, paddingHorizontal: 14,
  },
  fieldConfirmed: { borderWidth: 1.75 },
  fieldValue:     { fontSize: 14.5, color: INK, fontWeight: '600' },
  ghost:          { fontSize: 14.5, color: 'rgba(43,33,24,0.38)' },
  caret:          { color: GOLD, fontWeight: '700' },

  btn: {
    height: FIELD_H, minWidth: 96, paddingHorizontal: 16,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  btnDefault:       { backgroundColor: 'transparent', borderWidth: 1.25, borderColor: CREAM },
  btnConfirmed:     { backgroundColor: GOLD, borderWidth: 0 },
  btnText:          { fontSize: 14, fontWeight: '800', color: CREAM, letterSpacing: 0.2 },
  btnTextConfirmed: { color: FOREST },

  caption: {
    textAlign: 'center', fontSize: 11.5,
    color: 'rgba(255,254,250,0.62)', letterSpacing: 0.1,
  },

  // ── Focused editor ──
  scrim:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,20,12,0.72)' },
  // 'flex-end', not 'center'. KeyboardAvoidingView shrinks this container to
  // the space above the keyboard; centring inside that reduced area floats the
  // card high on the screen. Anchoring to the bottom sits it just above the
  // keys, with paddingBottom providing the gap.
  sheetWrap: {
    flex: 1, justifyContent: 'flex-end', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 34,
  },
  sheet: {
    width: '100%', maxWidth: 460, backgroundColor: CREAM,
    borderRadius: 20, borderWidth: 1.5, borderColor: GOLD,
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35, shadowRadius: 20, elevation: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: FOREST, letterSpacing: 0.2 },
  sheetSub:   { fontSize: 12.5, color: MUTED, lineHeight: 17, marginTop: -4 },
  sheetInput: {
    minHeight: 92, maxHeight: 150, borderRadius: 12,
    borderWidth: 1.25, borderColor: 'rgba(190,156,44,0.55)',
    backgroundColor: '#FFFDF6', paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15.5, color: INK, textAlignVertical: 'top',
  },
  counter: { fontSize: 11, color: MUTED, textAlign: 'right', marginTop: -4 },

  sheetBtns:   { flexDirection: 'row', gap: 10, marginTop: 2 },
  sheetBtn:    { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelBtn:   { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: DANGER },
  cancelText:  { fontSize: 15, fontWeight: '800', color: DANGER },
  confirmBtn:  { backgroundColor: GOLD },
  confirmText: { fontSize: 15, fontWeight: '800', color: FOREST },
});
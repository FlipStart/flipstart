/**
 * components/hunt/HuntPriceField.tsx
 *
 * The Hunt thrift-price input.
 *
 * Why it exists: iOS's decimal keypad has NO return key, so
 * `returnKeyType="done"` / `onSubmitEditing` never fire on it. The old field
 * opened a keyboard the user could not close, which covered the analysis and
 * left Save / Remove as the only ways out.
 *
 * Here a native-style keyboard toolbar (InputAccessoryView, iOS) carries a
 * Done button. Done — or the field losing focus by any route (tap outside,
 * drag the scroll view) — commits the value through `onCommit` and closes the
 * keyboard. Nothing in this component saves, keeps or removes the item.
 *
 * Keystrokes are filtered by sanitizePriceInput: digits and one dot, ≤ 2
 * decimals, no sign, no letters.
 */
import { forwardRef, useImperativeHandle, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Platform, InputAccessoryView, Keyboard,
} from 'react-native';
import { sanitizePriceInput } from '@/lib/huntEconomics';

export interface HuntPriceFieldHandle {
  focus: () => void;
  blur:  () => void;
}

interface Props {
  /** Raw text currently in the field ("" when empty). */
  value:     string;
  onChange:  (text: string) => void;
  /** Done, or the keyboard closed: apply the price. */
  onCommit:  (text: string) => void;
  /** Gold guidance outline (e.g. Save tapped with no price). */
  emphasize?: boolean;
  /** Unique per screen — links the field to its keyboard toolbar. */
  accessoryId: string;
  color:      string;
  placeholderColor: string;
  accentColor: string;
  barColor:    string;
}

export const HuntPriceField = forwardRef<HuntPriceFieldHandle, Props>(function HuntPriceField(
  { value, onChange, onCommit, emphasize, accessoryId, color, placeholderColor, accentColor, barColor },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  const latest = useRef(value);
  latest.current = value;

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur:  () => inputRef.current?.blur(),
  }), []);

  const done = () => {
    // Blur commits (onBlur below) — one path, so the value is applied once.
    inputRef.current?.blur();
    Keyboard.dismiss();
  };

  return (
    <View style={s.wrap}>
      <View style={[s.row, emphasize && { backgroundColor: accentColor + '14' }]}>
        <Text style={[s.sign, { color }]}>-$</Text>
        <TextInput
          ref={inputRef}
          testID="hunt-price-input"
          style={[s.input, { color }]}
          value={value}
          onChangeText={t => onChange(sanitizePriceInput(t, latest.current))}
          onBlur={() => onCommit(latest.current)}
          onSubmitEditing={done}
          keyboardType="decimal-pad"
          returnKeyType="done"
          placeholder="0.00"
          placeholderTextColor={placeholderColor}
          selectionColor={accentColor}
          inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
          accessibilityLabel="Thrift price"
          maxLength={9}
        />
      </View>

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={[s.bar, { backgroundColor: barColor }]}>
            <Text style={s.barHint}>Thrift price</Text>
            <Pressable onPress={done} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done">
              <Text style={[s.barDone, { color: accentColor }]}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  wrap:   { alignSelf: 'stretch', alignItems: 'center' },
  row:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'transparent', borderRadius: 8, paddingHorizontal: 6,
  },
  sign:   { fontSize: 17, fontWeight: '800' },
  // Fixed width: a TextInput sized by its content can grow wider than the
  // price box and push the "-$" outside it on narrow phones.
  input:  { fontSize: 20, fontWeight: '800', padding: 0, width: 82, textAlign: 'center' },
  bar:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#C8BCA0',
  },
  barHint: { fontSize: 13, color: '#8A7050' },
  barDone: { fontSize: 16, fontWeight: '700' },
});
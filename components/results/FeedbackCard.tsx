/**
 * components/results/FeedbackCard.tsx
 *
 * Lightweight accuracy-feedback card shown at the bottom of the results screen.
 *
 * Named "Help us improve" rather than "Beta feedback": the mechanism is
 * permanent, not a beta artefact, and asking post-launch users to give "beta"
 * feedback implies the product is unfinished.
 * Collects: accuracy rating, buy/pass decision, user's estimated value, notes.
 *
 * Vintage FlipStart aesthetic — fast, minimal, not a form.
 */

import { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput,
  ActivityIndicator, Keyboard,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { trpc } from '@/lib/trpc';
import { FONTS } from '@/constants/typography';
import { trackAnalyticsEvent } from '@/lib/analytics';

// ─── Palette ─────────────────────────────────────────────────────────────────
const BG      = '#F4EED8';
const CARD    = '#FFF9EE';
const CARD_B  = '#DDD0B0';
const FOREST  = '#2A4A2A';
const GOLD    = '#BE9C2C';
const MUTED   = '#8A7050';
const BROWN   = '#5A3A1A';
const CREAM   = '#F5EDD4';

// ─── Types ───────────────────────────────────────────────────────────────────
type AccuracyRating = 'accurate' | 'somewhat' | 'bad';
type BuyDecision    = 'bought'   | 'passed'   | 'unsure';

export interface FeedbackCardProps {
  scanId:          string;
  itemName:        string;
  brand:           string;
  category:        string;
  resaleLow:       number;
  resaleHigh:      number;
  suggestedBuy:    number;
  demand:          string;
  bestPlatform:    string;
  confidenceScore:    number;
  recommendation:     string;
  aiEstimatedResale?: number;   // adjusted_estimated_value from AI
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FeedbackCard(props: FeedbackCardProps) {
  const [accuracy,  setAccuracy]  = useState<AccuracyRating | null>(null);
  const [decision,  setDecision]  = useState<BuyDecision    | null>(null);
  const [estValue,  setEstValue]  = useState('');
  const [notes,     setNotes]     = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      // Analytics: feedback successfully submitted.
      trackAnalyticsEvent('scan_feedback_submitted', {
        scan_id:              props.scanId,
        item_title:           props.itemName,
        brand:                props.brand,
        category:             props.category,
        estimated_resale_low:  props.resaleLow,
        estimated_resale_high: props.resaleHigh,
        suggested_buy_price:  props.suggestedBuy,
        match_confidence:     props.confidenceScore,
        recommendation:       props.recommendation,
        estimated_resale_value: props.aiEstimatedResale ?? null,
        feedback_rating:      accuracy,
        buy_decision:         decision,
        user_corrected_value: estValue ? parseFloat(estValue) : null,
        notes_present:        notes.trim().length > 0,
        feedback_text_length: notes.trim().length || null,
        platform:             props.bestPlatform,
      });
    },
  });

  const handleSubmit = () => {
    Keyboard.dismiss();
    submitMutation.mutate({
      scanId:             props.scanId,
      itemName:           props.itemName,
      brand:              props.brand,
      category:           props.category,
      resaleLow:          props.resaleLow,
      resaleHigh:         props.resaleHigh,
      suggestedBuy:       props.suggestedBuy,
      demand:             props.demand,
      bestPlatform:       props.bestPlatform,
      confidenceScore:    props.confidenceScore,
      recommendation:     props.recommendation,
      aiEstimatedResale:  props.aiEstimatedResale ?? null,
      accuracyRating:     accuracy,
      buyDecision:        decision,
      userEstimatedValue: estValue ? parseFloat(estValue) : null,
      notes:              notes.trim() || null,
    });
  };

  if (submitted) {
    return (
      <View style={s.card}>
        <View style={s.doneRow}>
          <MaterialIcons name="check-circle" size={18} color={FOREST} />
          <Text style={s.doneText}>Thanks for the feedback — it helps improve FlipStart.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.headerRow}>
        <Text style={s.headerDeco}>✦</Text>
        <Text style={s.headerTitle}>HELP US IMPROVE</Text>
        <Text style={s.headerDeco}>✦</Text>
      </View>
      <Text style={s.headerSub}>Help us improve FlipStart's accuracy.</Text>

      {/* Accuracy */}
      <Text style={s.qLabel}>How accurate was this analysis?</Text>
      <View style={s.btnRow}>
        {([
          { key: 'accurate',  label: '✓ Accurate'       },
          { key: 'somewhat',  label: '~ Somewhat'        },
          { key: 'bad',       label: '✗ Bad analysis'    },
        ] as { key: AccuracyRating; label: string }[]).map(opt => (
          <Pressable
            key={opt.key}
            onPress={() => setAccuracy(opt.key)}
            style={[s.chip, accuracy === opt.key && s.chipActive]}
          >
            <Text style={[s.chipText, accuracy === opt.key && s.chipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Buy/Pass */}
      <Text style={s.qLabel}>Did you buy this item?</Text>
      <View style={s.btnRow}>
        {([
          { key: 'bought',  label: 'Bought' },
          { key: 'passed',  label: 'Passed' },
          { key: 'unsure',  label: 'Unsure' },
        ] as { key: BuyDecision; label: string }[]).map(opt => (
          <Pressable
            key={opt.key}
            onPress={() => setDecision(opt.key)}
            style={[s.chip, decision === opt.key && s.chipActive]}
          >
            <Text style={[s.chipText, decision === opt.key && s.chipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* User estimated value */}
      <Text style={s.qLabel}>What do you think it's worth? <Text style={s.optional}>(optional)</Text></Text>
      <View style={s.inputRow}>
        <Text style={s.dollarSign}>$</Text>
        <TextInput
          style={s.valueInput}
          value={estValue}
          onChangeText={setEstValue}
          keyboardType="decimal-pad"
          placeholder="e.g. 45"
          placeholderTextColor={MUTED}
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />
      </View>

      {/* Notes */}
      <Text style={s.qLabel}>Anything the AI missed? <Text style={s.optional}>(optional)</Text></Text>
      <TextInput
        style={s.notesInput}
        value={notes}
        onChangeText={t => setNotes(t.slice(0, 150))}
        placeholder="Brand not recognized, wrong era, etc."
        placeholderTextColor={MUTED}
        multiline
        maxLength={150}
        returnKeyType="done"
        onSubmitEditing={Keyboard.dismiss}
      />
      {notes.length > 100 && (
        <Text style={s.charCount}>{notes.length}/150</Text>
      )}

      {/* Submit */}
      <Pressable
        onPress={handleSubmit}
        disabled={submitMutation.isPending || (!accuracy && !decision)}
        style={({ pressed }) => [
          s.submitBtn,
          pressed && { opacity: 0.85 },
          (!accuracy && !decision) && { opacity: 0.45 },
        ]}
      >
        {submitMutation.isPending
          ? <ActivityIndicator size="small" color={CREAM} />
          : <MaterialIcons name="send" size={15} color={CREAM} />}
        <Text style={s.submitText}>Submit Feedback</Text>
      </Pressable>

      {submitMutation.isError && (
        <Text style={s.errText}>Couldn't submit — try again.</Text>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    marginTop:        20,
    marginBottom:     8,
    backgroundColor:  CARD,
    borderRadius:     14,
    borderWidth:      1,
    borderColor:      CARD_B,
    padding:          16,
  },

  // Header
  headerRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginBottom: 3 },
  headerDeco: { fontSize: 11, color: GOLD },
  headerTitle:{ fontFamily: FONTS.serif, fontSize: 11, fontWeight: '700', color: FOREST, letterSpacing: 1.5 },
  headerSub:  { fontSize: 11, color: MUTED, textAlign: 'center', marginBottom: 14 },

  // Questions
  qLabel:   { fontFamily: FONTS.serif, fontSize: 12, fontWeight: '700', color: BROWN, marginBottom: 7, marginTop: 10 },
  optional: { fontSize: 11, fontWeight: '400', color: MUTED },

  // Chip buttons
  btnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: CARD_B, backgroundColor: BG,
  },
  chipActive:     { backgroundColor: FOREST, borderColor: FOREST },
  chipText:       { fontFamily: FONTS.serif, fontSize: 11, fontWeight: '600', color: MUTED },
  chipTextActive: { color: CREAM },

  // Value input
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: CARD_B, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: BG,
  },
  dollarSign:  { fontSize: 15, fontWeight: '700', color: FOREST },
  valueInput:  { fontSize: 16, fontWeight: '700', color: FOREST, flex: 1, padding: 0 },

  // Notes input
  notesInput: {
    borderWidth: 1.5, borderColor: CARD_B, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, marginTop: 0,
    backgroundColor: BG, fontSize: 12, color: BROWN,
    minHeight: 56, textAlignVertical: 'top',
  },
  charCount: { fontSize: 10, color: MUTED, textAlign: 'right', marginTop: 2 },

  // Submit
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 50,
    backgroundColor: FOREST, marginTop: 14,
  },
  submitText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700', color: CREAM },
  errText:    { fontSize: 11, color: '#8A2A2A', textAlign: 'center', marginTop: 6 },

  // Done state
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 4 },
  doneText: { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '600', color: FOREST },
});
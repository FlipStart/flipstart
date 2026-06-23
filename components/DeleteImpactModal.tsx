/**
 * components/DeleteImpactModal.tsx
 *
 * FlipStart vintage-styled warning modals for destructive scan deletion.
 *
 *  • DeleteImpactModal      — single scan that WILL remove progress. Lists the
 *                             exact achievements/brands/diamonds that will be
 *                             lost. Cancel / Delete Anyway (red).
 *  • ClearHistoryModal      — two-step "nuclear" warning for clearing all scan
 *                             history. Step 1 summarizes the loss; step 2 is a
 *                             final "Are you absolutely sure?" gate.
 *
 * Scans with NO progress impact never reach these modals — the caller deletes
 * them immediately (no popup).
 */

import React, { useState } from 'react';
import { View, Text, Modal, StyleSheet, Pressable, ScrollView } from 'react-native';
import { FONTS } from '@/constants/typography';
import type { DeletionImpact, ClearHistoryImpact } from '@/lib/scanDeletionImpact';

// Vintage palette (from constants/vintage.ts)
const CARD   = '#F2EDD8';
const PARCH  = '#ECE7D3';
const GREEN  = '#3D5A38';
const BROWN  = '#3D2A12';
const MUTED  = '#8A7050';
const GOLD   = '#BE9C2C';
const BORDER = '#C8B88A';
const DANGER = '#9E3A2A';
const TAN    = '#D6C8A3';

function Backdrop({ children }: { children: React.ReactNode }) {
  return <View style={s.backdrop}>{children}</View>;
}

function LossRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.lossRow}>
      <View style={s.lossDot} />
      <Text style={s.lossText}>
        <Text style={s.lossLabel}>{label}: </Text>{value}
      </Text>
    </View>
  );
}

// ─── Single-scan progress-impact warning ──────────────────────────────────────
export function DeleteImpactModal({
  visible, impact, onCancel, onConfirm,
}: {
  visible:   boolean;
  impact:    DeletionImpact | null;
  onCancel:  () => void;
  onConfirm: () => void;
}) {
  if (!impact) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop>
        <View style={s.card}>
          <Text style={s.title}>Delete This Find?</Text>
          <Text style={s.body}>
            This item is tied to your FlipStart progress. Deleting it will remove
            unlocks from your account.
          </Text>

          <View style={s.lossBox}>
            <Text style={s.lossHeading}>You will lose:</Text>
            <ScrollView style={{ maxHeight: 220 }}>
              {impact.affectedAchievements.map(a => (
                <LossRow key={`a-${a.id}`} label="Achievement" value={a.title} />
              ))}
              {impact.affectedBrands.map(b => (
                <LossRow key={`b-${b.id}`} label="Brand" value={b.name} />
              ))}
              {impact.affectedDiamonds.map(d => (
                <LossRow key={`d-${d.id}`} label="Diamond" value={d.title} />
              ))}
            </ScrollView>
          </View>

          <Text style={s.footer}>
            Deleting this scan is permanent. Once it is deleted, FlipStart cannot
            restore the scan or any progress that depended on it.
          </Text>

          <View style={s.btnRow}>
            <Pressable style={[s.btn, s.btnCancel]} onPress={onCancel}>
              <Text style={s.btnCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={[s.btn, s.btnDanger]} onPress={onConfirm}>
              <Text style={s.btnDangerText}>Delete Anyway</Text>
            </Pressable>
          </View>
        </View>
      </Backdrop>
    </Modal>
  );
}

// ─── Clear-all-history two-step warning ───────────────────────────────────────
export function ClearHistoryModal({
  visible, impact, onCancel, onConfirm,
}: {
  visible:   boolean;
  impact:    ClearHistoryImpact | null;
  onCancel:  () => void;
  onConfirm: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  if (!impact) return null;

  const close = () => { setStep(1); onCancel(); };
  const confirm = () => { setStep(1); onConfirm(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Backdrop>
        <View style={s.card}>
          {step === 1 ? (
            <>
              <Text style={s.title}>Clear Scan History?</Text>
              <Text style={s.body}>
                This will permanently delete your scan history and reset any
                progress that depends on those saved items.
              </Text>

              <View style={s.lossBox}>
                <Text style={s.lossHeading}>This will remove:</Text>
                <LossRow label="Scans"        value={`${impact.scansToDelete} will be deleted`} />
                {impact.achievementsToRemove > 0 &&
                  <LossRow label="Achievements" value={`${impact.achievementsToRemove} may be removed`} />}
                {impact.brandsToRemove > 0 &&
                  <LossRow label="Brands"       value={`${impact.brandsToRemove} may be removed`} />}
                {impact.diamondsToRemove > 0 &&
                  <LossRow label="Diamonds"     value={`${impact.diamondsToRemove} may be removed`} />}
                <LossRow label="Notifications" value="progress badges will reset" />
              </View>

              <Text style={s.footer}>
                This action is final. Deleted scans and progress cannot be
                restored by FlipStart.
              </Text>

              <View style={s.btnRow}>
                <Pressable style={[s.btn, s.btnCancel]} onPress={close}>
                  <Text style={s.btnCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[s.btn, s.btnDanger]} onPress={() => setStep(2)}>
                  <Text style={s.btnDangerText}>Clear Scan History</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={s.title}>Are You Absolutely Sure?</Text>
              <Text style={s.body}>
                This cannot be undone. Your scan history and all scan-based
                progress will be permanently removed.
              </Text>
              <View style={s.btnCol}>
                <Pressable style={[s.btn, s.btnDanger, s.btnFull]} onPress={confirm}>
                  <Text style={s.btnDangerText}>I Understand, Delete Everything</Text>
                </Pressable>
                <Pressable style={[s.btn, s.btnCancel, s.btnFull]} onPress={close}>
                  <Text style={s.btnCancelText}>Cancel</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </Backdrop>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(30,20,8,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 420, backgroundColor: CARD,
    borderRadius: 18, borderWidth: 1, borderColor: BORDER,
    padding: 22, shadowColor: BROWN, shadowOpacity: 0.3,
    shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  title: {
    fontFamily: FONTS.serif, fontSize: 22, fontWeight: '700',
    color: GREEN, marginBottom: 10,
  },
  body: { fontSize: 15, lineHeight: 21, color: BROWN, marginBottom: 16 },
  lossBox: {
    backgroundColor: PARCH, borderRadius: 12, borderWidth: 1,
    borderColor: BORDER, padding: 14, marginBottom: 16,
  },
  lossHeading: {
    fontSize: 13, fontWeight: '800', color: MUTED,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  lossRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  lossDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD, marginTop: 7,
  },
  lossText: { flex: 1, fontSize: 14, lineHeight: 20, color: BROWN },
  lossLabel: { fontWeight: '700', color: GREEN },
  footer: { fontSize: 13, lineHeight: 19, color: MUTED, marginBottom: 18 },
  btnRow: { flexDirection: 'row', gap: 12 },
  btnCol: { gap: 10 },
  btn: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  btnFull: { flex: 0, width: '100%' },
  btnCancel: { backgroundColor: TAN, borderWidth: 1, borderColor: BORDER },
  btnCancelText: { fontSize: 15, fontWeight: '700', color: BROWN },
  btnDanger: { backgroundColor: DANGER },
  btnDangerText: { fontSize: 15, fontWeight: '800', color: '#F4EED8' },
});
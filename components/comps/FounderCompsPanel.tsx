/**
 * components/comps/FounderCompsPanel.tsx
 *
 * Founder-only Comps Inspector, under Sold Comps on the results screen.
 *
 * Renders ONLY when the server included `founderDebug` — which it does only
 * for a verified session listed in COMPS_INSPECTOR_USER_IDS. Nothing on the
 * client decides who is a founder, so there is no flag here to flip.
 *
 * Shows why each comp ranked where it did, what was thrown out and why, and
 * lets the founder mark each shown comp right or wrong. Those marks are the
 * labelled set later matching changes are measured against.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { trpc } from '@/lib/trpc';
import { C, formatMoney } from './tokens';

type Verdict = 'right' | 'wrong';

export interface FounderDebug {
  query: string | null;
  historyDays: number | null;
  historySpanDays: number | null;
  cacheHit: boolean;
  outcome: string;
  /** Deepest search that ran: A precise, B relaxed, C broad; D = nothing shown. Newer servers only. */
  searchTier?: string | null;
  searches?: Array<{ tier: string; query: string; categoryId: string | null; outcome: string;
                     cacheHit: boolean; paid: boolean; raw: number; error?: string }>;
  counts: { raw: number; rejected: number; weak: number; duplicates: number; exact: number; strong: number; similar: number };
  dataStrength: string | null;
  internalConfidencePercent: number | null;
  shown: Array<{ id: string; tier: string; score: number; reason: string; positives: string[]; penalties: string[] }>;
  rejected: Array<{ title: string; reason: string; detail: string | null; price: number }>;
  weak: Array<{ title: string; reason: string; score: number }>;
  duplicates: Array<{ title: string; price: number; reason: string }>;
  feedback: Record<string, Verdict>;
}

const label = (code: string) => code.toLowerCase().replace(/_/g, ' ');

export function FounderCompsPanel({
  analysisId, debug, titles,
}: {
  analysisId: string | null;
  debug: FounderDebug;
  /** Shown comp id → title, from the public matches. */
  titles: Record<string, string>;
}) {
  const [marks, setMarks] = useState<Record<string, Verdict>>(debug.feedback ?? {});
  const [open, setOpen] = useState<'rejected' | 'weak' | 'dupes' | null>(null);
  const [saveError, setSaveError] = useState(false);
  const flag = trpc.comps.flagComp.useMutation();

  const mark = async (compId: string, v: Verdict) => {
    if (!analysisId) return;
    const next = marks[compId] === v ? 'clear' : v;
    // Optimistic, then reconciled with what the server actually stored.
    setMarks(m => { const o = { ...m }; if (next === 'clear') delete o[compId]; else o[compId] = next; return o; });
    setSaveError(false);
    try {
      const res = await flag.mutateAsync({ analysisId, compId, verdict: next });
      if (res.ok && res.feedback) setMarks(res.feedback as Record<string, Verdict>);
      else setSaveError(true);
    } catch {
      setSaveError(true);
    }
  };

  const c = debug.counts;
  const span = debug.historySpanDays != null
    ? `${debug.historySpanDays} of ${debug.historyDays ?? '?'} days returned`
    : 'no sale dates returned';

  const toggle = (k: 'rejected' | 'weak' | 'dupes') => setOpen(o => (o === k ? null : k));

  return (
    <View style={s.panel}>
      <Text style={s.title}>Comps inspector · founder only</Text>
      <Text style={s.meta} selectable>
        {debug.query ? `Search: “${debug.query}”` : 'No search ran'} · {span}{debug.cacheHit ? ' · cached' : ''}
      </Text>
      <Text style={s.meta}>
        {debug.outcome} · returned {c.raw} · Exact {c.exact} · Strong {c.strong} · Similar {c.similar} · Weak {c.weak} · Rejected {c.rejected} · Dupes {c.duplicates}
      </Text>
      {(debug.searches ?? []).map((q, i) => (
        <Text key={`q${i}`} style={s.meta} selectable>
          {q.tier} · “{q.query}”{q.categoryId ? ` · cat ${q.categoryId}` : ''} · {q.cacheHit ? 'cached' : q.outcome !== 'ok' ? q.outcome : q.paid ? 'paid' : 'free'} · {q.raw} back{q.error ? ` · ${q.error}` : ''}
        </Text>
      ))}
      {!!debug.searchTier && (
        <Text style={s.meta}>Deepest search: {debug.searchTier}{debug.searchTier === 'D' ? ' (nothing good enough to show)' : ''}</Text>
      )}
      <Text style={s.meta}>
        Data: {debug.dataStrength ?? '—'}{debug.internalConfidencePercent != null ? ` (internal ${debug.internalConfidencePercent})` : ''}
      </Text>

      {debug.shown.map((m, i) => {
        const v = marks[m.id];
        return (
          <View key={m.id} style={s.comp}>
            <Text style={s.compHead} numberOfLines={2}>{i + 1}. {titles[m.id] ?? m.id}</Text>
            <Text style={s.compWhy}>{m.reason} · score {m.score}</Text>
            {m.positives.length > 0 && <Text style={s.plus}>+ {m.positives.join(' · ')}</Text>}
            {m.penalties.length > 0 && <Text style={s.minus}>− {m.penalties.join(' · ')}</Text>}
            <View style={s.markRow}>
              <Pressable
                onPress={() => mark(m.id, 'right')}
                style={[s.markBtn, v === 'right' && s.markRight]}
                accessibilityRole="button"
                accessibilityState={{ selected: v === 'right' }}
                accessibilityLabel={`Mark comp ${i + 1} right`}
              >
                <Text style={[s.markText, v === 'right' && s.markTextOn]}>Right comp</Text>
              </Pressable>
              <Pressable
                onPress={() => mark(m.id, 'wrong')}
                style={[s.markBtn, v === 'wrong' && s.markWrong]}
                accessibilityRole="button"
                accessibilityState={{ selected: v === 'wrong' }}
                accessibilityLabel={`Mark comp ${i + 1} wrong`}
              >
                <Text style={[s.markText, v === 'wrong' && s.markTextOn]}>Wrong comp</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {saveError && <Text style={s.error}>Couldn't save that mark. Check your connection and tap again.</Text>}

      <Pressable onPress={() => toggle('rejected')} accessibilityRole="button" hitSlop={8}>
        <Text style={s.disclose}>{open === 'rejected' ? '▾' : '▸'} Rejected ({debug.rejected.length}{c.rejected > debug.rejected.length ? ` of ${c.rejected}` : ''})</Text>
      </Pressable>
      {open === 'rejected' && debug.rejected.map((r, i) => (
        <Text key={`r${i}`} style={s.row}>
          <Text style={s.rowReason}>{label(r.reason)}</Text> · {formatMoney(r.price)} · {r.title}{r.detail ? ` — ${r.detail}` : ''}
        </Text>
      ))}

      <Pressable onPress={() => toggle('weak')} accessibilityRole="button" hitSlop={8}>
        <Text style={s.disclose}>{open === 'weak' ? '▾' : '▸'} Weak, never shown ({debug.weak.length})</Text>
      </Pressable>
      {open === 'weak' && debug.weak.map((w, i) => (
        <Text key={`w${i}`} style={s.row}><Text style={s.rowReason}>{w.reason}</Text> · {w.title}</Text>
      ))}

      <Pressable onPress={() => toggle('dupes')} accessibilityRole="button" hitSlop={8}>
        <Text style={s.disclose}>{open === 'dupes' ? '▾' : '▸'} Duplicates removed ({debug.duplicates.length})</Text>
      </Pressable>
      {open === 'dupes' && debug.duplicates.map((d, i) => (
        <Text key={`d${i}`} style={s.row}><Text style={s.rowReason}>{d.reason}</Text> · {formatMoney(d.price)} · {d.title}</Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  panel: { marginTop: 12, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed', borderColor: C.amber,
           backgroundColor: '#FBF7EA', padding: 10, gap: 4 },
  title: { fontSize: 11.5, fontWeight: '800', color: C.amber, letterSpacing: 0.3 },
  meta: { fontSize: 10.5, color: C.brown, lineHeight: 14.5 },
  comp: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.cardB, gap: 2 },
  compHead: { fontSize: 11, fontWeight: '700', color: C.brown },
  compWhy: { fontSize: 10.5, color: C.forest, fontWeight: '700' },
  plus: { fontSize: 10, color: C.forest },
  minus: { fontSize: 10, color: C.amber },
  markRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  markBtn: { borderWidth: 1, borderColor: C.cardB, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
             backgroundColor: C.card },
  markRight: { backgroundColor: C.forest, borderColor: C.forest },
  markWrong: { backgroundColor: C.amber, borderColor: C.amber },
  markText: { fontSize: 10.5, fontWeight: '800', color: C.brown },
  markTextOn: { color: '#FFFFFF' },
  error: { fontSize: 10.5, color: C.amber, fontWeight: '700', marginTop: 4 },
  disclose: { fontSize: 10.5, fontWeight: '800', color: C.brown, marginTop: 8 },
  row: { fontSize: 10, color: C.brown, lineHeight: 14, marginLeft: 8 },
  rowReason: { fontWeight: '700', color: C.amber },
});
/**
 * app/dev-sold-comps.tsx
 *
 * DEVELOPMENT-ONLY Sold Comps preview harness.
 *
 * ── Why a separate screen ─────────────────────────────────────────────────────
 * Injecting mock data into the real scan flow would mean production code that
 * knows how to fabricate comps — one flag away from shipping fake market data to
 * a user. This screen instead feeds mock PUBLIC-contract objects into the exact
 * production components, so the results screen's data path is untouched.
 *
 * ── Production safety, described accurately ──────────────────────────────────
 * Expo Router is file-based: THIS FILE EXISTS IN THE PRODUCTION BUNDLE AND ITS
 * ROUTE IS NAVIGABLE. A `<Stack.Screen>` declaration configures a route, it does
 * not create or remove one, so wrapping the declaration in `__DEV__` changes the
 * screen's options and nothing else. An earlier version of this comment claimed
 * otherwise and was wrong.
 *
 * What actually protects it, in order:
 *   1. `<Stack.Protected guard={__DEV__}>` in _layout.tsx, which Expo Router
 *      uses to block navigation to the route.
 *   2. This component's own `__DEV__` check, which returns a denial before any
 *      fixture is touched — defence in depth for a direct deep link.
 *   3. The fixtures are require()'d INSIDE that check rather than imported at
 *      the top, so in production the fixture module is never evaluated at all.
 *
 * Expo documents protected routes as client-side navigation control, not a
 * server-side security boundary. That is acceptable here precisely because the
 * payload is fake UI fixtures — no secrets, no user data, no network. It would
 * NOT be acceptable for anything sensitive.
 *
 * Makes no network requests of any kind. Reads no saved analysis. Writes nothing.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { ScreenContainer } from '@/components/screen-container';
import { SoldCompsSection } from '@/components/comps/SoldCompsSection';
import { C } from '@/components/comps/tokens';
import type { Fixture } from '@/components/comps/devFixtures';
// NOT imported at the top: a static import evaluates the fixture module on
// bundle load even in production. Required lazily inside the __DEV__ branch so
// it is never evaluated in a release build.

/** Simulated container widths. The section sizes cards from the window, so a
 *  narrower wrapper approximates a smaller device without a simulator restart. */
const WIDTHS = [
  { key: 'narrow',   label: 'Narrow (~320)',  width: 320 },
  { key: 'standard', label: 'Standard (~390)', width: 390 },
  { key: 'wide',     label: 'Wide (~430)',    width: 430 },
] as const;

export default function SoldCompsPreview() {
  // Hard stop outside development. Nothing below this line runs in production.
  if (!__DEV__) {
    return (
      <ScreenContainer>
        <View style={s.denied}>
          <Text style={s.deniedText}>Not available.</Text>
        </View>
      </ScreenContainer>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FIXTURES: Fixture[] = require('@/components/comps/devFixtures').FIXTURES;

  const [fixtureKey, setFixtureKey] = useState(FIXTURES[1].key);
  const [widthKey, setWidthKey] = useState<typeof WIDTHS[number]['key']>('standard');

  const fixture = FIXTURES.find(f => f.key === fixtureKey) ?? FIXTURES[0];
  const wrap = WIDTHS.find(w => w.key === widthKey) ?? WIDTHS[1];

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={s.page}>
        <Text style={s.h1}>Sold Comps preview</Text>
        <Text style={s.note}>
          Development only. Mock public-contract data — no provider call, no AI call,
          no quota, nothing saved.
        </Text>

        {/* ── Controls. Deliberately plain: this is a tool, not a screen. ──── */}
        <Text style={s.h2}>Container width</Text>
        <View style={s.row}>
          {WIDTHS.map(w => (
            <Pressable key={w.key} onPress={() => setWidthKey(w.key)}
              style={[s.chip, widthKey === w.key && s.chipOn]}>
              <Text style={[s.chipText, widthKey === w.key && s.chipTextOn]}>{w.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.h2}>State — {fixture.name}</Text>
        <View style={s.row}>
          {FIXTURES.map(f => (
            <Pressable key={f.key} onPress={() => setFixtureKey(f.key)}
              style={[s.chip, fixtureKey === f.key && s.chipOn]}>
              <Text style={[s.chipText, fixtureKey === f.key && s.chipTextOn]}>{f.name}</Text>
            </Pressable>
          ))}
        </View>

        {/* ── The real component, unmodified ──────────────────────────────── */}
        <View style={[s.stage, { width: wrap.width }]}>
          <SoldCompsSection loading={!!fixture.loading} data={fixture.data} />
        </View>

        <Text style={s.note}>
          For larger text: iOS Settings → Accessibility → Display &amp; Text Size →
          Larger Text. For reduced motion: Accessibility → Motion → Reduce Motion.
          Both take effect without restarting Expo.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  page: { padding: 14, gap: 10, paddingBottom: 60 },
  h1: { fontSize: 19, fontWeight: '800', color: C.forest },
  h2: { fontSize: 11, fontWeight: '800', color: C.brown, letterSpacing: 0.6, marginTop: 8 },
  note: { fontSize: 11, color: C.muted, lineHeight: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: C.cardB, borderRadius: 8,
          paddingHorizontal: 8, paddingVertical: 5, backgroundColor: C.card },
  chipOn: { backgroundColor: C.forest, borderColor: C.forest },
  chipText: { fontSize: 10.5, color: C.brown, fontWeight: '700' },
  chipTextOn: { color: '#F7F2DE' },
  stage: { alignSelf: 'center', marginTop: 12, borderWidth: 1, borderColor: C.cardB,
           borderRadius: 8, borderStyle: 'dashed', paddingVertical: 6 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deniedText: { fontSize: 14, color: '#8A7050' },
});
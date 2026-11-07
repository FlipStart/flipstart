/**
 * app/dev-fail-screens.tsx
 *
 * Preview of every scan fail screen. Renders the real FailStateScreen with
 * fixed sample data, so each one can be looked at and its buttons tapped
 * without forcing a failure.
 *
 * Safe to ship in a TestFlight build: no network, no account, no scans, no
 * charges. Buttons only report which action they would take. Hidden again by
 * setting FAIL_SCREEN_PREVIEW_VISIBLE to false in lib/devFlags.ts.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenContainer } from '@/components/screen-container';
import { FAIL_SCREEN_PREVIEW_VISIBLE } from '@/lib/devFlags';
import { FailStateScreen, type FailStateProps, type FailAction } from '@/components/scan/FailStateScreen';

const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const CREAM  = '#F4EED8';
const CARD   = '#FFFEFA';

// Any local image will do; the screens only show it as a thumbnail.
const SAMPLE_PHOTO = Image.resolveAssetSource(require('@/assets/images/hero-camera.png')).uri;

type Sample = { label: string; props: Omit<FailStateProps, 'onAction' | 'photoUri' | 'inHunt'>; hunt?: boolean };
type Group = { title: string; items: Sample[] };

const GROUPS: Group[] = [
  { title: 'The scan ran, but we are not sure', items: [
    { label: "Couldn't identify",         props: { screen: 'cannot_identify', charge: 'pending', seen: 'A dark garment, no tag or brand visible.' } },
    { label: 'Low confidence',            props: { screen: 'low_confidence',  charge: 'pending', seen: 'Looks like a fleece jacket, brand unclear.' } },
    { label: 'Several items',             props: { screen: 'multiple_items',  charge: 'pending' } },
    { label: 'Photo problem: blurry',     props: { screen: 'photo_problem', photoProblems: ['blurry'],   charge: 'pending', seen: 'Too blurry to read the tag.' } },
    { label: 'Photo problem: too dark',   props: { screen: 'photo_problem', photoProblems: ['too_dark'], charge: 'pending', seen: 'Hard to see anything.' } },
    { label: 'Photo problem: several',    props: { screen: 'photo_problem', photoProblems: ['blurry', 'glare'], charge: 'pending', seen: 'Blurry, with glare.' } },
    { label: 'No item found',             props: { screen: 'no_item', charge: 'not_used' } },
    { label: "Couldn't identify (Hunt)",  props: { screen: 'cannot_identify', charge: 'pending', seen: 'A dark garment, no tag or brand visible.' }, hunt: true },
  ] },
  { title: 'The scan did not run', items: [
    { label: 'Took too long',             props: { screen: 'timeout', charge: 'unknown' } },
    { label: 'Took too long (no scan used)', props: { screen: 'timeout', charge: 'not_used' } },
    { label: 'Offline',                   props: { screen: 'offline', charge: 'unknown' } },
    { label: 'Server down (Railway)',     props: { screen: 'server', cause: 'server_down', charge: 'not_used' } },
    { label: 'Server restarting',         props: { screen: 'server', cause: 'restarting',  charge: 'not_used' } },
    { label: 'AI overloaded',             props: { screen: 'server', cause: 'ai_busy',     charge: 'not_used' } },
    { label: 'AI could not finish',       props: { screen: 'server', cause: 'ai_failed',   charge: 'not_used' } },
    { label: 'Account check failed',      props: { screen: 'server', cause: 'account_check', charge: 'not_used' } },
    { label: 'Unknown server problem',    props: { screen: 'server', cause: 'unknown',     charge: 'unknown' } },
    { label: "Photo didn't load",         props: { screen: 'photo_load_failed', charge: 'not_used' } },
  ] },
  { title: 'Account', items: [
    { label: 'Sign in again',             props: { screen: 'sign_in', charge: 'not_used' } },
    { label: 'Out of scans: free',        props: { screen: 'out_of_scans', plan: 'free', charge: 'not_used' } },
    { label: 'Out of scans: subscriber',  props: { screen: 'out_of_scans', plan: 'pro',  charge: 'not_used' } },
    { label: 'Out of scans: plan unknown',props: { screen: 'out_of_scans', plan: null,   charge: 'not_used' } },
    { label: 'Pro feature: third photo',  props: { screen: 'pro_feature', paywall: 'third_photo', charge: 'not_used' } },
    { label: 'Pro feature: AI Context',   props: { screen: 'pro_feature', paywall: 'camera_context', charge: 'not_used' } },
    { label: 'Update needed',             props: { screen: 'app_outdated', charge: 'not_used' } },
  ] },
];

export default function DevFailScreens() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<Sample | null>(null);
  const [lastAction, setLastAction] = useState<FailAction | null>(null);

  if (!__DEV__) {
    if (!FAIL_SCREEN_PREVIEW_VISIBLE) {
      return (
        <ScreenContainer>
          <Text style={s.note}>Preview screens are not available in this build.</Text>
        </ScreenContainer>
      );
    }
  }

  if (active) {
    return (
      <View style={s.fill}>
        <FailStateScreen
          {...(active.props as any)}
          photoUri={SAMPLE_PHOTO}
          inHunt={!!active.hunt}
          onAction={(a) => { setLastAction(a); if (a === 'back') { setActive(null); setLastAction(null); } }}
        />
        <View style={[s.bar, { bottom: insets.bottom + 6 }]} pointerEvents="box-none">
          <Pressable style={s.pill} onPress={() => { setActive(null); setLastAction(null); }}>
            <Text style={s.pillText}>
              {lastAction ? `Tapped "${lastAction}" (nothing happens in preview)  ·  ` : 'Preview  ·  '}Close
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={s.list}>
        <Text style={s.h1}>Fail screens</Text>
        <Text style={s.sub}>
          Tap one to see the real screen with sample data. Buttons do nothing here except report which action they would take. No scan is used.
        </Text>
        {GROUPS.map(g => (
          <View key={g.title} style={s.group}>
            <Text style={s.groupTitle}>{g.title.toUpperCase()}</Text>
            <View style={s.card}>
              {g.items.map((it, i) => (
                <Pressable
                  key={it.label}
                  onPress={() => setActive(it)}
                  style={({ pressed }) => [s.row, i > 0 && s.rowLine, pressed && { opacity: 0.6 }]}
                >
                  <Text style={s.rowText}>{it.label}</Text>
                  <Text style={s.chev}>›</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        <Pressable style={s.close} onPress={() => router.back()}>
          <Text style={s.closeText}>Done</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: 20, paddingBottom: 60 },
  h1: { fontSize: 24, fontWeight: '700', color: FOREST, marginBottom: 6 },
  sub: { fontSize: 14, color: MUTED, marginBottom: 18, lineHeight: 20 },
  group: { marginBottom: 18 },
  groupTitle: { fontSize: 11, letterSpacing: 1.2, color: MUTED, marginBottom: 6, fontWeight: '600' },
  card: { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: '#E4D9B8', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14 },
  rowLine: { borderTopWidth: 1, borderTopColor: '#EFE6C9' },
  rowText: { flex: 1, fontSize: 15, color: BROWN },
  chev: { fontSize: 20, color: MUTED },
  close: { marginTop: 6, alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 28, backgroundColor: FOREST, borderRadius: 24 },
  closeText: { color: CREAM, fontWeight: '600', fontSize: 15 },
  note: { padding: 24, color: MUTED },
  bar: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: { backgroundColor: 'rgba(42,74,42,0.92)', borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14 },
  pillText: { color: CREAM, fontSize: 12 },
});
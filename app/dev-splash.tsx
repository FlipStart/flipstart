/**
 * app/dev-splash.tsx
 *
 * DEVELOPMENT-ONLY preview of the native launch screen's composition.
 *
 * ── This is a REPLICA, not the launch screen ────────────────────────────────
 * The real splash is an iOS launch storyboard compiled into the binary and
 * shown before any JavaScript runs. expo-splash-screen exposes only
 * preventAutoHideAsync/hideAsync — there is no API to re-display it — so no
 * button can ever show you the actual thing.
 *
 * ── Two modes, because the shipped one is now plain ─────────────────────────
 * SHIPPED opens first and is what app.config.ts actually produces today: solid
 * PW.forest, nothing else. No image is declared, so there is nothing more to
 * draw — and a preview that showed a wordmark the real screen does not have
 * would be worse than no preview at all.
 *
 * LOCKUP is a proposal, clearly labelled as not shipped. It exists so the
 * wordmark version can be judged on a real device, in real Georgia, before
 * deciding whether to generate the image with make_splash.py. Its numbers are
 * the generator's, so what appears here is what that script would output.
 *
 * What neither mode can tell you: whether the storyboard is wired up, whether
 * the colour flashes on launch, or how it behaves on a cold start. A build.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';
import { FONTS } from '@/constants/typography';
import { PW } from '@/components/monetization/paywall/paywallTheme';

/**
 * The generator's canvas and type sizes, kept here so the two stay in step.
 * Everything below is expressed as a fraction of these, then multiplied by the
 * real screen width — so the replica scales to any device the same way
 * resizeMode="cover" scales the real image.
 */
const GEN_W = 1290;
const GEN_WORDMARK_PX = 148;
const GEN_SUBTITLE_PX = 40;
const GEN_CENTRE_Y = 0.46;      // optical centre, not true centre
const GEN_SPARKLE_GAP = 58;
const GEN_SUBTITLE_GAP = 74;

/** A four-point sparkle. Same polygon the generator draws. */
function Sparkle({ size, color }: { size: number; color: string }) {
  const r = size / 2;
  const k = r * 0.28;
  const pts = [
    [r, r - r], [r + k, r - k], [r + r, r], [r + k, r + k],
    [r, r + r], [r - k, r + k], [r - r, r], [r - k, r - k],
  ].map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <Svg width={size} height={size}>
      <Polygon points={pts} fill={color} />
    </Svg>
  );
}

export default function DevSplashScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  /** Defaults to what actually ships, not to the proposal. */
  const [showLockup, setShowLockup] = React.useState(false);

  if (!__DEV__) return null;

  const scale = width / GEN_W;
  const wordmarkSize = GEN_WORDMARK_PX * scale;
  const subtitleSize = GEN_SUBTITLE_PX * scale;
  const sparkleSize = wordmarkSize * 0.30;

  return (
    <View style={[s.root, { backgroundColor: PW.forest }]}>
      {/* ── The lockup. Hidden by default: the shipped splash has no image. ── */}
      {showLockup && (
      <View style={[s.lockup, { top: height * GEN_CENTRE_Y - wordmarkSize }]}>
        <View style={[s.row, { gap: GEN_SPARKLE_GAP * scale }]}>
          <Sparkle size={sparkleSize} color={PW.gold} />
          <Text
            style={{
              fontFamily: FONTS.serif,
              fontSize: wordmarkSize,
              fontWeight: '800',
              color: PW.cream,
              lineHeight: wordmarkSize * 1.2,
            }}
            allowFontScaling={false}
          >
            FlipStart
          </Text>
          <Sparkle size={sparkleSize} color={PW.gold} />
        </View>

        <Text
          style={{
            fontFamily: FONTS.serif,
            fontSize: subtitleSize,
            letterSpacing: subtitleSize * 0.34,
            color: PW.gold,
            marginTop: GEN_SUBTITLE_GAP * scale,
            // letterSpacing pads the last glyph too; pull back so the tracked
            // string still reads as centred.
            marginLeft: subtitleSize * 0.34,
          }}
          allowFontScaling={false}
        >
          THRIFT & RESALE AI
        </Text>
      </View>
      )}

      {/* ── Dev chrome. Nothing here exists on the real launch screen. ───── */}
      <View style={[s.bar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Close splash preview"
          style={({ pressed }) => [s.close, pressed && { opacity: 0.5 }]}
        >
          <Text style={s.closeText}>Close</Text>
        </Pressable>

        <Pressable
          onPress={() => setShowLockup(v => !v)}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityState={{ selected: showLockup }}
          style={({ pressed }) => [s.close, pressed && { opacity: 0.5 }]}
        >
          <Text style={s.closeText}>{showLockup ? 'Shipped' : 'Lockup'}</Text>
        </Pressable>
      </View>

      <View style={[s.note, { paddingBottom: insets.bottom + 14 }]}>
        <Text style={s.noteText}>
          {showLockup
            ? 'LOCKUP — a proposal. NOT what ships: app.config.ts declares no splash image. Run make_splash.py to make this real.'
            : 'SHIPPED — solid PW.forest, no image. This is what app.config.ts produces today.'}
        </Text>
        <Text style={s.noteMeta}>
          {`${Math.round(width)}×${Math.round(height)}  ·  ${PW.forest} / ${PW.cream} / ${PW.gold}  ·  ${FONTS.serif}`}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  lockup: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },

  bar: {
    position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 18,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  close: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(244,238,216,0.35)' },
  closeText: { color: 'rgba(244,238,216,0.75)', fontSize: 13, fontWeight: '700' },

  note: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 22, gap: 6 },
  noteText: { color: 'rgba(244,238,216,0.45)', fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  noteMeta: { color: 'rgba(196,163,52,0.55)', fontSize: 10, textAlign: 'center' },
});
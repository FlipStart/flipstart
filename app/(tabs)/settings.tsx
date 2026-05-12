import {
  View, Text, Pressable, StyleSheet, Alert, ScrollView, Modal, Animated, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as MailComposer from 'expo-mail-composer';
import { useRef, useState, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useCameraPermissions } from 'expo-camera';

// Exact splash config from app.config.ts — keep in sync if splash asset changes
const SPLASH_IMAGE  = require('@/assets/images/flipstart-splash.png');
const SPLASH_BG     = '#E8C99A';   // backgroundColor from app.config.ts
const SPLASH_HOLD   = 2200;        // ms to hold before fading — realistic cold-launch feel
const SPLASH_FADE   = 500;         // ms fade-out duration
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFlipStore } from '@/lib/useFlipStore';
import { resetOnboarding } from '@/lib/onboarding-storage';
import { V } from '@/constants/vintage';
import { FONTS } from '@/constants/typography';

const FEEDBACK_EMAIL = 'flipstartapp@gmail.com';

const GOLD   = '#BE9C2C';
const FOREST = '#2A4A2A';
const BROWN  = '#5A3A1A';
const MUTED  = '#8A7050';
const CARD   = '#FFF9EE';
const CARD_B = '#DDD0B0';
const BG     = '#F0E8D4';
const CREAM  = '#F4EED8';
const DANGER = '#8A2A2A';

export default function SettingsScreen() {
  const insets          = useSafeAreaInsets();
  const router          = useRouter();
  const { clearAllFlips, flips } = useFlipStore();

  const handleClearHistory = () => {
    if (flips.length === 0) {
      Alert.alert('No History', 'Your scan history is already empty.');
      return;
    }
    Alert.alert(
      'Clear Scan History',
      `This will permanently delete all ${flips.length} saved flip${flips.length !== 1 ? 's' : ''}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            clearAllFlips();
            Alert.alert('Cleared', 'Your scan history has been cleared.');
          },
        },
      ],
    );
  };

  const handleSendFeedback = async () => {
    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert(
        'Mail Not Available',
        `Please email us directly at ${FEEDBACK_EMAIL}`,
      );
      return;
    }
    await MailComposer.composeAsync({
      recipients: [FEEDBACK_EMAIL],
      subject:    'FlipStart Feedback',
      body:       'Hi FlipStart team,\n\n',
    });
  };

  const handleResetOnboarding = () => {
    Alert.alert(
      'Reset Onboarding',
      'This will show the onboarding flow next time you restart the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: async () => {
            await resetOnboarding();
            Alert.alert('Done', 'Restart the app to see onboarding again.');
          },
        },
      ],
    );
  };

  const [splashVisible, setSplashVisible] = useState(false);
  const splashOpacity = useRef(new Animated.Value(1)).current;

  // ── Permission state ───────────────────────────────────────────────────────
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [libraryPermission, requestLibraryPermission] = ImagePicker.useMediaLibraryPermissions();

  // Refresh permission state when screen focuses
  useEffect(() => {
    ImagePicker.getMediaLibraryPermissionsAsync().then(() => {});
  }, []);

  const handleTestPermissions = async () => {
    const camStatus    = cameraPermission?.status  ?? 'undetermined';
    const libStatus    = libraryPermission?.status ?? 'undetermined';
    const camCanAsk    = cameraPermission?.canAskAgain  ?? true;
    const libCanAsk    = libraryPermission?.canAskAgain ?? true;

    const allDetermined =
      camStatus !== 'undetermined' && libStatus !== 'undetermined';

    if (!allDetermined) {
      // At least one permission is undetermined — trigger the real request flows
      if (camStatus === 'undetermined') await requestCameraPermission();
      if (libStatus === 'undetermined') await requestLibraryPermission();
      return;
    }

    // All already determined — show honest status + reset instructions
    const lines: string[] = [
      `Camera: ${camStatus.toUpperCase()}`,
      `Photo Library: ${libStatus.toUpperCase()}`,
      '',
      'iOS does not allow apps to reset permissions once answered.',
      '',
      'To reset: go to iPhone Settings → Privacy → Camera or Photos, or delete and reinstall FlipStart.',
    ];

    Alert.alert(
      'Permission Status',
      lines.join('\n'),
      [
        { text: 'Close', style: 'cancel' },
        { text: 'Open iPhone Settings', onPress: () => Linking.openSettings() },
      ],
    );
  };

  const handlePreviewSplash = () => {
    // Reset opacity, show modal, hold, then fade out
    splashOpacity.setValue(1);
    setSplashVisible(true);
    setTimeout(() => {
      Animated.timing(splashOpacity, {
        toValue:         0,
        duration:        SPLASH_FADE,
        useNativeDriver: true,
      }).start(() => setSplashVisible(false));
    }, SPLASH_HOLD);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.65 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={CREAM} />
        </Pressable>

        <Text style={s.headerTitle}>Settings</Text>

        <Pressable
          onPress={() => router.push('/(tabs)/profile' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.65 }]}
        >
          <MaterialIcons name="person" size={20} color={CREAM} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Data ── */}
        <Text style={s.sectionLabel}>DATA</Text>
        <View style={s.card}>
          <SettingsRow
            icon="history"
            label="Clear Scan History"
            sub={flips.length > 0 ? `${flips.length} saved flip${flips.length !== 1 ? 's' : ''}` : 'No history yet'}
            color={DANGER}
            onPress={handleClearHistory}
          />
        </View>

        {/* ── Support ── */}
        <Text style={s.sectionLabel}>SUPPORT</Text>
        <View style={s.card}>
          <SettingsRow
            icon="feedback"
            label="Send Feedback"
            sub={FEEDBACK_EMAIL}
            color={FOREST}
            onPress={handleSendFeedback}
          />
        </View>

        {/* ── Account ── */}
        <Text style={s.sectionLabel}>ACCOUNT</Text>
        <View style={s.card}>
          <SettingsRow
            icon="restart-alt"
            label="Reset Onboarding"
            sub="View the intro flow again"
            color={MUTED}
            onPress={handleResetOnboarding}
          />
        </View>

        {/* ── Permissions ── */}
        <Text style={s.sectionLabel}>PERMISSIONS</Text>
        <View style={s.card}>
          <PermissionRow
            icon="camera-alt"
            label="Camera"
            sub="Used to scan thrift items"
            status={cameraPermission?.status}
            canAskAgain={cameraPermission?.canAskAgain ?? true}
            onRequest={requestCameraPermission}
          />
          <View style={s.divider} />
          <PermissionRow
            icon="photo-library"
            label="Photo Library"
            sub="Used to upload saved item photos"
            status={libraryPermission?.status}
            canAskAgain={libraryPermission?.canAskAgain ?? true}
            onRequest={requestLibraryPermission}
          />
        </View>

        {/* ── Developer ── */}
        <Text style={s.sectionLabel}>DEVELOPER</Text>
        <View style={s.card}>
          <SettingsRow
            icon="play-circle-outline"
            label="Preview Splash Screen"
            sub="Reload app to test cold launch experience"
            color={FOREST}
            onPress={handlePreviewSplash}
          />
          <View style={s.divider} />
          <SettingsRow
            icon="security"
            label="Test Permission Prompts"
            sub="Verify camera & library permission flows"
            color={GOLD}
            onPress={handleTestPermissions}
          />
        </View>

        {/* ── About ── */}
        <Text style={s.sectionLabel}>ABOUT</Text>
        <View style={s.card}>
          <SettingsRow
            icon="info-outline"
            label="About FlipStart"
            sub="What we are, how it works, beta info"
            color={GOLD}
            onPress={() => router.push('/about' as any)}
          />
          <View style={s.divider} />
          <View style={s.row}>
            <View style={[s.iconWrap, { backgroundColor: GOLD + '18' }]}>
              <MaterialIcons name="tag" size={18} color={GOLD} />
            </View>
            <View style={s.rowText}>
              <Text style={s.rowLabel}>Version</Text>
              <Text style={s.rowSub}>1.0.0 Beta · Closed Beta</Text>
            </View>
          </View>
          <View style={s.divider} />
          <View style={s.disclosureRow}>
            <Text style={s.disclosureText}>
              FlipStart collects basic usage data — scans, feedback, and feature interactions — to improve AI accuracy and beta performance. We do not sell personal data.
            </Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      {/* Pre-render splash image off-screen so iOS decodes it before modal opens.
          This eliminates the solid-color flash on slower devices/connections.   */}
      <Image
        source={SPLASH_IMAGE}
        style={s.splashPreload}
        contentFit="cover"
        cachePolicy="memory"
      />

      {/* ── Splash screen simulation ── */}
      <Modal visible={splashVisible} animationType="none" statusBarTranslucent>
        <Animated.View style={[s.splashRoot, { opacity: splashOpacity }]}>
          <Image
            source={SPLASH_IMAGE}
            style={s.splashImage}
            contentFit="cover"
            cachePolicy="memory"
          />
        </Animated.View>
      </Modal>
    </View>
  );
}

function SettingsRow({
  icon, label, sub, color, onPress,
}: {
  icon: string; label: string; sub?: string; color: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <View style={[s.iconWrap, { backgroundColor: color + '18' }]}>
        <MaterialIcons name={icon as any} size={18} color={color} />
      </View>
      <View style={s.rowText}>
        <Text style={[s.rowLabel, { color }]}>{label}</Text>
        {sub && <Text style={s.rowSub}>{sub}</Text>}
      </View>
      <MaterialIcons name="chevron-right" size={18} color={MUTED} />
    </Pressable>
  );
}

// ─── Permission status helpers ────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  granted:       'Allowed',
  denied:        'Denied',
  undetermined:  'Not Asked',
  limited:       'Limited',
};
const STATUS_COLOR: Record<string, string> = {
  granted:      '#4A7A4A',
  denied:       '#8A2A2A',
  undetermined: '#8A7050',
  limited:      '#7A6A2A',
};

function PermissionRow({
  icon, label, sub, status, canAskAgain, onRequest,
}: {
  icon: string;
  label: string;
  sub: string;
  status: string | undefined;
  canAskAgain: boolean;
  onRequest: () => void;
}) {
  const s_ = status ?? 'undetermined';
  const color = STATUS_COLOR[s_] ?? STATUS_COLOR.undetermined;
  const badge = STATUS_LABEL[s_] ?? 'Unknown';
  const isDenied       = s_ === 'denied';
  const isUndetermined = s_ === 'undetermined';

  const handleAction = () => {
    if (isUndetermined || (isDenied && canAskAgain)) {
      onRequest();
    } else if (isDenied && !canAskAgain) {
      Linking.openSettings();
    } else {
      // Granted / limited — open settings to manage
      Linking.openSettings();
    }
  };

  const actionLabel = isUndetermined ? 'Request Access'
    : isDenied         ? 'Open Settings'
    : 'Manage';

  return (
    <Pressable
      onPress={handleAction}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <View style={[s.iconWrap, { backgroundColor: FOREST + '18' }]}>
        <MaterialIcons name={icon as any} size={18} color={FOREST} />
      </View>
      <View style={s.rowText}>
        <Text style={[s.rowLabel, { color: BROWN }]}>{label}</Text>
        {sub && <Text style={s.rowSub}>{sub}</Text>}
      </View>
      <View style={[s.permBadge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
        <Text style={[s.permBadgeText, { color }]}>{badge}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={16} color={MUTED} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: CARD_B,
    backgroundColor:   FOREST,
  },
  headerBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.serif, fontSize: 20, fontWeight: '700', color: CREAM, textAlign: 'center',
    flex: 1,
  },
  scroll:       { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: MUTED,
    letterSpacing: 1.4, marginBottom: 6, marginLeft: 4,
  },
  card: {
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: CARD_B,
    marginBottom: 20, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  rowText:  { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '700', color: BROWN, fontFamily: FONTS.serif },
  rowSub:   { fontSize: 11, color: MUTED, marginTop: 2 },
  divider:  { height: 1, backgroundColor: CARD_B, marginLeft: 16 },
  permBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  permBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  disclosureRow: { paddingHorizontal: 16, paddingVertical: 12 },
  disclosureText: { fontSize: 11, color: MUTED, lineHeight: 17 },
  // ── Splash simulation ──────────────────────────────────────────────────────
  // Mirrors app.config.ts: backgroundColor #E8C99A, resizeMode cover
  splashRoot: {
    flex: 1,
    backgroundColor: SPLASH_BG,
  },
  splashImage: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    width: '100%',
    height: '100%',
  },
  // Zero-size off-screen render — forces asset decode the moment settings mounts
  splashPreload: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
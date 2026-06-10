import {
  View, Text, Pressable, StyleSheet, Alert, ScrollView, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as MailComposer from 'expo-mail-composer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFlipStore } from '@/lib/useFlipStore';
import { resetOnboarding } from '@/lib/onboarding-storage';
import { useAuth } from '@/lib/auth-context';
import { FONTS } from '@/constants/typography';
import { useState, useEffect } from 'react';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

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

type PermStatus = 'Allowed' | 'Denied' | 'Not Asked';

function statusColor(s: PermStatus) {
  if (s === 'Allowed') return '#2A6A2A';
  if (s === 'Denied')  return DANGER;
  return MUTED;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearAllFlips, flips } = useFlipStore();
  const { user, profile, signOut } = useAuth();

  const [cameraStatus,   setCameraStatus]   = useState<PermStatus>('Not Asked');
  const [photoStatus,    setPhotoStatus]    = useState<PermStatus>('Not Asked');
  const [locationStatus, setLocationStatus] = useState<PermStatus>('Not Asked');

  useEffect(() => {
    (async () => {
      const cam = await Camera.getCameraPermissionsAsync();
      setCameraStatus(cam.granted ? 'Allowed' : cam.canAskAgain ? 'Not Asked' : 'Denied');

      const photo = await ImagePicker.getMediaLibraryPermissionsAsync();
      setPhotoStatus(photo.granted ? 'Allowed' : photo.canAskAgain ? 'Not Asked' : 'Denied');

      const loc = await Location.getForegroundPermissionsAsync();
      setLocationStatus(loc.granted ? 'Allowed' : loc.canAskAgain ? 'Not Asked' : 'Denied');
    })();
  }, []);

  const handlePermissionTap = (status: PermStatus, trigger: 'camera' | 'photo' | 'location') => {
    if (status === 'Not Asked') {
      const message = trigger === 'location'
        ? 'Start a live hunt first — location permission will be requested automatically when you begin Hunt Mode.'
        : 'Scan an item first — permission will be requested automatically when you open the camera.';
      Alert.alert('Permission Not Yet Requested', message, [{ text: 'OK' }]);
      return;
    }
    Linking.openSettings();
  };

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
      Alert.alert('Mail Not Available', `Please email us directly at ${FEEDBACK_EMAIL}`);
      return;
    }
    await MailComposer.composeAsync({
      recipients: [FEEDBACK_EMAIL],
      subject:    'FlipStart Feedback',
      body:       'Hi FlipStart team,\n\n',
    });
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

        {/* ── Permissions ── */}
        <Text style={s.sectionLabel}>PERMISSIONS</Text>
        <View style={s.card}>
          <PermissionRow
            icon="camera-alt"
            label="Camera"
            sub="Used to photograph thrift items for resale analysis."
            status={cameraStatus}
            onPress={() => handlePermissionTap(cameraStatus, 'camera')}
          />
          <View style={s.divider} />
          <PermissionRow
            icon="photo-library"
            label="Photo Library"
            sub="Used to upload saved item photos for analysis."
            status={photoStatus}
            onPress={() => handlePermissionTap(photoStatus, 'photo')}
          />
          <View style={s.divider} />
          <PermissionRow
            icon="location-on"
            label="Location"
            sub="Used to label Hunt Mode sessions by store or area."
            status={locationStatus}
            onPress={() => handlePermissionTap(locationStatus, 'location')}
          />
        </View>

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

        {/* ── About ── */}
        <Text style={s.sectionLabel}>ABOUT</Text>
        <View style={s.card}>
          <SettingsRow
            icon="info-outline"
            label="About FlipStart"
            sub="How it works, our mission, and more"
            color={GOLD}
            onPress={() => router.push('/about' as any)}
          />
          <View style={s.divider} />
          <SettingsRow
            icon="star-rate"
            label="Review FlipStart"
            sub="Leave a quick App Store rating to help the mission."
            color={GOLD}
            onPress={async () => {
              try {
                const StoreReview = await import('expo-store-review');
                const available   = await StoreReview.isAvailableAsync();
                if (available) {
                  await StoreReview.requestReview();
                } else {
                  Alert.alert('Thanks!', 'We appreciate your support. You can find us on the App Store to leave a review.');
                }
              } catch {
                Alert.alert('Thanks!', 'We appreciate your support.');
              }
            }}
          />
          <View style={s.divider} />
          <View style={s.row}>
            <View style={[s.iconWrap, { backgroundColor: GOLD + '18' }]}>
              <MaterialIcons name="tag" size={18} color={GOLD} />
            </View>
            <View style={s.rowText}>
              <Text style={s.rowLabel}>Version</Text>
              <Text style={s.rowSub}>1.0.0</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />

        {/* ── Account ─────────────────────────────────────────────── */}
        {user ? (
          <View style={s.card}>
            <Pressable
              onPress={() => Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: () => signOut().catch(() => {}) },
              ])}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[s.iconWrap, { backgroundColor: '#B8545418' }]}>
                <MaterialIcons name="logout" size={18} color="#B85450" />
              </View>
              <View style={s.rowText}>
                <Text style={[s.rowLabel, { color: '#B85450' }]}>Sign Out</Text>
                <Text style={s.rowSub}>{profile?.username ? `@${profile.username}` : (user.email ?? '')}</Text>
              </View>
            </Pressable>
          </View>
        ) : (
          <View style={s.card}>
            <Pressable
              onPress={() => router.push({ pathname: '/auth', params: { mode: 'signup' } } as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[s.iconWrap, { backgroundColor: FOREST + '18' }]}>
                <MaterialIcons name="person-add" size={18} color={FOREST} />
              </View>
              <View style={s.rowText}>
                <Text style={s.rowLabel}>Create Account</Text>
                <Text style={s.rowSub}>Save your progress across devices</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={MUTED} />
            </Pressable>
            <View style={s.divider} />
            <Pressable
              onPress={() => router.push({ pathname: '/auth', params: { mode: 'login' } } as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[s.iconWrap, { backgroundColor: GOLD + '18' }]}>
                <MaterialIcons name="login" size={18} color={GOLD} />
              </View>
              <View style={s.rowText}>
                <Text style={s.rowLabel}>Log In</Text>
                <Text style={s.rowSub}>Access your existing account</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={MUTED} />
            </Pressable>
          </View>
        )}

        {/* DEV — reset onboarding */}
        {__DEV__ && (
          <Pressable
            onPress={() => resetOnboarding().then(() => Alert.alert('Reset', 'Onboarding reset. Restart the app.')).catch(() => {})}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }, { marginBottom: 8 }]}
          >
            <Text style={[s.rowLabel, { color: '#B85450' }]}>Reset Onboarding (Dev)</Text>
          </Pressable>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>
    </View>
  );
}

function PermissionRow({
  icon, label, sub, status, onPress,
}: {
  icon: string; label: string; sub: string; status: PermStatus; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <View style={[s.iconWrap, { backgroundColor: FOREST + '18' }]}>
        <MaterialIcons name={icon as any} size={18} color={FOREST} />
      </View>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowSub}>{sub}</Text>
      </View>
      <Text style={[s.statusText, { color: statusColor(status) }]}>{status}</Text>
    </Pressable>
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

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: CARD_B, backgroundColor: FOREST,
  },
  headerBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: {
    fontFamily: FONTS.serif, fontSize: 20, fontWeight: '700', color: CREAM,
    textAlign: 'center', flex: 1,
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
  divider: { height: 1, backgroundColor: CARD_B, marginHorizontal: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  rowText:    { flex: 1 },
  rowLabel:   { fontSize: 14, fontWeight: '700', color: BROWN, fontFamily: FONTS.serif },
  rowSub:     { fontSize: 11, color: MUTED, marginTop: 2 },
  statusText: { fontSize: 11, fontWeight: '700' },
});
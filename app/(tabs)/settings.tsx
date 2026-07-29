/**
 * app/(tabs)/settings.tsx — Settings Screen (Redesigned)
 *
 * Structure:
 *   1. ACCOUNT card  — avatar, name, username, plan, View Profile
 *   2. PERMISSIONS   — camera, photo library, location
 *   3. SUPPORT       — help, send feedback
 *   4. ABOUT         — about, review, privacy, terms, version
 *   5. ACCOUNT       — clear history, delete (placeholder), sign out / log in
 *
 * All business logic is preserved. Only UI restructured to match the
 * cream/vintage FlipStart design language established in profile.tsx.
 */

import {
  View, Text, Pressable, StyleSheet, Alert, ScrollView, Linking, Image,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as MailComposer from 'expo-mail-composer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFlipStore } from '@/lib/useFlipStore';
import { resetOnboarding } from '@/lib/onboarding-storage';
import { useAuth } from '@/lib/auth-context';
import { useAchievementNotifications } from '@/lib/AchievementNotificationContext';
import { getClearHistoryImpact, type ClearHistoryImpact, type ImpactContext } from '@/lib/scanDeletionImpact';
import { trackAnalyticsEvent, useScreenFocus } from '@/lib/analytics';
import { ClearHistoryModal } from '@/components/DeleteImpactModal';
import { FONTS } from '@/constants/typography';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

const FEEDBACK_EMAIL = 'flipstartapp@gmail.com';

// ─── Palette — identical to profile.tsx ──────────────────────────────────────
const FOREST      = '#2A4A2A';
const GOLD        = '#BE9C2C';
const PARCH       = '#FFFFFF';   // page background — white app-wide
const CARD        = '#FFFEFA';
const BORDER      = '#DDD2AC';
const TAN         = '#DDD2AC';
const BROWN       = '#3D2A12';
const MUTED       = '#8A7050';
const AVATAR_BLUE = '#8AABBF';
const DANGER      = '#8A2A2A';

const avatarKey = (uid: string) => `@flipstart/avatar:${uid}`;

type PermStatus = 'Allowed' | 'Denied' | 'Not Asked';

function statusColor(s: PermStatus) {
  if (s === 'Allowed') return '#2A6A2A';
  if (s === 'Denied')  return DANGER;
  return MUTED;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearAllFlips, flips } = useFlipStore();
  const { user, profile, signOut } = useAuth();
  const { pruneUnseen } = useAchievementNotifications();
  const [clearImpact, setClearImpact] = useState<ClearHistoryImpact | null>(null);
  const finalValidRef = useRef<{ achievements: string[]; brands: string[]; diamonds: string[] }>({ achievements: [], brands: [], diamonds: [] });
  useScreenFocus('settings_opened');

  const [cameraStatus,   setCameraStatus]   = useState<PermStatus>('Not Asked');
  const [photoStatus,    setPhotoStatus]    = useState<PermStatus>('Not Asked');
  const [locationStatus, setLocationStatus] = useState<PermStatus>('Not Asked');
  const [avatarUri,      setAvatarUri]      = useState<string | null>(null);

  // ── Permissions — load once on mount ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      const cam   = await Camera.getCameraPermissionsAsync();
      setCameraStatus(cam.granted ? 'Allowed' : cam.canAskAgain ? 'Not Asked' : 'Denied');

      const photo = await ImagePicker.getMediaLibraryPermissionsAsync();
      setPhotoStatus(photo.granted ? 'Allowed' : photo.canAskAgain ? 'Not Asked' : 'Denied');

      const loc   = await Location.getForegroundPermissionsAsync();
      setLocationStatus(loc.granted ? 'Allowed' : loc.canAskAgain ? 'Not Asked' : 'Denied');
    })();
  }, []);

  // ── Avatar — refresh on focus so Edit Profile changes appear immediately ──
  useFocusEffect(useCallback(() => {
    const uid = user?.id ?? null;
    if (uid) {
      // Prefer the Supabase-backed avatar; local cache is the fallback.
      if (profile?.avatar_url) {
        setAvatarUri(profile.avatar_url);
      } else {
        AsyncStorage.getItem(avatarKey(uid))
          .then(uri => setAvatarUri(uri ?? null))
          .catch(() => {});
      }
    } else {
      setAvatarUri(null);
    }
  }, [user?.id, profile?.avatar_url]));

  // ── Handlers (all original logic preserved) ───────────────────────────────
  const handlePermissionTap = (status: PermStatus, trigger: 'camera' | 'photo' | 'location') => {
    if (status === 'Not Asked') {
      Alert.alert(
        'Permission Not Yet Requested',
        trigger === 'location'
          ? 'Start a live hunt first — location permission will be requested automatically when you begin Hunt Mode.'
          : 'Scan an item first — permission will be requested automatically when you open the camera.',
        [{ text: 'OK' }]
      );
      return;
    }
    Linking.openSettings();
  };

  const handleClearHistory = () => {
    if (flips.length === 0) {
      Alert.alert('No History', 'Your scan history is already empty.');
      return;
    }
    (async () => {
      let ctx: ImpactContext = { completedHunts: 0, huntStreak: 0, huntBrands: [] };
      const uid = user?.id;
      if (uid) {
        try {
          const { loadXpProfile } = await import('@/lib/huntXp');
          const xp = await loadXpProfile(uid).catch(() => null);
          ctx = {
            completedHunts: xp?.completedHunts ?? 0,
            huntStreak:     xp?.huntStreak ?? 0,
            huntBrands:     xp?.discoveredBrands ?? [],
          };
        } catch { /* defaults */ }
      }

      // Snapshot the FINAL valid sets after clearing (flips empty → only
      // hunt-mode brands / non-flip achievements survive). performClearHistory
      // reconciles cloud + local to exactly this truth.
      try {
        const { computeValidSets } = await import('@/lib/scanDeletionImpact');
        finalValidRef.current = computeValidSets([], ctx);
      } catch {
        finalValidRef.current = { achievements: [], brands: [], diamonds: [] };
      }

      setClearImpact(getClearHistoryImpact(flips, ctx));
    })();
  };

  const performClearHistory = () => {
    const uid = user?.id;
    trackAnalyticsEvent('scan_history_cleared', { scans_deleted: flips.length });
    clearAllFlips();

    const valid = finalValidRef.current;

    // Prune badges to only what survives clearing.
    pruneUnseen(valid);

    // Signed-in: reconcile cloud + local seen/meta keys to the final truth so
    // cleared progress can't resurrect on the next sync. Fail-safe.
    if (uid) {
      import('@/lib/achievementSync')
        .then(({ reconcileAchievementsToLocalTruth }) => reconcileAchievementsToLocalTruth(uid, valid.achievements))
        .catch(() => {});
      import('@/lib/brandSync')
        .then(({ reconcileBrandsToLocalTruth }) => reconcileBrandsToLocalTruth(uid, valid.brands))
        .catch(() => {});
      import('@/lib/diamondSync')
        .then(({ reconcileDiamondsToLocalTruth }) => reconcileDiamondsToLocalTruth(uid, valid.diamonds))
        .catch(() => {});
    }

    finalValidRef.current = { achievements: [], brands: [], diamonds: [] };
    setClearImpact(null);
    Alert.alert('Cleared', 'Your scan history has been cleared.');
  };

  const handleSendFeedback = async () => {
    const available = await MailComposer.isAvailableAsync();
    if (!available) {
      Alert.alert('Mail Not Available', `Please email us directly at ${FEEDBACK_EMAIL}`);
      return;
    }
    await MailComposer.composeAsync({
      recipients: [FEEDBACK_EMAIL],
      subject:    'FlipStart Feedback',
      body:       'Hi FlipStart team,\n\n',
    });
  };

  // ─── Account deletion (Apple App Store requirement) ────────────────────────
  // Opens a pre-filled deletion request from the account's email. Explains what
  // is deleted and the timeline, per Apple guideline 5.1.1(v).
  const sendDeletionRequest = async () => {
    const acctEmail = user?.email ?? '';
    const uname     = profile?.username ?? '';
    const subject   = 'Delete My FlipStart Account';
    const body =
      'Please delete my FlipStart account and associated personal data.\n\n' +
      `Account email: ${acctEmail}\n` +
      `Username: ${uname}\n\n` +
      'I understand this may permanently remove my profile, saved scans, Hunt Mode ' +
      'progress, achievements, Brand Compendium discoveries, Diamonds in the Rough ' +
      'progress, XP, and related account data.';

    const available = await MailComposer.isAvailableAsync().catch(() => false);
    if (available) {
      await MailComposer.composeAsync({ recipients: [FEEDBACK_EMAIL], subject, body })
        .then(() => {
          Alert.alert(
            'Request Started',
            'Send the email to submit your deletion request. We\u2019ll process it as soon as reasonably possible.',
            [{ text: 'OK' }],
          );
        })
        .catch(() => {/* user cancelled compose — no-op */});
      return;
    }

    // Fallback: open the default mail client via mailto: with everything filled.
    const mailto =
      `mailto:${FEEDBACK_EMAIL}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;
    const canOpen = await Linking.canOpenURL(mailto).catch(() => false);
    if (canOpen) {
      await Linking.openURL(mailto).catch(() => {});
    } else {
      Alert.alert('Mail Not Available', `Please email us at ${FEEDBACK_EMAIL} to request account deletion.`);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'To delete your FlipStart account and associated personal data, send us a deletion request from the email connected to your account.\n\n' +
      'We will process deletion requests as soon as reasonably possible, unless we need to retain limited information for legal, security, fraud prevention, or support purposes.\n\n' +
      'This will delete your profile, saved scans, Hunt Mode progress, achievements, Brand Compendium discoveries, Diamonds in the Rough progress, XP, and related account data.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send Deletion Request', style: 'destructive', onPress: () => { void sendDeletionRequest(); } },
      ],
    );
  };

  const handleReview = async () => {
    // Settings "Rate" is a deliberate action — always send the user to the
    // App Store review page rather than the native in-app sheet, which iOS
    // rate-limits and may silently suppress (leaving the tap doing nothing).
    const { openAppStoreReviewPage } = await import('@/lib/reviewPrompt');
    await openAppStoreReviewPage();
  };

  // Identity — same fallback logic as profile.tsx
  const displayName  = profile?.display_name || profile?.username || 'FlipStart Member';
  const usernameText = profile?.username ? `@${profile.username}` : null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header — cream, matching Profile screen ─────────────────────── */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={FOREST} />
        </Pressable>

        <Text style={s.headerTitle}>Settings</Text>

        <Pressable
          onPress={() => router.push('/(tabs)/profile' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="person" size={20} color={FOREST} />
        </Pressable>
      </View>
      <View style={s.headerDivider} />

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ══════════════ SECTION 1 — ACCOUNT CARD ══════════════════════ */}
        <View style={s.accountCard}>

          {/* Avatar + identity row */}
          <Pressable
            onPress={() => router.push('/(tabs)/profile' as any)}
            style={({ pressed }) => [s.acTop, pressed && { opacity: 0.82 }]}
          >
            <View style={s.acAvatarRing}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={s.acAvatarImg} />
              ) : (
                <MaterialIcons name="person" size={30} color={AVATAR_BLUE} />
              )}
            </View>
            <View style={s.acMeta}>
              <Text style={s.acName} numberOfLines={1}>{displayName}</Text>
              {usernameText ? <Text style={s.acUsername}>{usernameText}</Text> : null}
              <Text style={s.acPlan}>FlipStart Free Member</Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color={MUTED} />
          </Pressable>

          <View style={s.cardDivider} />

          {/* View Profile button */}
          <Pressable
            onPress={() => router.push('/(tabs)/profile' as any)}
            style={({ pressed }) => [s.viewProfileBtn, pressed && { backgroundColor: BORDER + '28' }]}
          >
            <Text style={s.viewProfileText}>View Profile</Text>
            <MaterialIcons name="arrow-forward" size={14} color={FOREST} />
          </Pressable>

        </View>

        {/* ══════════════ SECTION 2 — PERMISSIONS ══════════════════════ */}
        <Text style={s.sectionLabel}>PERMISSIONS</Text>
        <View style={s.card}>
          <PermRow
            icon="camera-alt"
            label="Camera"
            sub="Used to photograph items for resale analysis."
            status={cameraStatus}
            onPress={() => handlePermissionTap(cameraStatus, 'camera')}
          />
          <View style={s.cardDivider} />
          <PermRow
            icon="photo-library"
            label="Photo Library"
            sub="Used to upload saved item photos."
            status={photoStatus}
            onPress={() => handlePermissionTap(photoStatus, 'photo')}
          />
          <View style={s.cardDivider} />
          <PermRow
            icon="location-on"
            label="Location"
            sub="Used for Hunt Mode sessions and location tracking."
            status={locationStatus}
            onPress={() => handlePermissionTap(locationStatus, 'location')}
          />
        </View>

        {/* ══════════════ SECTION 3 — SUPPORT ══════════════════════════ */}
        <Text style={s.sectionLabel}>SUPPORT</Text>
        <View style={s.card}>
          <Row
            icon="help-outline"
            label="Help & How It Works"
            sub="Learn how FlipStart works and understand all features."
            onPress={() => router.push('/about' as any)}
          />
          <View style={s.cardDivider} />
          <Row
            icon="feedback"
            label="Send Feedback"
            sub="Contact the FlipStart team."
            onPress={handleSendFeedback}
          />
        </View>

        {/* ══════════════ SECTION 4 — ABOUT ════════════════════════════ */}
        <Text style={s.sectionLabel}>ABOUT</Text>
        <View style={s.card}>
          <Row
            icon="info-outline"
            label="About FlipStart"
            sub="Our mission and how FlipStart works."
            onPress={() => router.push('/about' as any)}
          />
          <View style={s.cardDivider} />
          <Row
            icon="star-rate"
            label="Review FlipStart"
            sub="Leave an App Store rating to help the mission."
            onPress={handleReview}
          />
          <View style={s.cardDivider} />
          <Row
            icon="privacy-tip"
            label="Privacy Policy"
            onPress={() => Linking.openURL('https://flipstartapp.com/privacy').catch(() => {})}
          />
          <View style={s.cardDivider} />
          <Row
            icon="gavel"
            label="Terms of Service"
            onPress={() => Linking.openURL('https://flipstartapp.com/terms').catch(() => {})}
          />
          <View style={s.cardDivider} />

          {/* Version — non-interactive */}
          <View style={s.row}>
            <View style={[s.iconBox, { backgroundColor: GOLD + '1A' }]}>
              <MaterialIcons name="tag" size={17} color={GOLD} />
            </View>
            <View style={s.rowBody}>
              <Text style={s.rowLabel}>Version</Text>
              <Text style={s.rowSub}>1.1.0</Text>
            </View>
          </View>
        </View>

        {/* ══════════════ SECTION 5 — ACCOUNT ACTIONS ══════════════════ */}
        <Text style={s.sectionLabel}>ACCOUNT</Text>
        <View style={s.card}>

          {/* Clear history — always shown */}
          <DangerRow
            icon="history"
            label="Clear Scan History"
            sub={flips.length > 0
              ? `${flips.length} saved flip${flips.length !== 1 ? 's' : ''}`
              : 'No history yet'}
            onPress={handleClearHistory}
          />

          {user ? (
            <>
              <View style={s.cardDivider} />

              {/* Delete Account — Apple-compliant deletion request flow */}
              <DangerRow
                icon="delete-forever"
                label="Delete Account"
                sub="Delete your FlipStart account and personal data."
                onPress={handleDeleteAccount}
              />
              <View style={s.cardDivider} />

              {/* Sign Out */}
              <Pressable
                onPress={() => Alert.alert(
                  'Sign Out',
                  'Are you sure you want to sign out?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign Out', style: 'destructive', onPress: () => signOut().catch(() => {}) },
                  ]
                )}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
              >
                <View style={[s.iconBox, { backgroundColor: '#B8545418' }]}>
                  <MaterialIcons name="logout" size={17} color="#B85450" />
                </View>
                <View style={s.rowBody}>
                  <Text style={[s.rowLabel, { color: '#B85450' }]}>Sign Out</Text>
                  <Text style={s.rowSub}>
                    {profile?.username ? `@${profile.username}` : (user.email ?? '')}
                  </Text>
                </View>
              </Pressable>
            </>
          ) : (
            <>
              <View style={s.cardDivider} />
              <Pressable
                onPress={() => router.push({ pathname: '/auth', params: { mode: 'signup', authEntryPoint: 'settings' } } as any)}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
              >
                <View style={[s.iconBox, { backgroundColor: FOREST + '18' }]}>
                  <MaterialIcons name="person-add" size={17} color={FOREST} />
                </View>
                <View style={s.rowBody}>
                  <Text style={s.rowLabel}>Create Account</Text>
                  <Text style={s.rowSub}>Save your progress across devices</Text>
                </View>
                <MaterialIcons name="chevron-right" size={17} color={MUTED} />
              </Pressable>
              <View style={s.cardDivider} />
              <Pressable
                onPress={() => router.push({ pathname: '/auth', params: { mode: 'login', authEntryPoint: 'settings' } } as any)}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
              >
                <View style={[s.iconBox, { backgroundColor: GOLD + '18' }]}>
                  <MaterialIcons name="login" size={17} color={GOLD} />
                </View>
                <View style={s.rowBody}>
                  <Text style={s.rowLabel}>Log In</Text>
                  <Text style={s.rowSub}>Access your existing account</Text>
                </View>
                <MaterialIcons name="chevron-right" size={17} color={MUTED} />
              </Pressable>
            </>
          )}
        </View>

        {/* DEV — reset onboarding */}
        {__DEV__ && (
          <>
            <Pressable
              onPress={() => resetOnboarding()
                .then(() => Alert.alert('Reset', 'Onboarding reset. Restart the app.'))
                .catch(() => {})}
              style={({ pressed }) => [s.row, { marginTop: 8 }, pressed && { opacity: 0.7 }]}
            >
              <Text style={[s.rowLabel, { color: '#B85450' }]}>Reset Onboarding (Dev)</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/dev-achievements' as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <Text style={[s.rowLabel, { color: '#8888FF' }]}>🔧 Test Achievements (Dev)</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/dev-brand-compendium' as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <Text style={[s.rowLabel, { color: '#8888FF' }]}>🔧 Test Brand Compendium (Dev)</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/dev-diamonds' as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <Text style={[s.rowLabel, { color: '#8888FF' }]}>🔧 Test Diamonds in the Rough (Dev)</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/dev-scans' as any)}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <Text style={[s.rowLabel, { color: '#8888FF' }]}>🔧 Scan Quota (Dev)</Text>
            </Pressable>
          </>
        )}

      </ScrollView>

      <ClearHistoryModal
        visible={clearImpact !== null}
        impact={clearImpact}
        onCancel={() => { finalValidRef.current = { achievements: [], brands: [], diamonds: [] }; setClearImpact(null); }}
        onConfirm={performClearHistory}
      />
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PermRow({ icon, label, sub, status, onPress }: {
  icon: string; label: string; sub: string; status: PermStatus; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
      <View style={[s.iconBox, { backgroundColor: FOREST + '18' }]}>
        <MaterialIcons name={icon as any} size={17} color={FOREST} />
      </View>
      <View style={s.rowBody}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowSub}>{sub}</Text>
      </View>
      <Text style={[s.permStatus, { color: statusColor(status) }]}>{status}</Text>
    </Pressable>
  );
}

function Row({ icon, label, sub, onPress }: {
  icon: string; label: string; sub?: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
      <View style={[s.iconBox, { backgroundColor: FOREST + '18' }]}>
        <MaterialIcons name={icon as any} size={17} color={FOREST} />
      </View>
      <View style={s.rowBody}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <MaterialIcons name="chevron-right" size={17} color={MUTED} />
    </Pressable>
  );
}

function DangerRow({ icon, label, sub, onPress }: {
  icon: string; label: string; sub?: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
      <View style={[s.iconBox, { backgroundColor: DANGER + '18' }]}>
        <MaterialIcons name={icon as any} size={17} color={DANGER} />
      </View>
      <View style={s.rowBody}>
        <Text style={[s.rowLabel, { color: DANGER }]}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <MaterialIcons name="chevron-right" size={17} color={MUTED} />
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCH },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingTop:        8,
    paddingBottom:     12,
    backgroundColor:   PARCH,
  },
  headerTitle: {
    fontFamily: FONTS.serif,
    fontSize:   20,
    fontWeight: '800',
    color:      FOREST,
  },
  headerBtn: {
    width:           34,
    height:          34,
    borderRadius:    17,
    borderWidth:     1,
    borderColor:     BORDER,
    backgroundColor: CARD,
    justifyContent:  'center',
    alignItems:      'center',
  },
  headerDivider: { height: 1, backgroundColor: BORDER },

  // ── Scroll ────────────────────────────────────────────────────────────────
  scroll: { paddingHorizontal: 16, paddingTop: 24 },

  // ── Section labels ────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize:     10,
    fontWeight:   '700',
    color:        MUTED,
    letterSpacing: 1.6,
    marginBottom: 8,
    marginTop:    20,
    marginLeft:   2,
  },

  // ── Card shell (permissions, support, about, account actions) ─────────────
  card: {
    backgroundColor: CARD,
    borderRadius:    16,
    borderWidth:     1.5,
    borderColor:     GOLD + '55',
    overflow:        'hidden',
  },

  // ── Account card (hero, slightly elevated appearance) ─────────────────────
  accountCard: {
    backgroundColor: CARD,
    borderRadius:    18,
    borderWidth:     1.5,
    borderColor:     GOLD + '75',
    overflow:        'hidden',
    // Top margin absorbed by paddingTop on scroll
  },

  // ── Card divider ──────────────────────────────────────────────────────────
  cardDivider: { height: 1, backgroundColor: BORDER + '60', marginHorizontal: 14 },

  // ── Account card internals ────────────────────────────────────────────────
  acTop: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  acAvatarRing: {
    width:           56,
    height:          56,
    borderRadius:    28,
    backgroundColor: TAN,
    borderWidth:     2,
    borderColor:     GOLD,
    justifyContent:  'center',
    alignItems:      'center',
    overflow:        'hidden',
  },
  acAvatarImg: { width: 56, height: 56, borderRadius: 28 },
  acMeta:      { flex: 1, gap: 2 },
  acName: {
    fontFamily: FONTS.serif,
    fontSize:   17,
    fontWeight: '800',
    color:      BROWN,
  },
  acUsername:  { fontSize: 13, color: MUTED },
  acPlan:      { fontSize: 11, fontStyle: 'italic', color: MUTED },

  viewProfileBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             6,
    paddingVertical: 13,
  },
  viewProfileText: {
    fontFamily: FONTS.serif,
    fontSize:   13,
    fontWeight: '700',
    color:      FOREST,
  },

  // ── Standard row ─────────────────────────────────────────────────────────
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconBox: {
    width:          36,
    height:         36,
    borderRadius:   10,
    justifyContent: 'center',
    alignItems:     'center',
  },
  rowBody:    { flex: 1 },
  rowLabel:   { fontSize: 14, fontWeight: '700', color: BROWN, fontFamily: FONTS.serif },
  rowSub:     { fontSize: 11, color: MUTED, marginTop: 2, lineHeight: 15 },
  permStatus: { fontSize: 11, fontWeight: '700' },
});
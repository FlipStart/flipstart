/**
 * app/(tabs)/profile.tsx — Profile Screen
 *
 * Layout: fixed, no ScrollView.
 *   header → divider → identity section → flex spacer → podium stat cards
 *
 * Avatar editing and profile editing moved to /edit-profile.
 * Camera badge is hidden here — only shown inside Edit Profile.
 */

import { View, Text, StyleSheet, Pressable, Image, Alert, Modal } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useCallback } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { FONTS } from '@/constants/typography';
import { useAuth } from '@/lib/auth-context';
import { useFlipStore } from '@/lib/useFlipStore';
import { loadXpProfile, getCurrentRank, RANK_LADDER } from '@/lib/huntXp';
import { isHuntBundle } from '@/types/flip';
import type { FlipResult } from '@/types/flip';

// ─── Palette ─────────────────────────────────────────────────────────────────
const FOREST      = '#2A4A2A';
const GOLD        = '#BE9C2C';
const PARCH       = '#ECE7D3';
const CARD        = '#F2EDD8';
const BORDER      = '#C8B88A';
const TAN         = '#D6C8A3';
const BROWN       = '#3D2A12';
const MUTED       = '#8A7050';
const AVATAR_BLUE = '#8AABBF';

const avatarKey = (uid: string) => `@flipstart/avatar:${uid}`;

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const { flips } = useFlipStore();

  const [xp,               setXp]               = useState(0);
  const [avatarUri,        setAvatarUri]        = useState<string | null>(null);
  const [showAvatarPreview, setShowAvatarPreview] = useState(false);

  useFocusEffect(useCallback(() => {
    const uid = user?.id ?? null;
    if (uid) {
      loadXpProfile(uid).then(p => setXp(p.totalXp)).catch(() => {});
      AsyncStorage.getItem(avatarKey(uid)).then(uri => {
        setAvatarUri(uri ?? null);
      }).catch(() => {});
    } else {
      setXp(0);
      setAvatarUri(null);
    }
  }, [user?.id]));

  // ── Edit Profile — guest gate ──────────────────────────────────────────────
  const handleEditProfile = useCallback(() => {
    if (!user?.id) {
      Alert.alert(
        'Create an account to edit your profile',
        'Profile editing is available for FlipStart accounts. Create an account to save your name, username, photo, scans, XP, and progress across devices.',
        [
          { text: 'Create Account', onPress: () => router.push({ pathname: '/auth', params: { mode: 'signup' } } as any) },
          { text: 'Log In',         onPress: () => router.push({ pathname: '/auth', params: { mode: 'login'  } } as any) },
          { text: 'Not Now', style: 'cancel' },
        ]
      );
      return;
    }
    router.push('/edit-profile' as any);
  }, [user?.id, router]);

  // ── Scan stats ────────────────────────────────────────────────────────────
  const scanFlips   = flips.filter((f): f is FlipResult => !isHuntBundle(f));
  const totalScans  = scanFlips.length;
  const totalCost   = scanFlips.reduce((s, f) => s + Math.max(0, f.thriftPrice ?? 0), 0);
  const totalProfit = scanFlips.reduce((s, f) => s + Math.max(0, f.profit   ?? 0), 0);
  const lifetimeROI = totalCost > 0 ? Math.round((totalProfit / totalCost) * 100) : null;

  // ── Identity ──────────────────────────────────────────────────────────────
  const displayName  = profile?.display_name || profile?.username || 'FlipStart Member';
  const usernameText = profile?.username ? `@${profile.username}` : null;

  // ── Rank ──────────────────────────────────────────────────────────────────
  const currentRank = getCurrentRank(xp);
  const levelNum    = RANK_LADDER.findIndex(r => r.rank === currentRank.rank) + 1;
  const rankLabel   = `${currentRank.rank} \u00B7 Lv. ${levelNum}`;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.gearBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={FOREST} />
        </Pressable>
        <Text style={s.headerTitle}>Profile</Text>
        <Pressable
          onPress={() => router.push('/(tabs)/settings' as any)}
          hitSlop={8}
          style={({ pressed }) => [s.gearBtn, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="settings" size={19} color={FOREST} />
        </Pressable>
      </View>
      <View style={s.divider} />

      {/* ── Identity ───────────────────────────────────────────────────────── */}
      <View style={s.identity}>

        {/* Avatar — long-press to preview full size; tap the camera badge (shown
            when no picture is set) to jump straight to Edit Profile. */}
        <Pressable
          onPress={avatarUri ? undefined : handleEditProfile}
          onLongPress={avatarUri ? () => setShowAvatarPreview(true) : undefined}
          delayLongPress={350}
          style={s.avatarWrap}
        >
          <View style={s.avatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={s.avatarImage} />
            ) : (
              <MaterialIcons name="person" size={58} color={AVATAR_BLUE} />
            )}
          </View>
          {!avatarUri && (
            <View style={s.cameraBadge}>
              <MaterialIcons name="photo-camera" size={16} color={PARCH} />
            </View>
          )}
        </Pressable>

        <Text style={s.displayName}>{displayName}</Text>
        {usernameText ? <Text style={s.username}>{usernameText}</Text> : null}
        <Text style={s.planStatus}>FlipStart Free Member</Text>

        <View style={s.rankPill}>
          <Text style={s.rankEmoji}>{'\uD83E\uDD8C'}</Text>
          <Text style={s.rankText}>{rankLabel}</Text>
        </View>

        <Pressable
          onPress={handleEditProfile}
          style={({ pressed }) => [s.editBtn, pressed && { opacity: 0.65 }]}
        >
          <Text style={s.editBtnText}>Edit Profile</Text>
        </Pressable>

      </View>

      <View style={{ flex: 1 }} />

      {/* ── Podium stat cards ───────────────────────────────────────────────── */}
      <View style={[s.podium, { paddingBottom: Math.max(insets.bottom, 8) + 10 }]}>

        <View style={[s.card, s.cardSide]}>
          <View style={s.cardIconBox}>
            <MaterialIcons name="photo-camera" size={22} color={FOREST} />
          </View>
          <Text style={s.cardVal}>{totalScans > 0 ? totalScans : '\u2014'}</Text>
          <Text style={s.cardLbl}>{'Lifetime\nScans'}</Text>
        </View>

        <View style={[s.card, s.cardCenter]}>
          <View style={[s.cardIconBox, s.cardIconBoxHero]}>
            <MaterialIcons name="trending-up" size={28} color={FOREST} />
          </View>
          <Text style={[s.cardVal, s.cardValHero]}>
            {totalProfit > 0 ? `+$${Math.round(totalProfit)}` : '\u2014'}
          </Text>
          <Text style={s.cardLbl}>{'Est. Lifetime\nProfit'}</Text>
        </View>

        <View style={[s.card, s.cardSide]}>
          <View style={s.cardIconBox}>
            <MaterialIcons name="local-atm" size={22} color={FOREST} />
          </View>
          <Text style={s.cardVal}>
            {lifetimeROI !== null ? `${lifetimeROI}%` : '\u2014'}
          </Text>
          <Text style={s.cardLbl}>{'Lifetime\nROI'}</Text>
        </View>

      </View>

      {/* ── Avatar full-size preview (long-press) ───────────────────────── */}
      <Modal
        visible={showAvatarPreview}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAvatarPreview(false)}
      >
        <Pressable style={s.previewBackdrop} onPress={() => setShowAvatarPreview(false)}>
          <View style={s.previewCircle}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={s.previewImage} />
            ) : (
              <MaterialIcons name="person" size={160} color={AVATAR_BLUE} />
            )}
          </View>
        </Pressable>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCH },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, backgroundColor: PARCH,
  },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 20, fontWeight: '800', color: FOREST },
  divider: { height: 1, backgroundColor: BORDER },
  gearBtn: {
    width:           34,
    height:          34,
    borderRadius:    17,
    borderWidth:     1,
    borderColor:     BORDER,
    backgroundColor: CARD,
    justifyContent:  'center',
    alignItems:      'center',
  },

  identity: { alignItems: 'center', paddingTop: 24, paddingHorizontal: 24 },

  avatarWrap: { marginBottom: 14, position: 'relative' },
  avatar: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: TAN, borderWidth: 2.5, borderColor: GOLD,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  avatarImage: { width: 100, height: 100, borderRadius: 50 },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: FOREST, borderWidth: 2.5, borderColor: PARCH,
    justifyContent: 'center', alignItems: 'center',
  },

  displayName: { fontFamily: FONTS.serif, fontSize: 24, fontWeight: '800', color: BROWN, marginBottom: 3 },
  username:    { fontFamily: FONTS.serifReg, fontSize: 14, color: MUTED, marginBottom: 2 },
  planStatus:  { fontSize: 13, fontStyle: 'italic', color: MUTED, marginBottom: 10 },

  rankPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: BORDER, borderRadius: 20,
    paddingVertical: 6, paddingHorizontal: 16,
    backgroundColor: CARD, marginBottom: 10,
  },
  rankEmoji: { fontSize: 14 },
  rankText:  { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700', color: FOREST },

  editBtn: {
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 22,
    paddingVertical: 10, paddingHorizontal: 40, backgroundColor: CARD,
  },
  editBtnText: { fontFamily: FONTS.serif, fontSize: 14, fontWeight: '700', color: BROWN, letterSpacing: 0.2 },

  podium: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, gap: 8 },

  card: {
    flex: 1, backgroundColor: CARD, borderRadius: 18, borderWidth: 1.5, borderColor: GOLD + '70',
    alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingTop: 18, paddingBottom: 16,
  },
  cardSide:   { height: 192 },
  cardCenter: { height: 252 },

  cardIconBox: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: GOLD + '1C', justifyContent: 'center', alignItems: 'center',
  },
  cardIconBoxHero: { width: 54, height: 54, borderRadius: 14 },

  cardVal:     { fontFamily: FONTS.serif, fontSize: 26, fontWeight: '900', color: FOREST, textAlign: 'center' },
  cardValHero: { fontSize: 30 },
  cardLbl:     { fontSize: 11, fontWeight: '600', color: MUTED, textAlign: 'center', lineHeight: 15 },

  // ── Avatar long-press preview ─────────────────────────────────────────────
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCircle: {
    width:           260,
    height:          260,
    borderRadius:    130,
    backgroundColor: TAN,
    borderWidth:     3,
    borderColor:     GOLD,
    justifyContent:  'center',
    alignItems:      'center',
    overflow:        'hidden',
  },
  previewImage: { width: 260, height: 260, borderRadius: 130 },
});
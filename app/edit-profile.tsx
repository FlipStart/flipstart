/**
 * app/edit-profile.tsx — Edit Profile modal screen
 *
 * Allows logged-in users to update:
 *   1. Display name   — free edit, 1–40 chars, saved to profiles.display_name
 *   2. Avatar/photo   — local AsyncStorage (@flipstart/avatar:{uid})
 *   3. Username       — one-time lifetime change; locked after first change
 *                       enforced via profiles.username_changed_once
 *
 * Guest users never reach this screen — profile.tsx shows an Alert gate first.
 *
 * SQL required before first build (run in Supabase Dashboard → SQL Editor):
 *   ALTER TABLE public.profiles
 *     ADD COLUMN IF NOT EXISTS username_changed_once boolean DEFAULT false;
 *
 * No new dependencies. Uses expo-image-picker (already installed),
 * AsyncStorage (already installed), and the existing supabase client.
 * Does NOT touch auth, sync, startup imports, app.config.ts, or package.json.
 */

import {
  View, Text, StyleSheet, Pressable, TextInput,
  ScrollView, Alert, ActivityIndicator, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useRef, useCallback } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

import { FONTS } from '@/constants/typography';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';   // safe — edit-profile is not startup-loaded
import { uploadImageToStorage, deleteUploadedImage, isRemoteUri } from '@/lib/imageUpload';

// ─── Palette — matches profile.tsx exactly ───────────────────────────────────
const FOREST      = '#2A4A2A';
const GOLD        = '#BE9C2C';
const PARCH       = '#ECE7D3';
const CARD        = '#F2EDD8';
const BORDER      = '#C8B88A';
const TAN         = '#D6C8A3';
const BROWN       = '#3D2A12';
const MUTED       = '#8A7050';
const AVATAR_BLUE = '#8AABBF';
const ERROR_BG    = '#F8D7DA';
const ERROR_TEXT  = '#721C24';
const OK_GREEN    = '#2A7A3A';

// ─── Username validation — same regex as username-setup.tsx ──────────────────
const USERNAME_RE = /^(?!.*[._-]{2})[A-Za-z0-9][A-Za-z0-9._-]{1,22}[A-Za-z0-9]$|^[A-Za-z0-9]{3,4}$/;
type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'unchanged';

const avatarKey = (uid: string) => `@flipstart/avatar:${uid}`;

export default function EditProfileScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();

  // ── Editable state — initialised from current profile ────────────────────
  const [displayName,   setDisplayName]   = useState(profile?.display_name || profile?.username || '');
  const [username,      setUsername]      = useState(profile?.username || '');
  const [avatarUri,     setAvatarUri]     = useState<string | null>(null);
  const [avatarChanged, setAvatarChanged] = useState(false);

  // ── Save / error state ────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // ── Username availability ─────────────────────────────────────────────────
  const [availability, setAvailability] = useState<Availability>('unchanged');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Derived values ────────────────────────────────────────────────────────
  const usernameLocked     = profile?.username_changed_once === true;
  const originalUsername   = profile?.username || '';
  const originalDispName   = profile?.display_name || profile?.username || '';

  const displayNameChanged = displayName.trim() !== originalDispName;
  const usernameChanged    = username.trim().toLowerCase() !== originalUsername.toLowerCase();
  const hasChanges         = displayNameChanged || (!usernameLocked && usernameChanged) || avatarChanged;

  // ── Load avatar — prefer the Supabase-backed URL (survives logout/login
  //     and reinstalls); fall back to the local cache if none exists yet ──
  useEffect(() => {
    if (!user?.id) return;
    if (profile?.avatar_url) {
      setAvatarUri(profile.avatar_url);
      return;
    }
    AsyncStorage.getItem(avatarKey(user.id))
      .then(uri => setAvatarUri(uri ?? null))
      .catch(() => {});
  }, [user?.id, profile?.avatar_url]);

  // ── Username availability debounce ────────────────────────────────────────
  useEffect(() => {
    if (usernameLocked || !usernameChanged) {
      setAvailability('unchanged');
      return;
    }
    const trimmed = username.trim().toLowerCase();
    if (!trimmed) { setAvailability('idle'); return; }
    if (!USERNAME_RE.test(trimmed)) { setAvailability('invalid'); return; }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAvailability('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        // Primary: security-definer RPC (case-insensitive, bypasses RLS)
        const { data, error: rpcErr } = await supabase.rpc('check_username_available', { uname: trimmed });
        if (!rpcErr) { setAvailability(data === true ? 'available' : 'taken'); return; }
        // Fallback: direct query
        const { data: row } = await supabase
          .from('profiles').select('username').ilike('username', trimmed).maybeSingle();
        setAvailability(row ? 'taken' : 'available');
      } catch { setAvailability('idle'); }
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username, usernameChanged, usernameLocked]);

  // ── Avatar helpers ────────────────────────────────────────────────────────
  const pickFromLibrary = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to set a profile picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes:    ['images'] as ImagePicker.MediaType[],
        allowsEditing: true, aspect: [1, 1], quality: 0.75,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        setAvatarUri(result.assets[0].uri);
        setAvatarChanged(true);
      }
    } catch { /* never crash */ }
  }, []);

  const takePhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to take a profile photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true, aspect: [1, 1], quality: 0.75,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        setAvatarUri(result.assets[0].uri);
        setAvatarChanged(true);
      }
    } catch { /* never crash */ }
  }, []);

  const handleAvatarPress = useCallback(() => {
    const hasPhoto = !!avatarUri;
    const options = hasPhoto
      ? ['Choose from Library', 'Take Photo', 'Remove Photo', 'Cancel']
      : ['Choose from Library', 'Take Photo', 'Cancel'];
    const destructiveIndex = hasPhoto ? 2 : -1;
    const cancelIndex      = hasPhoto ? 3 : 2;

    const { ActionSheetIOS } = require('react-native');
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: destructiveIndex },
        (idx: number) => {
          if      (idx === 0) pickFromLibrary();
          else if (idx === 1) takePhoto();
          else if (hasPhoto && idx === 2) { setAvatarUri(null); setAvatarChanged(true); }
        }
      );
    } else {
      const buttons: any[] = [
        { text: 'Choose from Library', onPress: pickFromLibrary },
        { text: 'Take Photo',          onPress: takePhoto },
      ];
      if (hasPhoto) buttons.push({
        text: 'Remove Photo', style: 'destructive',
        onPress: () => { setAvatarUri(null); setAvatarChanged(true); },
      });
      buttons.push({ text: 'Cancel', style: 'cancel' });
      Alert.alert('Profile Photo', 'Choose an option', buttons);
    }
  }, [avatarUri, pickFromLibrary, takePhoto]);

  // ── Core save logic ───────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    const trimmedName     = displayName.trim();
    const trimmedUsername = username.trim().toLowerCase();

    // Validate display name
    if (!trimmedName) { setError('Display name cannot be empty.'); return; }
    if (trimmedName.length > 40) { setError('Display name must be 40 characters or less.'); return; }

    // Validate username (only if changing)
    if (usernameChanged && !usernameLocked) {
      if (!USERNAME_RE.test(trimmedUsername)) {
        setError('Username: 3–24 characters, letters/numbers/ _ . - — must start and end with a letter or number, no consecutive special characters.');
        return;
      }
      if (availability === 'taken')    { setError(`"@${trimmedUsername}" is already taken. Choose another.`); return; }
      if (availability === 'checking') { setError('Still checking username availability — please wait a moment.'); return; }
      if (availability === 'invalid')  { setError('Username format is invalid.'); return; }
    }

    if (!user?.id) { setError('Session expired. Please log in again.'); return; }

    setSaving(true);
    setError(null);

    try {
      // ── 1. Avatar — upload to Supabase Storage ('avatars' bucket) so it
      //     survives logout/login and reinstalls. AsyncStorage keeps a local
      //     cache for instant display. undefined = no avatar change to save. ──
      let newAvatarUrl: string | null | undefined;
      if (avatarChanged) {
        if (avatarUri && !isRemoteUri(avatarUri)) {
          // New local photo picked/taken — upload it.
          const cloudUrl = await uploadImageToStorage(avatarUri, 'avatars', user.id);
          if (cloudUrl) {
            await AsyncStorage.setItem(avatarKey(user.id), cloudUrl);
            newAvatarUrl = cloudUrl;
            // Best-effort cleanup of the previous uploaded file.
            if (isRemoteUri(profile?.avatar_url)) {
              deleteUploadedImage(profile!.avatar_url as string, 'avatars').catch(() => {});
            }
          } else {
            // Upload failed — keep it working on THIS device via the local
            // cache; cross-device just waits for a future successful save.
            await AsyncStorage.setItem(avatarKey(user.id), avatarUri);
          }
        } else if (avatarUri) {
          // Already a hosted URL (defensive — picker always returns local).
          await AsyncStorage.setItem(avatarKey(user.id), avatarUri);
          newAvatarUrl = avatarUri;
        } else {
          // Removed — clear the local cache and the remote record + file.
          await AsyncStorage.removeItem(avatarKey(user.id));
          newAvatarUrl = null;
          if (isRemoteUri(profile?.avatar_url)) {
            deleteUploadedImage(profile!.avatar_url as string, 'avatars').catch(() => {});
          }
        }
      }

      // ── 2. Supabase profile update ────────────────────────────────────────
      const updates: Record<string, unknown> = {};
      if (displayNameChanged)              updates.display_name         = trimmedName;
      if (usernameChanged && !usernameLocked) {
        updates.username              = trimmedUsername;
        updates.username_changed_once = true;
      }
      if (newAvatarUrl !== undefined)      updates.avatar_url            = newAvatarUrl;

      if (Object.keys(updates).length > 0) {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', user.id);

        if (updateErr) {
          setSaving(false);
          if (updateErr.code === '23505') {
            setError('That username is already taken. Please choose another.');
          } else {
            setError('Could not save changes. Please try again.');
          }
          return;
        }
      }

      // ── 3. Refresh profile context so Profile/Home screens update ─────────
      await refreshProfile().catch(() => {});

      setSaving(false);
      Alert.alert('Profile updated', 'Your changes have been saved.', [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch {
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }, [
    displayName, username, avatarUri, avatarChanged,
    displayNameChanged, usernameChanged, usernameLocked,
    availability, user?.id, refreshProfile, router,
  ]);

  // ── Save with username confirmation gate ──────────────────────────────────
  const handleSave = useCallback(() => {
    if (usernameChanged && !usernameLocked) {
      Alert.alert(
        'Change username?',
        "You can only change your username once. After this, you won't be able to change it again.",
        [
          { text: 'Keep Current', style: 'cancel' },
          { text: 'Change Username', onPress: doSave },
        ]
      );
    } else {
      doSave();
    }
  }, [usernameChanged, usernameLocked, doSave]);

  // ── Cancel with unsaved-changes guard ────────────────────────────────────
  const handleCancel = useCallback(() => {
    if (hasChanges) {
      Alert.alert(
        'Discard changes?',
        'Your unsaved changes will be lost.',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  }, [hasChanges, router]);

  const usernameOk = !usernameChanged || usernameLocked || availability === 'available';
  const canSave    = hasChanges && usernameOk && !saving;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={[s.root, { paddingTop: insets.top }]}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <Pressable onPress={handleCancel} hitSlop={10} style={s.headerSideBtn}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>

          <Text style={s.headerTitle}>Edit Profile</Text>

          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            hitSlop={10}
            style={[s.headerSideBtn, { alignItems: 'flex-end' }, !canSave && { opacity: 0.35 }]}
          >
            {saving
              ? <ActivityIndicator size="small" color={FOREST} />
              : <Text style={s.saveText}>Save</Text>
            }
          </Pressable>
        </View>
        <View style={s.divider} />

        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* Error banner */}
          {error ? (
            <View style={s.errorBox}>
              <MaterialIcons name="error-outline" size={14} color={ERROR_TEXT} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ── Avatar ───────────────────────────────────────────────────── */}
          <View style={s.avatarSection}>
            <Pressable
              onPress={handleAvatarPress}
              style={({ pressed }) => [s.avatarWrap, pressed && { opacity: 0.82 }]}
            >
              <View style={s.avatar}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={s.avatarImage} />
                ) : (
                  <MaterialIcons name="person" size={58} color={AVATAR_BLUE} />
                )}
              </View>
              <View style={s.cameraBadge}>
                <MaterialIcons name="photo-camera" size={12} color={FOREST} />
              </View>
            </Pressable>
            <Text style={s.changePhotoHint}>Tap to change photo</Text>
          </View>

          {/* ── Display Name ─────────────────────────────────────────────── */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Display Name</Text>
            <TextInput
              style={s.input}
              value={displayName}
              onChangeText={v => { setDisplayName(v); setError(null); }}
              placeholder="Your name"
              placeholderTextColor={MUTED}
              maxLength={40}
              autoCorrect={false}
              editable={!saving}
              returnKeyType="done"
            />
            <Text style={s.fieldHint}>Shown on your profile. Any capitalization and spaces allowed.</Text>
          </View>

          {/* ── Username ─────────────────────────────────────────────────── */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Username</Text>

            {usernameLocked ? (
              /* Locked state */
              <View style={s.lockedGroup}>
                <View style={s.lockedRow}>
                  <MaterialIcons name="lock" size={15} color={MUTED} />
                  <Text style={s.lockedValue}>@{originalUsername}</Text>
                </View>
                <View style={s.lockedBadge}>
                  <MaterialIcons name="lock" size={11} color={MUTED} />
                  <Text style={s.lockedBadgeText}>Username change used</Text>
                </View>
                <Text style={s.fieldHint}>You've already used your one lifetime username change.</Text>
              </View>
            ) : (
              /* Editable state */
              <View style={s.usernameGroup}>
                <View style={s.usernameRow}>
                  <Text style={s.atSymbol}>@</Text>
                  <TextInput
                    style={[s.input, s.usernameInput]}
                    value={username}
                    onChangeText={v => {
                      // Strip any character not allowed, including @
                      setUsername(v.replace(/[^A-Za-z0-9._-]/g, ''));
                      setError(null);
                    }}
                    placeholder="username"
                    placeholderTextColor={MUTED}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={24}
                    editable={!saving}
                    returnKeyType="done"
                  />
                  {availability === 'checking'  && <ActivityIndicator size="small" color={MUTED}    style={s.availIcon} />}
                  {availability === 'available' && <MaterialIcons name="check-circle" size={18} color={OK_GREEN}  style={s.availIcon} />}
                  {availability === 'taken'     && <MaterialIcons name="cancel"       size={18} color="#B85450"   style={s.availIcon} />}
                </View>

                {availability === 'available' && <Text style={[s.availText, { color: OK_GREEN  }]}>Available</Text>}
                {availability === 'taken'     && <Text style={[s.availText, { color: '#B85450' }]}>Already taken</Text>}
                {availability === 'invalid'   && <Text style={[s.availText, { color: '#B85450' }]}>Invalid format</Text>}

                {/* One-time warning — only shown when something is typed */}
                {usernameChanged && (
                  <View style={s.warningBox}>
                    <MaterialIcons name="info-outline" size={13} color={BROWN} />
                    <Text style={s.warningText}>
                      You can only change your username once. Choose carefully.
                    </Text>
                  </View>
                )}

                <Text style={s.fieldHint}>
                  3–24 characters · letters, numbers, _ . -{'\n'}
                  Must start and end with a letter or number.
                </Text>
              </View>
            )}
          </View>

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: PARCH },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  headerTitle: { fontFamily: FONTS.serif, fontSize: 17, fontWeight: '800', color: FOREST },
  headerSideBtn: { minWidth: 64, justifyContent: 'center' },
  cancelText: { fontSize: 15, color: MUTED, fontWeight: '500' },
  saveText:   { fontFamily: FONTS.serif, fontSize: 15, fontWeight: '800', color: FOREST },
  divider:    { height: 1, backgroundColor: BORDER },

  // ── Scroll content ───────────────────────────────────────────────────────
  scroll: { paddingHorizontal: 20, paddingTop: 28, gap: 26 },

  // ── Error ────────────────────────────────────────────────────────────────
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: ERROR_BG, borderRadius: 10, padding: 12,
  },
  errorText: { fontSize: 13, color: ERROR_TEXT, flex: 1, lineHeight: 18 },

  // ── Avatar ───────────────────────────────────────────────────────────────
  avatarSection:  { alignItems: 'center', gap: 8 },
  avatarWrap:     { position: 'relative' },
  avatar: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: TAN, borderWidth: 2.5, borderColor: GOLD,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  avatarImage:  { width: 96, height: 96, borderRadius: 48 },
  cameraBadge: {
    position: 'absolute', bottom: 2, right: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: CARD, borderWidth: 1.5, borderColor: BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  changePhotoHint: { fontFamily: FONTS.serif, fontSize: 13, fontWeight: '700', color: FOREST },

  // ── Field group ──────────────────────────────────────────────────────────
  fieldGroup: { gap: 7 },
  fieldLabel: {
    fontFamily: FONTS.serif, fontSize: 10, fontWeight: '800',
    color: MUTED, letterSpacing: 1.8, textTransform: 'uppercase',
  },
  input: {
    backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
    paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 16, color: BROWN,
  },
  fieldHint: { fontSize: 11, color: MUTED, lineHeight: 16 },

  // ── Username (editable) ──────────────────────────────────────────────────
  usernameGroup: { gap: 6 },
  usernameRow:   { flexDirection: 'row', alignItems: 'center' },
  atSymbol: {
    fontFamily: FONTS.serif, fontSize: 16, fontWeight: '700',
    color: MUTED, marginRight: 6,
  },
  usernameInput: { flex: 1 },
  availIcon:     { marginLeft: 8 },
  availText:     { fontSize: 12, fontWeight: '600', marginLeft: 2 },
  warningBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: GOLD + '20', borderRadius: 8,
    paddingVertical: 9, paddingHorizontal: 11,
  },
  warningText: { fontSize: 12, color: BROWN, flex: 1, lineHeight: 17 },

  // ── Username (locked) ────────────────────────────────────────────────────
  lockedGroup: { gap: 7 },
  lockedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
    paddingHorizontal: 16, paddingVertical: 13, opacity: 0.6,
  },
  lockedValue:     { fontSize: 16, color: BROWN },
  lockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', backgroundColor: BORDER + '55',
    borderRadius: 6, paddingVertical: 4, paddingHorizontal: 9,
  },
  lockedBadgeText: { fontSize: 11, color: MUTED, fontWeight: '600' },
});
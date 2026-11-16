/**
 * components/results/PhotoViewerModal.tsx
 *
 * Full-screen viewer for a scan's photos, on the results screen, Scan Record
 * and Deep Analysis.
 *
 *   - opens on the main (front) photo
 *   - swipe left/right between the photos (front, tag, detail)
 *   - arrows on the left and right edges do the same, shown only when there is
 *     a photo that way
 *   - a label and counter at the bottom ("Tag · 2 of 3")
 *   - top right: a download button (saves the photo on screen to Photos) and,
 *     to its right, the X. Both forest green with gold, the app's colours.
 *   - close with the X, by tapping the dark area, or the Android back button
 *
 * One photo behaves exactly like the old viewer, minus the arrows and counter.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions, ActivityIndicator, Alert, Linking,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { savePhotoToLibrary } from '@/lib/savePhoto';
import type { ViewerPhoto } from '@/lib/viewerPhotos';

const CREAM  = '#F4EED8';
const FOREST = '#2A4A2A';
const GOLD   = '#BE9C2C';

export type { ViewerPhoto };

export function PhotoViewerModal({
  photos, visible, onClose,
}: { photos: ViewerPhoto[]; visible: boolean; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const count = photos.length;
  const many = count > 1;

  // Every open starts on the first photo.
  useEffect(() => { if (visible) { setIndex(0); setSaveState('idle'); } }, [visible]);
  // A new photo on screen gets a fresh download button.
  useEffect(() => { setSaveState('idle'); }, [index]);

  const onDownload = async () => {
    const photo = photos[Math.min(index, count - 1)];
    if (!photo || saveState === 'saving') return;
    setSaveState('saving');
    const r = await savePhotoToLibrary(photo.uri);
    if (r === 'saved') {
      setSaveState('saved');
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1800);
      return;
    }
    setSaveState('idle');
    if (r === 'denied') {
      Alert.alert(
        'Allow Photos access',
        'FlipStart needs permission to add photos to your library. You can turn it on in Settings.',
        [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }],
      );
    } else if (r === 'unavailable') {
      Alert.alert('Update FlipStart to save photos', 'Saving photos needs the latest version of the app.');
    } else {
      Alert.alert('Couldn\'t save photo', 'Check your connection and try again.');
    }
  };

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(count - 1, i));
    setIndex(next);
    scroller.current?.scrollTo({ x: next * width, animated: true });
  };

  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== index && i >= 0 && i < count) setIndex(i);
  };

  if (count === 0) return null;
  const current = photos[Math.min(index, count - 1)];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <ScrollView
          // Remounted on each open so it always starts at the first photo.
          key={visible ? 'open' : 'closed'}
          ref={scroller}
          horizontal
          pagingEnabled
          scrollEnabled={many}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onSettled}
          style={StyleSheet.absoluteFill}
        >
          {photos.map((p, i) => (
            <Pressable
              key={`${p.uri}-${i}`}
              onPress={onClose}
              style={[st.page, { width, height }]}
              accessibilityLabel="Close photo"
            >
              {/* Tapping the photo itself does nothing, so a swipe that ends as
                  a tap never closes the viewer by accident. */}
              <Pressable onPress={() => {}} style={st.imageWrap}>
                <Image
                  source={{ uri: p.uri }}
                  style={st.image}
                  contentFit="contain"
                  transition={200}
                  accessibilityLabel={p.label ? `${p.label} photo` : 'Photo'}
                />
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>

        <View style={[st.topBar, { top: Math.max(insets.top, 20) + 8 }]}>
          <Pressable
            style={({ pressed }) => [st.topBtn, pressed && st.topBtnPressed]}
            onPress={onDownload}
            disabled={saveState === 'saving'}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={saveState === 'saved' ? 'Saved to Photos' : 'Save photo to Photos'}
          >
            {saveState === 'saving'
              ? <ActivityIndicator size="small" color={GOLD} />
              : <MaterialIcons name={saveState === 'saved' ? 'check' : 'file-download'} size={22} color={GOLD} />}
          </Pressable>
          <Pressable
            style={({ pressed }) => [st.topBtn, pressed && st.topBtnPressed]}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <MaterialIcons name="close" size={22} color={GOLD} />
          </Pressable>
        </View>
        {saveState === 'saved' && (
          <View style={[st.toast, { top: Math.max(insets.top, 20) + 60 }]} pointerEvents="none">
            <Text style={st.toastText}>Saved to Photos</Text>
          </View>
        )}

        {many && index > 0 && (
          <Pressable
            style={[st.arrow, st.arrowLeft]}
            onPress={() => goTo(index - 1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Previous photo"
          >
            <MaterialIcons name="chevron-left" size={30} color={CREAM} />
          </Pressable>
        )}
        {many && index < count - 1 && (
          <Pressable
            style={[st.arrow, st.arrowRight]}
            onPress={() => goTo(index + 1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Next photo"
          >
            <MaterialIcons name="chevron-right" size={30} color={CREAM} />
          </Pressable>
        )}

        {many && (
          <View style={st.footer} pointerEvents="none">
            <Text style={st.caption}>
              {current.label ? `${current.label} · ` : ''}{index + 1} of {count}
            </Text>
            <View style={st.dots}>
              {photos.map((_, i) => <View key={i} style={[st.dot, i === index && st.dotOn]} />)}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  page: { justifyContent: 'center', alignItems: 'center' },
  imageWrap: { width: '90%', height: '75%' },
  image: { width: '100%', height: '100%' },
  topBar: { position: 'absolute', right: 16, flexDirection: 'row', gap: 10 },
  topBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: FOREST, borderWidth: 1.5, borderColor: GOLD,
    justifyContent: 'center', alignItems: 'center',
  },
  topBtnPressed: { opacity: 0.7 },
  toast: {
    position: 'absolute', right: 16,
    backgroundColor: FOREST, borderWidth: 1, borderColor: GOLD, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  toastText: { color: CREAM, fontSize: 12.5, fontWeight: '700' },
  arrow: {
    position: 'absolute', top: '50%', marginTop: -22,
    width: 44, height: 44, borderRadius: 22,
    // Dark, so the arrow stays visible over a white or light-coloured photo.
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1, borderColor: 'rgba(244,238,216,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  arrowLeft: { left: 10 },
  arrowRight: { right: 10 },
  footer: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
  caption: { color: CREAM, fontSize: 13, fontWeight: '600', letterSpacing: 0.3, marginBottom: 8 },
  dots: { flexDirection: 'row' },
  dot: { width: 6, height: 6, borderRadius: 3, marginHorizontal: 3, backgroundColor: 'rgba(244,238,216,0.35)' },
  dotOn: { backgroundColor: CREAM },
});
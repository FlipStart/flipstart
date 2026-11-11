/**
 * components/results/PhotoViewerModal.tsx
 *
 * Full-screen viewer for the photos taken for a scan, on the results screen.
 *
 *   - opens on the main (front) photo
 *   - swipe left/right between the photos (front, tag, detail)
 *   - arrows on the left and right edges do the same, shown only when there is
 *     a photo that way
 *   - a label and counter at the bottom ("Tag · 2 of 3")
 *   - close with the X, by tapping the dark area, or the Android back button
 *
 * One photo behaves exactly like the old viewer, minus the arrows and counter.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const CREAM = '#F4EED8';

export interface ViewerPhoto {
  uri: string;
  label?: string;
}

export function PhotoViewerModal({
  photos, visible, onClose,
}: { photos: ViewerPhoto[]; visible: boolean; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length;
  const many = count > 1;

  // Every open starts on the first photo.
  useEffect(() => { if (visible) setIndex(0); }, [visible]);

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

        <Pressable style={st.closeBtn} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <MaterialIcons name="close" size={22} color={CREAM} />
        </Pressable>

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
  closeBtn: {
    position: 'absolute', top: 52, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
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
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/screen-container';
import { V } from '@/constants/vintage';
import { resetOnboarding } from '@/lib/onboarding-storage';

export default function ProfileScreen() {
  const router = useRouter();

  const handleResetOnboarding = async () => {
    await resetOnboarding();
    Alert.alert(
      'Onboarding Reset',
      'Close and reopen the app to see the onboarding screen.',
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <Text style={styles.emoji}>👤</Text>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>Your flip history and stats will live here.</Text>

        {/* ── Dev: reset onboarding ── */}
        <Pressable
          onPress={handleResetOnboarding}
          style={({ pressed }) => [styles.devBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.devBtnText}>Reset Onboarding (Dev)</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: V.brown,
  },
  subtitle: {
    fontSize: 14,
    color: V.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  devBtn: {
    marginTop: 32,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: V.muted,
    backgroundColor: 'transparent',
  },
  devBtnText: {
    fontSize: 12,
    color: V.muted,
    fontWeight: '600',
  },
});
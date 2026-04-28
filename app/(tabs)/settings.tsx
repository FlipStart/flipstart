import { useState } from "react";
import { Text, View, Pressable, Alert, Platform, StyleSheet, Modal, ScrollView } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import * as StoreReview from "expo-store-review";
import * as MailComposer from "expo-mail-composer";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useScanContext } from "@/lib/scan-context";

interface SettingsRowProps {
  icon: string;
  label: string;
  subtitle?: string;
  onPress?: () => void;
  destructive?: boolean;
  showChevron?: boolean;
}

function SettingsRow({ icon, label, subtitle, onPress, destructive, showChevron = true }: SettingsRowProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        { borderBottomColor: colors.border },
        pressed && onPress && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: destructive ? colors.error + "20" : colors.border }]}>
        <MaterialIcons
          name={icon as any}
          size={18}
          color={destructive ? colors.error : colors.muted}
        />
      </View>
      <View style={styles.rowContent}>
        <Text
          style={[
            styles.rowLabel,
            { color: destructive ? colors.error : colors.foreground },
          ]}
        >
          {label}
        </Text>
        {subtitle && (
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{subtitle}</Text>
        )}
      </View>
      {showChevron && (
        <MaterialIcons name="chevron-right" size={20} color={colors.muted} />
      )}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { history, clearHistory } = useScanContext();
  const [aboutVisible, setAboutVisible] = useState(false);

  const handleClearHistory = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (Platform.OS === "web") {
      if (confirm("Clear all scan history? This cannot be undone.")) {
        clearHistory();
      }
    } else {
      Alert.alert(
        "Clear History",
        "Are you sure you want to clear all scan history? This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Clear",
            style: "destructive",
            onPress: () => {
              clearHistory();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            },
          },
        ]
      );
    }
  };

  const handleAbout = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setAboutVisible(true);
  };

  const handleRateApp = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    try {
      if (await StoreReview.hasAction()) {
        await StoreReview.requestReview();
      } else {
        Alert.alert("Rate App", "Thank you for your interest! Rating is available when the app is published to the App Store.");
      }
    } catch {
      Alert.alert("Rate App", "Thank you for your interest! Rating will be available when the app is published to the App Store.");
    }
  };

  const handleSendFeedback = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const isAvailable = await MailComposer.isAvailableAsync();
    if (isAvailable) {
      await MailComposer.composeAsync({
        recipients: ["feedback@flipstart.app"],
        subject: "FlipStart Feedback",
        body: `\n\n---\nFlipStart v1.0.0\nPlatform: ${Platform.OS}\nScans: ${history.length}`,
      });
    } else {
      // Fallback: show alert with email
      if (Platform.OS === "web") {
        window.open("mailto:feedback@flipstart.app?subject=FlipStart%20Feedback", "_blank");
      } else {
        Alert.alert(
          "Send Feedback",
          "Email us at feedback@flipstart.app with your suggestions or issues.",
          [{ text: "OK" }]
        );
      }
    }
  };

  const handleViewHistory = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push("/(tabs)/history" as any);
  };

  return (
    <ScreenContainer>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Settings</Text>

        {/* General Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>GENERAL</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <SettingsRow
              icon="info"
              label="About FlipStart"
              subtitle="AI-powered resale assistant"
              onPress={handleAbout}
            />
            <SettingsRow
              icon="star"
              label="Rate App"
              subtitle="Help us improve"
              onPress={handleRateApp}
            />
            <SettingsRow
              icon="feedback"
              label="Send Feedback"
              onPress={handleSendFeedback}
            />
          </View>
        </View>

        {/* Data Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>DATA</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <SettingsRow
              icon="history"
              label="Scan History"
              subtitle={`${history.length} scan${history.length !== 1 ? "s" : ""} saved`}
              onPress={handleViewHistory}
            />
            <SettingsRow
              icon="delete"
              label="Clear History"
              onPress={handleClearHistory}
              destructive
              showChevron={false}
            />
          </View>
        </View>

        {/* Version */}
        <Text style={[styles.versionText, { color: colors.muted }]}>
          FlipStart v1.0.0
        </Text>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* About Modal */}
      <Modal
        visible={aboutVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAboutVisible(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>About FlipStart</Text>
            <Pressable
              onPress={() => setAboutVisible(false)}
              style={({ pressed }) => [
                styles.modalClose,
                { backgroundColor: colors.surface },
                pressed && { opacity: 0.7 },
              ]}
            >
              <MaterialIcons name="close" size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={[styles.aboutLogoContainer, { backgroundColor: colors.primary + "15" }]}>
              <Text style={[styles.aboutLogoText, { color: colors.primary }]}>F</Text>
            </View>

            <Text style={[styles.aboutAppName, { color: colors.foreground }]}>FlipStart</Text>
            <Text style={[styles.aboutVersion, { color: colors.muted }]}>Version 1.0.0</Text>

            <View style={[styles.aboutDivider, { backgroundColor: colors.border }]} />

            <Text style={[styles.aboutDescription, { color: colors.foreground }]}>
              FlipStart is an AI-powered resale assistant that helps you identify items, estimate their resale value, and generate optimized marketplace listings.
            </Text>

            <Text style={[styles.aboutDescription, { color: colors.foreground }]}>
              Simply scan or upload a photo of any item and FlipStart will analyze it using advanced AI to provide:
            </Text>

            <View style={styles.aboutFeatureList}>
              {[
                "Item identification (brand, era, material)",
                "Real-time market value estimates",
                "Price adjustments based on condition",
                "Risk analysis and confidence scoring",
                "Optimized eBay and Depop listings",
              ].map((feature, i) => (
                <View key={i} style={styles.aboutFeatureRow}>
                  <MaterialIcons name="check-circle" size={16} color={colors.primary} />
                  <Text style={[styles.aboutFeatureText, { color: colors.foreground }]}>
                    {feature}
                  </Text>
                </View>
              ))}
            </View>

            <View style={[styles.aboutDivider, { backgroundColor: colors.border }]} />

            <Text style={[styles.aboutDisclaimer, { color: colors.muted }]}>
              Estimates are AI-generated and should be used as a guide. Always verify prices with current marketplace listings before making purchase decisions.
            </Text>
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    paddingTop: 8,
    paddingBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderBottomWidth: 0.5,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  rowContent: {
    flex: 1,
    gap: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 12,
    fontWeight: "400",
  },
  versionText: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "400",
    marginTop: 16,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    alignItems: "center",
  },
  aboutLogoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 16,
  },
  aboutLogoText: {
    fontSize: 36,
    fontWeight: "900",
  },
  aboutAppName: {
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 4,
  },
  aboutVersion: {
    fontSize: 14,
    fontWeight: "500",
  },
  aboutDivider: {
    height: 1,
    width: "100%",
    marginVertical: 20,
  },
  aboutDescription: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400",
    textAlign: "center",
    marginBottom: 12,
  },
  aboutFeatureList: {
    alignSelf: "stretch",
    gap: 10,
    marginTop: 8,
  },
  aboutFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  aboutFeatureText: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  aboutDisclaimer: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "400",
    textAlign: "center",
    fontStyle: "italic",
  },
});

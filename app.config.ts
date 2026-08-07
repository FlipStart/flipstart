import type { ExpoConfig } from "expo/config";

const bundleId = "com.flipstart.app";
const scheme   = "flipstart";

const config: ExpoConfig = {
  name:                "FlipStart",
  slug:                "flipstart",
  version:             "1.2.3",
  orientation:         "portrait",
  icon:                "./assets/images/icon.png",
  scheme,
  userInterfaceStyle:  "automatic",
  newArchEnabled:      true,

  ios: {
    supportsTablet:    false,
    bundleIdentifier:  bundleId,
    usesAppleSignIn:   true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "FlipStart uses your camera to photograph thrifted items and estimate their resale value.",
      NSPhotoLibraryUsageDescription:
        "FlipStart uses your photo library so you can upload saved item photos for resale analysis.",
      NSLocationWhenInUseUsageDescription:
        "FlipStart uses your location in Hunt Mode to help label thrift sessions by store or area.",
    },
  },

  android: {
    adaptiveIcon: {
      backgroundColor:   "#0D0D0D",
      foregroundImage:   "./assets/images/android-icon-foreground.png",
      backgroundImage:   "./assets/images/android-icon-background.png",
      monochromeImage:   "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled:             true,
    predictiveBackGestureEnabled:  false,
    package:                       bundleId,
    permissions:                   [],
    intentFilters: [
      {
        action:     "VIEW",
        autoVerify: true,
        data: [{ scheme, host: "*" }],
        category:   ["BROWSABLE", "DEFAULT"],
      },
    ],
  },

  // ── Web target: intentionally REMOVED ──────────────────────────────────────
  //
  // Was: { bundler: "metro", output: "static", favicon: "..." }
  //
  // `output: "static"` makes expo-router prerender EVERY route to HTML on
  // startup. With 42 routes that added roughly two minutes to a cold
  // `npx expo start -c` and filled the terminal with repeated
  // "Bundled … expo-router/node/render.js" lines — all of it producing a web
  // build nobody opens.
  //
  // FlipStart ships to iOS. There is no web deploy, and @expo/metro-runtime
  // (which Expo wants for web fast-refresh) was never installed, so this block
  // almost certainly came from a project template rather than a decision.
  //
  // To restore web: put the block back and run `npx expo install
  // @expo/metro-runtime react-dom react-native-web`. react-dom and
  // react-native-web are already present.

  plugins: [
    "expo-router",
    "expo-font",
    "expo-audio",
    "expo-web-browser",
    "expo-apple-authentication",
    [
      "expo-splash-screen",
      {
        // enableFullScreenImage_legacy: true is required for iOS to generate
        // a full-bleed launch storyboard. Without this the plugin generates
        // a centered constrained image view regardless of resizeMode.
        enableFullScreenImage_legacy: true,

        // resizeMode MUST be at the top level — placing it inside the ios{}
        // object causes the plugin to silently override it back to "contain"
        // when generating the iOS launch storyboard. (Known SDK 51-54 bug)
        resizeMode: "cover",

        backgroundColor: "#E8C99A",

        ios: {
          image:           "./assets/images/flipstart-splash.png",
          backgroundColor: "#E8C99A",
        },
        android: {
          image:           "./assets/images/flipstart-splash.png",
          backgroundColor: "#E8C99A",
        },
        dark: {
          ios:     { image: "./assets/images/flipstart-splash.png", backgroundColor: "#E8C99A" },
          android: { image: "./assets/images/flipstart-splash.png", backgroundColor: "#E8C99A" },
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs:    ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],

  extra: {
    eas: {
      projectId: "617d4f3e-29db-49d5-8ee8-142b6a0949b2",
    },
  },

  experiments: {
    typedRoutes:     true,
    reactCompiler:   true,
  },
};

export default config;
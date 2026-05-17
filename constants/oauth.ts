import * as Linking from "expo-linking";
import * as ReactNative from "react-native";

// ─── Production config ────────────────────────────────────────────────────────

const BUNDLE_ID = "com.flipstart.app";
const SCHEME    = "flipstart";

const env = {
  portal:         process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL ?? "",
  server:         process.env.EXPO_PUBLIC_OAUTH_SERVER_URL ?? "",
  appId:          process.env.EXPO_PUBLIC_APP_ID ?? "",
  ownerId:        process.env.EXPO_PUBLIC_OWNER_OPEN_ID ?? "",
  ownerName:      process.env.EXPO_PUBLIC_OWNER_NAME ?? "",
  apiBaseUrl:     process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  deepLinkScheme: SCHEME,
};

export const OAUTH_PORTAL_URL = env.portal;
export const OAUTH_SERVER_URL = env.server;
export const APP_ID = env.appId;
export const OWNER_OPEN_ID = env.ownerId;
export const OWNER_NAME = env.ownerName;
export const API_BASE_URL = env.apiBaseUrl;

/**
 * Your laptop's LAN IP address.
 * Update this if your IP changes (check with `ifconfig` / `ipconfig`).
 * Only used when running on a physical device and no EXPO_PUBLIC_API_BASE_URL is set.
 */
const LOCAL_DEV_IP = "10.1.47.80";
const LOCAL_DEV_PORT = "3000";

/**
 * Get the API base URL for all network requests.
 *
 * Priority:
 * 1. EXPO_PUBLIC_API_BASE_URL env var (always used in production — set this in eas.json)
 * 2. Dev only: LAN IP for physical device testing
 * 3. Dev only: derive from Metro hostname on web
 * 4. Production with no URL → throws to catch config errors early
 */
export function getApiBaseUrl(): string {
  // 1. Explicit env var — always wins (required in production builds)
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/\/$/, "");
  }

  // 2. Dev-only: LAN IP so physical devices can reach the dev laptop
  //    __DEV__ is false in all production/EAS builds — this never runs in prod
  if (__DEV__ && ReactNative.Platform.OS !== "web") {
    return `http://${LOCAL_DEV_IP}:${LOCAL_DEV_PORT}`;
  }

  // 3. Dev-only: web — derive API hostname from Metro hostname
  if (__DEV__ && typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    const apiHostname = hostname.replace(/^8081-/, "3000-");
    if (apiHostname !== hostname) {
      return `${protocol}//${apiHostname}`;
    }
    return `http://localhost:${LOCAL_DEV_PORT}`;
  }

  // 4. Production build with no URL configured — fail loudly so it is caught
  //    before App Store submission, not silently in front of real users
  throw new Error(
    "[FlipStart] EXPO_PUBLIC_API_BASE_URL is not set. " +
    "Add it to your EAS production build environment in eas.json."
  );
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";

const encodeState = (value: string) => {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  const BufferImpl = (globalThis as Record<string, any>).Buffer;
  if (BufferImpl) {
    return BufferImpl.from(value, "utf-8").toString("base64");
  }
  return value;
};

/**
 * Get the redirect URI for OAuth callback.
 * - Web: uses API server callback endpoint
 * - Native: uses deep link scheme
 */
export const getRedirectUri = () => {
  if (ReactNative.Platform.OS === "web") {
    return `${getApiBaseUrl()}/api/oauth/callback`;
  } else {
    return Linking.createURL("/oauth/callback", {
      scheme: env.deepLinkScheme,
    });
  }
};

export const getLoginUrl = () => {
  const redirectUri = getRedirectUri();
  const state = encodeState(redirectUri);

  const url = new URL(`${OAUTH_PORTAL_URL}/app-auth`);
  url.searchParams.set("appId", APP_ID);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

/**
 * Start OAuth login flow.
 *
 * On native platforms (iOS/Android), open the system browser directly so
 * the OAuth callback returns via deep link to the app.
 *
 * On web, this simply redirects to the login URL.
 *
 * @returns Always null, the callback is handled via deep link.
 */
export async function startOAuthLogin(): Promise<string | null> {
  const loginUrl = getLoginUrl();

  if (ReactNative.Platform.OS === "web") {
    // On web, just redirect
    if (typeof window !== "undefined") {
      window.location.href = loginUrl;
    }
    return null;
  }

  const supported = await Linking.canOpenURL(loginUrl);
  if (!supported) {
    console.warn("[OAuth] Cannot open login URL: URL scheme not supported");
    return null;
  }

  try {
    await Linking.openURL(loginUrl);
  } catch (error) {
    console.error("[OAuth] Failed to open login URL:", error);
  }

  // The OAuth callback will reopen the app via deep link.
  return null;
}
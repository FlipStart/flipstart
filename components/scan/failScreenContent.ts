/**
 * components/scan/failScreenContent.ts
 *
 * The words and buttons for every scan fail screen (Phase 5 of the scan
 * failure plan). Pure data, so each screen's copy and button rules are tested
 * without rendering anything; FailStateScreen.tsx only lays it out.
 *
 * Rules every screen follows:
 *   - Says what happened and what to do next, in plain words. Never the
 *     server's raw error text, never a percentage.
 *   - Says whether a scan was used.
 *   - At most two buttons. Photo problems add a small "Back" link, because
 *     Retake and Continue anyway both matter there.
 *   - No Retry. A scan fails once, clearly; the 45 s clock already retried
 *     quietly where that could help.
 *   - In Hunt Mode, "Back to Home" reads "Back to Hunt" and returns to the hunt.
 */
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { FailPaywall, FailScreen, ServerCause } from "@/lib/scanAttempt";
import { FREE_LIFETIME_SCANS } from "@/lib/paywallConfig";

export type FailAction = "continue" | "back" | "retake" | "sign_in" | "update" | "see_plans" | "scan_store";

/**
 * not_used — nothing was charged (every hard failure, and a soft fail the
 *            user hasn't accepted).
 * pending  — a soft fail whose scan is held: Continue anyway uses it.
 * used     — a soft fail that was already charged (a server that doesn't hold
 *            charges yet).
 * unknown  — the 45 s stop without the server confirming it.
 */
export type ChargeState = "not_used" | "pending" | "used" | "unknown";

export interface FailButton { action: FailAction; label: string }

export interface FailContent {
  /** Small caps label in the masthead, e.g. "LOW CONFIDENCE". */
  feature: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  body: string;
  /** One specific thing to do differently. */
  tip: string | null;
  /** Show the user's photo and what the AI could tell. */
  showPhoto: boolean;
  /**
   * Whether the card says what the AI could tell, or just shows the photo.
   * "Several items" and "no item" would only repeat the title, so they show
   * the photo alone.
   */
  photoCaption: "what_we_saw" | "photo_only";
  primary: FailButton;
  secondary: FailButton | null;
  /** A small text link under the buttons. */
  link: FailButton | null;
  chargeNote: string | null;
}

export interface FailContentInput {
  screen: FailScreen;
  cause?: ServerCause;
  paywall?: FailPaywall;
  photoProblems?: readonly string[];
  charge: ChargeState;
  inHunt: boolean;
  /**
   * Out of scans only: whose scans ran out. Free users have a lifetime
   * allowance that never resets; subscribers refill at renewal and must never
   * be told to "upgrade to Pro". Null when the plan isn't known yet.
   */
  plan?: "free" | "pro" | null;
}

const PROBLEM_TITLE: Record<string, string> = {
  blurry:   "The photo is blurry",
  too_dark: "The photo is too dark",
  too_far:  "The item is too far away",
  glare:    "Glare is hiding the details",
  cut_off:  "Part of the item is cut off",
};

const PROBLEM_TIP: Record<string, string> = {
  blurry:   "Hold steady and tap the item to focus before you shoot.",
  too_dark: "Move near a window or into brighter light.",
  too_far:  "Get closer, so the item fills most of the frame.",
  glare:    "Tilt the item or step to one side to lose the reflection.",
  cut_off:  "Step back so the whole item is in the frame.",
};

const SERVER: Record<ServerCause, { title: string; body: string; tip: string | null }> = {
  server_down: {
    title: "FlipStart's servers aren't responding",
    body:  "Our hosting provider, Railway, isn't answering right now. It's on our end, not your phone or your connection.",
    tip:   "Outages like this usually clear up within a few minutes.",
  },
  restarting: {
    title: "FlipStart is updating",
    body:  "Our servers are restarting for an update, so this scan couldn't run.",
    tip:   "Try again in a minute.",
  },
  ai_busy: {
    title: "Our AI is overloaded",
    body:  "The AI service FlipStart uses is overloaded or not responding right now.",
    tip:   "Try again in a minute.",
  },
  ai_failed: {
    title: "The AI couldn't finish this scan",
    body:  "It didn't come back with a usable analysis this time.",
    tip:   "Scanning again usually works.",
  },
  account_check: {
    title: "We couldn't check your account",
    body:  "FlipStart couldn't read your scan balance just now, so the scan didn't run.",
    tip:   "Try again in a minute.",
  },
  unknown: {
    title: "Something went wrong on our end",
    body:  "We're not sure exactly what happened, but it wasn't your photo.",
    tip:   "Try again in a minute.",
  },
};

export const CHARGE_NOTE: Record<ChargeState, string | null> = {
  not_used: "No scan used",
  pending:  "No scan used yet · Continue anyway uses 1 scan",
  used:     "This scan was used",
  unknown:  null,
};

export function failContent(i: FailContentInput): FailContent {
  const back: FailButton = { action: "back", label: i.inHunt ? "Back to Hunt" : "Back to Home" };
  const cont: FailButton = { action: "continue", label: "Continue anyway" };
  const retake: FailButton = { action: "retake", label: "Retake photo" };
  const chargeNote = CHARGE_NOTE[i.charge];
  const base = { showPhoto: false, photoCaption: "what_we_saw" as const, secondary: null, link: null, chargeNote };

  switch (i.screen) {
    case "cannot_identify":
      return { ...base, feature: "COULDN'T IDENTIFY", icon: "search-off",
        title: "We couldn't identify this item",
        body: "The photos didn't show enough for FlipStart to say what this is.",
        tip: "A clear, close shot of the tag or label usually fixes this.",
        showPhoto: true, primary: cont, secondary: back };

    case "low_confidence":
      return { ...base, feature: "LOW CONFIDENCE", icon: "visibility",
        title: "We're not sure about this one",
        body: "FlipStart could only partly identify this item, so its price and Buy rating may be off.",
        tip: "Add a photo of the tag or brand label for a confident result.",
        showPhoto: true, primary: cont, secondary: back };

    case "multiple_items":
      return { ...base, feature: "SEVERAL ITEMS", icon: "filter-none",
        title: "There's more than one item in the photo",
        body: "None of them stood out enough for FlipStart to know which one you meant.",
        tip: "Photograph one item on its own, filling most of the frame.",
        showPhoto: true, photoCaption: "photo_only", primary: cont, secondary: back };

    case "photo_problem": {
      const known = (i.photoProblems ?? []).filter(p => p in PROBLEM_TITLE);
      const title = known.length === 1 ? PROBLEM_TITLE[known[0]] : "The photo is hard to read";
      const tip = known.length ? PROBLEM_TIP[known[0]] : "Retake it in good light, close up and steady.";
      return { ...base, feature: "PHOTO PROBLEM", icon: "photo-camera",
        title, body: "FlipStart could only partly identify the item because of the photo.",
        tip, showPhoto: true, primary: retake, secondary: cont, link: back };
    }

    case "no_item":
      return { ...base, feature: "NO ITEM FOUND", icon: "image-not-supported",
        title: "We couldn't find an item in the photo",
        body: "There's nothing in this shot for FlipStart to identify.",
        tip: "Point the camera at one item so it fills most of the frame.",
        showPhoto: true, photoCaption: "photo_only", primary: retake, secondary: back,
        // Nothing to continue to: the server hands the scan straight back —
        // unless the user is past the daily cap of uncharged soft fails.
        chargeNote: i.charge === "used" ? CHARGE_NOTE.used : CHARGE_NOTE.not_used };

    case "timeout":
      return { ...base, feature: "TOOK TOO LONG", icon: "hourglass-empty",
        title: "This scan took too long",
        body: "FlipStart stopped it after 45 seconds. A slow connection is the usual cause.",
        tip: "Try again somewhere with better signal.",
        primary: back };

    case "offline":
      return { ...base, feature: "NO CONNECTION", icon: "wifi-off",
        title: "You're offline",
        body: "Your phone couldn't reach the internet, so the scan couldn't be sent.",
        tip: "Thrift stores are often dead zones — try near the entrance or a window.",
        // An earlier try may have reached us before the signal dropped, so
        // "no scan used" only when the server confirmed it.
        primary: back };

    case "server": {
      const c = SERVER[i.cause ?? "unknown"] ?? SERVER.unknown;
      return { ...base, feature: "SERVER ISSUE", icon: i.cause === "server_down" ? "cloud-off" : "dns",
        title: c.title, body: c.body, tip: c.tip, primary: back };
    }

    case "sign_in":
      return { ...base, feature: "SIGN IN", icon: "lock-outline",
        title: "Please sign in again",
        body: "FlipStart couldn't verify your account, so the scan didn't run.",
        tip: null, primary: { action: "sign_in", label: "Sign in" }, secondary: back,
        chargeNote: CHARGE_NOTE.not_used };

    case "out_of_scans":
      if (i.plan === "pro") {
        return { ...base, feature: "OUT OF SCANS", icon: "hourglass-bottom",
          title: "You've used this period's scans",
          body: "Your scans refill when your plan renews. Scan Store packs keep you going until then, and never expire.",
          tip: null, primary: { action: "scan_store", label: "Open Scan Store" }, secondary: back,
          chargeNote: CHARGE_NOTE.not_used };
      }
      if (i.plan === "free") {
        // Approved copy from the scan-limit fix: the allowance is lifetime and
        // never resets, so nothing here may promise a refill.
        return { ...base, feature: "OUT OF SCANS", icon: "hourglass-bottom",
          title: `You've used your ${FREE_LIFETIME_SCANS} lifetime scans`,
          body: "Free scans don't reset. Keep scanning with FlipStart Pro, or add scans from the Scan Store without subscribing.",
          tip: null, primary: { action: "see_plans", label: "See plans" }, secondary: back,
          chargeNote: CHARGE_NOTE.not_used };
      }
      return { ...base, feature: "OUT OF SCANS", icon: "hourglass-bottom",
        title: "You're out of scans",
        body: "Add scans from the Scan Store, or see what FlipStart Pro includes.",
        tip: null, primary: { action: "see_plans", label: "See plans" }, secondary: back,
        chargeNote: CHARGE_NOTE.not_used };

    case "pro_feature": {
      const ctx = i.paywall === "camera_context";
      return { ...base, feature: "PRO FEATURE", icon: "workspace-premium",
        title: ctx ? "AI Context is a Pro feature" : "A third photo is a Pro feature",
        body: ctx
          ? "This scan included AI Context, so it didn't run. Upgrade to Pro, or scan again without it."
          : "This scan had three photos, so it didn't run. Upgrade to Pro, or scan again with two.",
        tip: null, primary: { action: "see_plans", label: "See Pro" }, secondary: back,
        chargeNote: CHARGE_NOTE.not_used };
    }

    case "app_outdated":
      return { ...base, feature: "UPDATE NEEDED", icon: "system-update",
        title: "Please update FlipStart",
        body: "This version of FlipStart is out of date. Update from the App Store to keep scanning.",
        tip: null, primary: { action: "update", label: "Update FlipStart" }, secondary: back,
        chargeNote: CHARGE_NOTE.not_used };

    case "photo_load_failed":
    default:
      return { ...base, feature: "PHOTO DIDN'T LOAD", icon: "broken-image",
        title: "We couldn't load your photo",
        body: "The photo didn't make it into the scan.",
        tip: "Take it again — it usually works the second time.",
        primary: retake, secondary: back, chargeNote: CHARGE_NOTE.not_used };
  }
}
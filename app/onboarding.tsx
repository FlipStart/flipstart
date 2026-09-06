/**
 * app/onboarding.tsx
 *
 * New-user onboarding — the complete flow.
 *
 * ── One route, one state machine ────────────────────────────────────────────
 * Every stage renders inside this screen from local state, in the shared
 * OnboardingShell. Nothing here pushes a new route except the existing /auth
 * and /username-setup screens, and the final offer is the shared Pro paywall
 * modal opened over this screen. The navigation stack stays exactly what
 * app/_layout.tsx already protects.
 *
 * ── The journey ─────────────────────────────────────────────────────────────
 *   Welcome → Motivation → Categories → Experience → Pain point
 *   → Money value → Intelligence value → Gamification value
 *   → Building your profile → Personalized result
 *   → [existing /auth: create account] → Onboarding Pro offer → Enter FlipStart
 *
 * ── Account creation is not the end ─────────────────────────────────────────
 * A brand-new account created from this funnel is finished only when the
 * user explicitly chooses Pro (confirmed by the server) or Continue Free on
 * the final offer. The mechanism is in lib/onboarding-storage.ts: Screen 10
 * stages the answers and sets a PENDING OFFER marker; every auth success path
 * already calls completeOnboarding(), which is a no-op while that marker
 * exists; auth lands back here (authReturn, or the Home gate on a cold
 * start); this screen resumes at the offer; the offer decision calls
 * finishNewUserOnboarding(). No auth file changes.
 *
 * ── New vs. existing is explicit ────────────────────────────────────────────
 * The marker alone is not proof: from the signup form the user can switch to
 * "Log in instead" and sign into an old account. So a signed-in return with a
 * marker is classified by auth's own `user.created_at` against the marker's
 * timestamp (lib/onboardingAnswers.ts). Existing accounts are finished
 * normally and never see the new-user offer; a marker bound to a DIFFERENT
 * account is cleared, never applied. Sign In from Welcome clears any marker.
 *
 * ── Answers ─────────────────────────────────────────────────────────────────
 * Session state until Screen 10. Staged to AsyncStorage (coded keys only)
 * when the user chooses to create an account; written to the new account's
 * auth.users.user_metadata once it exists; the staged copy is cleared only
 * after that write is confirmed. A failed write never blocks anything.
 *
 * ── primaryGoal is not UserMode ─────────────────────────────────────────────
 * Completion still passes the legacy literal 'resell', exactly as every
 * caller did before. The quiz answer is an onboarding preference; it does not
 * touch the unfinished "Buy for Yourself" mode.
 *
 * ── Focus, not mount ────────────────────────────────────────────────────────
 * The resume decision runs under useFocusEffect. Auth returns here by
 * REPLACING itself with a new instance of this screen; the original instance
 * stays beneath, unfocused, and must not react to the auth change — or two
 * screens would open the offer. Only the focused one decides.
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, Pressable } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { FONTS } from '@/constants/typography';
import { PW } from '@/components/monetization/paywall/paywallTheme';
import { useProPaywall } from '@/components/monetization/paywall/ProPaywallProvider';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { PathCard, LadderRow, HelpCard } from '@/components/onboarding/QuestionCards';
import { MoneyTeaser, IntelligenceTeaser, GamificationTeaser } from '@/components/onboarding/ValueTeasers';
import { ProfileBuilding } from '@/components/onboarding/ProfileBuilding';
import { ProfileResult } from '@/components/onboarding/ProfileResult';
import {
  ONBOARDING_VERSION, completeOnboarding, finishNewUserOnboarding,
  stageOnboardingAnswers, readStagedAnswers, clearStagedAnswers, bindStagedAnswersToUser,
  setPendingNewUserOffer, readPendingNewUserOffer, clearPendingNewUserOffer, bindPendingOfferToUser,
} from '@/lib/onboarding-storage';
import { classifyAccount, persistAnswersToAccount } from '@/lib/onboardingAnswers';
import { setAuthReturnDest, clearAuthReturnDest } from '@/lib/authReturn';
import {
  EMPTY_ANSWERS, QUIZ_STAGES, PRIMARY_GOALS, EXPERIENCE_LEVELS, PAIN_POINTS,
  stageIsComplete, stageProgress, togglePainPoint, answersComplete,
  type OnboardingAnswers, type QuizStage,
} from '@/lib/onboardingQuiz';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';

type Stage = 'welcome' | QuizStage;

/**
 * What the focused screen decided on arrival.
 *   none     — nothing pending: Welcome, then the quiz
 *   hold     — signed in, marker set, profile not resolved yet
 *   username — new account still needs a username (existing screen)
 *   existing — an account that predates this funnel: finish normally
 *   offer    — a new account from this funnel: resume at the offer
 */
type Resume = 'undecided' | 'none' | 'hold' | 'username' | 'existing' | 'offer';

/** The stage transition: a short settle, once per stage. */
const STAGE_ENTER = FadeInDown.duration(240);

export default function OnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ notice?: string }>();
  const { user, profile, profileChecked, profileError, loading: authLoading, refreshProfile } = useAuth();
  const signedIn = !!user;
  const { openProPaywall, isPaywallOpen } = useProPaywall();

  // Shown when a social login on the login-only route turned out to be a
  // brand-new account. auth.tsx bounces here with this param.
  const [notice] = useState<string | null>(
    params.notice === 'no_existing_account'
      ? "That log-in created a new account, not an existing one. Tap Get Started to set up FlipStart."
      : null,
  );

  const [stage, setStage] = useState<Stage>('welcome');
  /**
   * The quiz ALWAYS starts empty.
   *
   * `answers` is written by exactly three functions, all of them tap handlers
   * (setGoal, setExperience, tapPain). Nothing prefills it — not staged
   * answers from an abandoned run, not anything else. A question that opens
   * with an option already lit reads as the app having decided for you.
   *
   * A fresh object rather than EMPTY_ANSWERS itself: the module constant is
   * shared, and handing its identity to state would make one accidental
   * in-place mutation corrupt every later session on the device.
   */
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({ ...EMPTY_ANSWERS, painPoints: [] }));
  const [saving, setSaving] = useState(false);
  const [resume, setResume] = useState<Resume>('undecided');
  const [buildNeedsContinue, setBuildNeedsContinue] = useState(false);

  /** Exactly-once guards. */
  const finishingRef = useRef(false);
  const offerOpenedRef = useRef(false);
  const decidedForRef = useRef<string | null | undefined>(undefined);
  /** True once the answers are known to be on the account. */
  const persistedRef = useRef(false);

  useEffect(() => { trackAnalyticsEvent('onboarding_started', {}); }, []);

  // ── Resume decision — focused screen only, once per signed-in user ─────
  const decide = useCallback(async () => {
    const uid = user?.id ?? null;
    const pending = await readPendingNewUserOffer();
    const staged = await readStagedAnswers();

    if (!uid) {
      // Signed out. Staged answers from an abandoned run stay in storage —
      // they still persist to the account if that run resumes — but they are
      // NOT poured back into the quiz. Restoring them lit an option on the
      // pain-point screen before the user had touched it.
      setResume('none');
      return;
    }
    if (!pending) { setResume('none'); return; }          // dev reset / version bump on an existing session

    if (pending.userId && pending.userId !== uid) {
      // Someone else's funnel. Never applied to this account.
      await clearPendingNewUserOffer();
      await clearStagedAnswers();
      setResume('existing');
      return;
    }
    if (classifyAccount(user?.created_at, pending.stagedAt) === 'existing') {
      // "Log in instead" from the signup form, or any account older than this
      // session. Finished normally; the offer is for new accounts only.
      await clearPendingNewUserOffer();
      await clearStagedAnswers();
      setResume('existing');
      return;
    }

    // A brand-new account from this funnel. Bind everything to it now.
    await bindPendingOfferToUser(uid);
    await bindStagedAnswersToUser(uid);

    // Username setup is still required where it always was. profileError and
    // a missing row both mean "not known yet" — hold, do not guess.
    if (profileError || !profile) { setResume('hold'); return; }
    if (!profile.onboarding_complete) { setResume('username'); return; }

    setResume('offer');
  }, [user?.id, user?.created_at, profile, profileError]);

  const decidingRef = useRef(false);
  useFocusEffect(useCallback(() => {
    if (authLoading || !profileChecked) return;
    const uid = user?.id ?? null;
    const settled = resume !== 'undecided' && resume !== 'hold';
    // Re-decide when the user changes, or when a held decision can now be made.
    if (decidedForRef.current === uid && settled) return;
    if (decidingRef.current) return;
    decidingRef.current = true;
    decidedForRef.current = uid;
    decide().finally(() => { decidingRef.current = false; });
  }, [authLoading, profileChecked, user?.id, resume, decide]));

  /** Best-effort write of the staged answers to the account; clears the stage only on success. */
  const persistIfStaged = useCallback(async () => {
    if (persistedRef.current) return true;
    const staged = await readStagedAnswers();
    if (!staged) { persistedRef.current = true; return true; }
    const ok = await persistAnswersToAccount(staged);
    if (ok) { persistedRef.current = true; await clearStagedAnswers(); }
    return ok;
  }, []);

  // ── Navigation within the quiz ──────────────────────────────────────────
  const stageIndex = stage === 'welcome' ? -1 : QUIZ_STAGES.indexOf(stage);
  const canContinue = stage !== 'welcome' && stageIsComplete(stage, answers);

  const start = useCallback(() => {
    trackAnalyticsEvent('onboarding_get_started_tapped', { entry_point: 'onboarding' });
    setStage(QUIZ_STAGES[0]);
  }, []);

  const back = useCallback(() => {
    if (stage === 'result') { setStage('gamification'); return; }   // never replay the build
    setStage(stageIndex <= 0 ? 'welcome' : QUIZ_STAGES[stageIndex - 1]);
  }, [stage, stageIndex]);

  /**
   * Existing login-only route. Bounce protection lives in auth.tsx. An
   * existing user is never a new-user funnel, so any pending marker goes.
   */
  const logIn = useCallback(() => {
    trackAnalyticsEvent('onboarding_login_tapped', { entry_point: 'onboarding' });
    void clearPendingNewUserOffer();
    clearAuthReturnDest();
    router.push({ pathname: '/auth', params: { mode: 'login', authEntryPoint: 'onboarding' } } as any);
  }, [router]);

  /**
   * Screen 10, signed out: stage the answers, mark the funnel pending, ask
   * auth to come back here, and hand off to the existing signup form (which
   * carries Google and Apple). Nothing is completed yet.
   */
  const saveProfileAndCreateAccount = useCallback(async () => {
    if (!answersComplete(answers) || saving) return;
    setSaving(true);
    await stageOnboardingAnswers({
      primaryGoal: answers.primaryGoal,
      experienceLevel: answers.experienceLevel,
      painPoints: answers.painPoints,
    });
    await setPendingNewUserOffer();
    setAuthReturnDest('/onboarding');
    trackAnalyticsEvent('onboarding_create_account_tapped', { entry_point: 'onboarding', primary_goal: answers.primaryGoal });
    setSaving(false);
    router.push({ pathname: '/auth', params: { mode: 'signup', authEntryPoint: 'onboarding' } } as any);
  }, [answers, saving, router]);

  /**
   * An account that already existed: a signed-in tester after a dev reset, or
   * a login from the signup form. Persist the answers if there are any, mark
   * the device complete, enter. Never the new-user offer.
   */
  const finishExisting = useCallback(async (reason: 'existing_account' | 'signed_in_quiz') => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setSaving(true);
    if (answersComplete(answers)) {
      await persistAnswersToAccount({
        primaryGoal: answers.primaryGoal,
        experienceLevel: answers.experienceLevel,
        painPoints: answers.painPoints,
        answeredAt: new Date().toISOString(),
      });
    }
    trackAnalyticsEvent('onboarding_completed', {
      onboarding_version: ONBOARDING_VERSION, outcome: reason,
      primary_goal: answers.primaryGoal, experience_level: answers.experienceLevel, pain_points: answers.painPoints,
    });
    // Legacy UserMode literal — not the quiz's primaryGoal. See the header.
    await completeOnboarding('resell').catch(() => {});
    router.replace('/(tabs)' as any);
  }, [answers, router]);

  /**
   * The end of a new-user funnel. Called ONLY from the offer, with the outcome
   * that actually happened:
   *   pro                — the SERVER confirmed Pro (onUnlocked)
   *   free               — the user tapped Continue with 15 Free Scans
   *   activation_pending — the purchase went through, the server has not
   *                        confirmed yet, and the user chose to carry on
   *
   * The third is never recorded as `free`: money changed hands. Nothing here
   * grants Pro, cancels anything, or touches reconciliation — the entitlement
   * system surfaces Pro on its own once it confirms.
   */
  const finishNewUser = useCallback(async (outcome: 'pro' | 'free' | 'activation_pending') => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setSaving(true);
    await persistIfStaged();                       // staged copy survives a failed write
    /**
     * Read the answers from storage rather than state.
     *
     * A user who created an account, closed the app, and reopened at the offer
     * has an EMPTY in-memory quiz — this screen is a fresh mount. The staged
     * payload is the truthful record of what they answered, and reading it
     * here is what lets `answers` stay tap-only.
     */
    const recorded = (await readStagedAnswers()) ?? null;
    trackAnalyticsEvent('onboarding_completed', {
      onboarding_version: ONBOARDING_VERSION, outcome,
      primary_goal: recorded?.primaryGoal ?? answers.primaryGoal,
      experience_level: recorded?.experienceLevel ?? answers.experienceLevel,
      pain_points: recorded?.painPoints ?? answers.painPoints,
    });
    await finishNewUserOnboarding('resell');       // clears the marker, writes the version
    router.replace('/(tabs)' as any);
  }, [answers, persistIfStaged, router]);

  // ── The offer: the shared Pro paywall, opened once per arrival ──────────
  const [offerShown, setOfferShown] = useState(false);
  const openOffer = useCallback(() => {
    setOfferShown(true);
    openProPaywall('onboarding_offer', {
      onUnlocked: () => { void finishNewUser('pro'); },
      onDeclined: () => { void finishNewUser('free'); },
      onPendingActivation: () => { void finishNewUser('activation_pending'); },
    });
  }, [openProPaywall, finishNewUser]);

  useEffect(() => {
    if (stage !== 'offer' || resume !== 'offer') return;
    if (offerOpenedRef.current) return;
    offerOpenedRef.current = true;
    openOffer();
  }, [stage, resume, openOffer]);

  // ── Acting on the resume decision ───────────────────────────────────────
  useEffect(() => {
    if (resume === 'username') { router.replace('/username-setup' as any); return; }
    if (resume === 'existing') { void finishExisting('existing_account'); return; }
    if (resume === 'offer') { setStage('offer'); void persistIfStaged(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  const next = useCallback(() => {
    if (!canContinue) return;
    if (stage === 'pain_points') {
      trackAnalyticsEvent('onboarding_quiz_completed', {
        primary_goal: answers.primaryGoal,
        experience_level: answers.experienceLevel,
        pain_points: answers.painPoints,
      });
    }
    if (stage === 'result') {
      if (signedIn) void finishExisting('signed_in_quiz');
      else void saveProfileAndCreateAccount();
      return;
    }
    setStage(QUIZ_STAGES[stageIndex + 1]);
  }, [canContinue, stage, stageIndex, answers, signedIn, finishExisting, saveProfileAndCreateAccount]);

  const buildDone = useCallback(() => { setStage('result'); }, []);

  // ── Answer setters ──────────────────────────────────────────────────────
  const setGoal       = (v: OnboardingAnswers['primaryGoal'])      => setAnswers(a => ({ ...a, primaryGoal: v }));
  const setExperience = (v: OnboardingAnswers['experienceLevel'])  => setAnswers(a => ({ ...a, experienceLevel: v }));
  const tapPain       = (v: OnboardingAnswers['painPoints'][number]) =>
    setAnswers(a => ({ ...a, painPoints: togglePainPoint(a.painPoints, v) }));

  // ── Resolving a new account: username, or an existing account finishing ─
  if (resume === 'hold' || resume === 'username' || resume === 'existing') {
    return (
      <OnboardingShell
        progress={stageProgress('result')}
        headline={'Setting up your account\u2026'}
        support="One moment."
        centered
        footer={profileError && resume === 'hold' ? (
          <TextLink prefix="Taking a while?" action="Try again" onPress={() => { void refreshProfile(); }} />
        ) : null}
      >
        <View style={w.holding}><ActivityIndicator color={PW.forest} /></View>
      </OnboardingShell>
    );
  }

  // ── Welcome ─────────────────────────────────────────────────────────────
  /**
   * Both actions render on the FIRST FRAME.
   *
   * They used to wait on two async reads — the completed-version key, to decide
   * which button should dominate, and the resume decision, to avoid sending a
   * returning new account into the quiz. Neither is needed now: a signed-out
   * user always gets both a new-user path and a returning-user path, so there
   * is nothing to decide, and the resume effect still overrides the stage the
   * moment it resolves (a pending account is moved to its offer, an existing
   * one is finished) — so an early tap cannot strand anyone.
   *
   * A signed-in user gets Get Started only: they are already authenticated, so
   * Log In would be nonsense. They are never signed out and no second account
   * is ever created.
   */
  if (stage === 'welcome') {
    return (
      <OnboardingShell
        progress={null}
        brand
        brandLine="THRIFT INTELLIGENCE"
        centered
        headline={'Spot value.\nFind profitable flips.\nThrift smarter.'}
        support="FlipStart helps you identify finds, understand resale potential, make smarter buy decisions, and level up every thrift trip."
        ctaPlacement="content"
        cta={{ label: 'Get Started', onPress: start, kicker: signedIn ? undefined : 'NEW HERE?', pulse: true }}
        secondaryCta={signedIn ? undefined : {
          label: 'Log In', onPress: logIn, kicker: 'ALREADY HAVE A FLIPSTART ACCOUNT?', pulse: true,
        }}
      >
        <Animated.View entering={STAGE_ENTER} style={w.pillars}>
          <Pillar icon="trending-up"   text="Smarter, more profitable buys" />
          <Pillar icon="search"        text="Identify and understand your finds" />
          <Pillar icon="emoji-events"  text="Every thrift trip becomes progress" />
        </Animated.View>

        {!!notice && (
          <View style={w.notice} accessibilityLiveRegion="polite">
            <MaterialIcons name="info-outline" size={15} color={PW.forest} />
            <Text style={w.noticeText}>{notice}</Text>
          </View>
        )}
      </OnboardingShell>
    );
  }

  // ── Questions ───────────────────────────────────────────────────────────
  const progress = stageProgress(stage);
  const cta = { label: 'Continue', onPress: next, disabled: !canContinue };

  /** Three rich path cards. Sparse screen, so the CTA follows the content. */
  if (stage === 'motivation') {
    return (
      <OnboardingShell progress={progress} onBack={back} cta={cta} masthead
        eyebrow="QUESTION 1 OF 3" ctaPlacement="content"
        headline="What brings you to FlipStart?" accent="FlipStart"
        support="Pick the reason that fits you best.">
        <Animated.View key={stage} entering={STAGE_ENTER} style={q.stack}>
          {PRIMARY_GOALS.map(o => (
            <PathCard key={o.value}
              eyebrow={o.eyebrow ?? ''} title={o.title} support={o.support}
              icon={(o.icon ?? 'auto-awesome') as any}
              selected={answers.primaryGoal === o.value} onPress={() => setGoal(o.value)} />
          ))}
        </Animated.View>
      </OnboardingShell>
    );
  }

  /** A connected ladder — a different rhythm from the three cards before it. */
  if (stage === 'experience') {
    return (
      <OnboardingShell progress={progress} onBack={back} cta={cta} masthead
        eyebrow="QUESTION 2 OF 3" ctaPlacement="content"
        headline="How confident are you at spotting value?" accent="spotting value"
        support={'We\u2019ll use this to shape your FlipStart profile.'}>
        <Animated.View key={stage} entering={STAGE_ENTER} style={q.ladder}>
          {EXPERIENCE_LEVELS.map((o, i) => (
            <LadderRow key={o.value} title={o.title} support={o.support}
              first={i === 0} last={i === EXPERIENCE_LEVELS.length - 1}
              selected={answers.experienceLevel === o.value} onPress={() => setExperience(o.value)} />
          ))}
        </Animated.View>
      </OnboardingShell>
    );
  }

  /** A two-column field: all six visible at once, sweepable. Denser, so the
      CTA stays anchored and the field scrolls beneath it on a small phone. */
  if (stage === 'pain_points') {
    return (
      <OnboardingShell progress={progress} onBack={back} cta={cta} masthead
        eyebrow="QUESTION 3 OF 3"
        headline="What do you want FlipStart to help with?" accent="FlipStart"
        support="Choose everything that would make thrifting easier.">
        <Animated.View key={stage} entering={STAGE_ENTER} style={q.grid}>
          {PAIN_POINTS.map(o => (
            <HelpCard key={o.value} title={o.title} icon={o.icon as any}
              selected={answers.painPoints.includes(o.value)} onPress={() => tapPain(o.value)} />
          ))}
        </Animated.View>
      </OnboardingShell>
    );
  }

  // ── Value screens ───────────────────────────────────────────────────────
  if (stage === 'money') {
    return (
      <OnboardingShell progress={progress} onBack={back} cta={cta} masthead
        ctaPlacement="content"
        headline="Know the flip before you buy" accent="before you buy"
        support="See the numbers that matter before you decide whether a find deserves your money.">
        <Animated.View key={stage} entering={STAGE_ENTER}><MoneyTeaser /></Animated.View>
      </OnboardingShell>
    );
  }

  if (stage === 'intelligence') {
    return (
      <OnboardingShell progress={progress} onBack={back} cta={cta} masthead
        ctaPlacement="content"
        headline="Spot what others might miss" accent="others might miss"
        support={'FlipStart helps you understand unfamiliar finds \u2014 what they may be, what they may be worth, and what deserves a closer look.'}>
        <Animated.View key={stage} entering={STAGE_ENTER}><IntelligenceTeaser /></Animated.View>
      </OnboardingShell>
    );
  }

  if (stage === 'gamification') {
    return (
      <OnboardingShell progress={progress} onBack={back} cta={cta} masthead
        headline="Turn every thrift trip into progress" accent="into progress"
        support="Hunt, discover, earn XP, climb the ranks, and build a record of what you find.">
        <Animated.View key={stage} entering={STAGE_ENTER}><GamificationTeaser /></Animated.View>
      </OnboardingShell>
    );
  }

  // ── Building the profile ────────────────────────────────────────────────
  if (stage === 'building') {
    return (
      <OnboardingShell progress={progress} masthead centered ctaPlacement="content"
        headline={'Building your FlipStart profile\u2026'} accent="FlipStart"
        support="Putting your answers to work."
        cta={buildNeedsContinue ? { label: 'Continue', onPress: buildDone } : undefined}
      >
        <ProfileBuilding answers={answers} onDone={buildDone} onReduceMotion={setBuildNeedsContinue} />
      </OnboardingShell>
    );
  }

  // ── The result ──────────────────────────────────────────────────────────
  if (stage === 'result') {
    if (!answersComplete(answers)) {
      // Cannot happen through the UI; defensive so a partial state never
      // renders a half-built profile.
      return (
        <OnboardingShell progress={progress} onBack={() => setStage('motivation')} headline="Let’s finish your profile"
          support="A few answers are missing." cta={{ label: 'Back to the quiz', onPress: () => setStage('motivation') }} />
      );
    }
    return (
      <OnboardingShell progress={progress} onBack={back} masthead
        headline="Your FlipStart profile is ready" accent="FlipStart"
        support={signedIn ? undefined : 'Save your scans, XP, history, and profile across devices.'}
        cta={{ label: signedIn ? 'Enter FlipStart' : 'Save My Profile', onPress: next, disabled: saving }}
      >
        <Animated.View key={stage} entering={STAGE_ENTER}>
          <ProfileResult
            primaryGoal={answers.primaryGoal}
            experienceLevel={answers.experienceLevel}
            painPoints={answers.painPoints}
          />
        </Animated.View>
      </OnboardingShell>
    );
  }

  // ── The offer host: the paywall modal renders over this ─────────────────
  // stage === 'offer'
  return (
    <OnboardingShell progress={1} centered masthead ctaPlacement="content"
      headline="Choose how to start"
      support={'Go Pro, or continue on the Free plan \u2014 you\u2019ll be scanning in a moment either way.'}
      cta={offerShown && !isPaywallOpen && !saving ? { label: 'See your options', onPress: openOffer } : undefined}
    >
      <View style={w.holding}>{saving && <ActivityIndicator color={PW.forest} />}</View>
    </OnboardingShell>
  );
}

// ── Welcome pieces ──────────────────────────────────────────────────────────

/** One pillar: a forest glyph in the benefits strip's hairline ring, one line. */
function Pillar({ icon, text }: { icon: ComponentProps<typeof MaterialIcons>['name']; text: string }) {
  return (
    <View style={w.pillar}>
      <View style={w.pillarSeal}>
        <MaterialIcons name={icon} size={19} color={PW.forest} />
      </View>
      <Text style={w.pillarText}>{text}</Text>
    </View>
  );
}

/** "Already have an account? Sign In" — prefix in brown, action in forest. */
function TextLink({ prefix, action, onPress }: { prefix: string; action: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${prefix} ${action}`}
      style={({ pressed }) => [w.link, pressed && { opacity: 0.6 }]}>
      <Text style={w.linkPrefix}>{prefix} <Text style={w.linkAction}>{action}</Text></Text>
    </Pressable>
  );
}

const w = StyleSheet.create({
  pillars: { gap: 12, marginTop: 6, paddingHorizontal: 6 },
  pillar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pillarSeal: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(33,77,45,0.07)', borderWidth: 1, borderColor: 'rgba(33,77,45,0.22)',
  },
  pillarText: { flex: 1, fontFamily: FONTS.serif, fontSize: 15.5, fontWeight: '700', color: PW.ink, lineHeight: 21 },

  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14,
    backgroundColor: PW.goldTint, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(196,163,52,0.45)',
    paddingHorizontal: 12, paddingVertical: 9,
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: PW.brown, fontWeight: '600' },

  link: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  linkPrefix: { fontSize: 14, color: PW.brown, fontWeight: '600' },
  linkAction: { fontFamily: FONTS.serif, fontWeight: '800', color: PW.forest },

  holding: { alignItems: 'center', paddingTop: 28 },
});

const q = StyleSheet.create({
  stack: { gap: 10 },
  /** Cards breathe like every other list; the rail bridges the gap. */
  ladder: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
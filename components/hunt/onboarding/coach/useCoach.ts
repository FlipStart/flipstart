/**
 * components/hunt/onboarding/coach/useCoach.ts
 * React access to the demo coach state (lib/huntDemoCoach).
 */
import { useSyncExternalStore } from 'react';
import { getCoachState, subscribeCoach, getCoachStep, type CoachState, type CoachStep } from '@/lib/huntDemoCoach';

export function useCoach(): CoachState & { step: CoachStep | null } {
  const state = useSyncExternalStore(subscribeCoach, getCoachState, getCoachState);
  return { ...state, step: state.active ? getCoachStep(state.stepId) : null };
}
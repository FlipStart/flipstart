/**
 * lib/leaderboardIdentity.ts
 *
 * After a profile edit, ask the server to check the new name and picture for
 * the Hunt Leaderboard.
 *
 * Other people never see a profile directly. The server moderates the name and
 * picture and keeps its own approved copy (server/leaderboard/identity.ts).
 * This asks it to do that now, and waits a few seconds, so the user can be told
 * straight away if something they just saved cannot be shown to others.
 *
 * Never throws, and never blocks saving: if the server is slow or unreachable
 * the answer is null and the server checks later by itself.
 */
export type NameCheck = 'approved' | 'rejected' | 'pending';
export type AvatarCheck = 'approved' | 'rejected' | 'pending' | 'none';
export interface IdentityCheck { name: NameCheck; avatar: AvatarCheck }

export const IDENTITY_CHECK_TIMEOUT_MS = 8_000;

type Transport = () => Promise<any>;
let transportOverride: Transport | null = null;
/** Tests only. */
export function __setIdentityTransportForTests(t: Transport | null): void { transportOverride = t; }

async function defaultTransport(): Promise<any> {
  const { createTRPCClient } = await import('@/lib/trpc');
  return createTRPCClient().leaderboard.syncIdentity.mutate();
}

export async function syncLeaderboardIdentity(timeoutMs = IDENTITY_CHECK_TIMEOUT_MS): Promise<IdentityCheck | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res: any = await Promise.race([
      (transportOverride ?? defaultTransport)(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    if (res?.ok !== true) return null;
    return { name: res.name, avatar: res.avatar };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * What to tell the user, or null when there is nothing to say. Only mentions
 * what they changed just now: an old rejected picture is not brought up when
 * they only edited their name.
 */
export function identityNotice(
  check: IdentityCheck | null,
  changed: { name: boolean; avatar: boolean },
): string | null {
  if (!check) return null;
  const nameOut = changed.name && check.name === 'rejected';
  const picOut  = changed.avatar && check.avatar === 'rejected';
  if (nameOut && picOut) {
    return 'Your name and photo can\'t be shown on the Hunt Leaderboard. Other hunters will see "Hunter" and the default picture there.';
  }
  if (nameOut) return 'Your name can\'t be shown on the Hunt Leaderboard. Other hunters will see "Hunter" there.';
  if (picOut)  return 'Your photo can\'t be shown on the Hunt Leaderboard. Other hunters will see the default picture there.';
  return null;
}
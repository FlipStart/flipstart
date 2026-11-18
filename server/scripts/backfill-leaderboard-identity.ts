/**
 * server/scripts/backfill-leaderboard-identity.ts
 *
 * One-off: check EVERY existing account's name and profile picture for the
 * leaderboard, before it launches.
 *
 * Without this the first people to open the leaderboard would see "Hunter" and
 * the default picture for everyone until the background check caught up. It is
 * safe to run more than once: accounts already checked are skipped unless their
 * profile changed.
 *
 * WHAT IT DOES, per account:
 *   - name: word list, then OpenAI moderation; approved names are stored
 *   - picture: downloaded, re-encoded to a small square with no metadata,
 *     moderated, and stored under a random name in the public-avatars bucket
 *   - anything rejected simply does not show (the app falls back to "Hunter" /
 *     the default picture). Nothing in the user's own profile is changed.
 *
 * NEEDS (already set on Railway): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * OPENAI_API_KEY. Run hunt_leaderboard_phase2.sql first.
 *
 * USAGE (Railway dashboard → your service → Shell):
 *   npx tsx server/scripts/backfill-leaderboard-identity.ts
 */
import "dotenv/config";
import { refreshIdentity } from "../leaderboard/identity.js";
import { getLeaderboardStore } from "../leaderboard/store.js";

const PAGE = 200;
const PAUSE_MS = 150;       // gentle on the moderation API

async function main(): Promise<void> {
  const store = getLeaderboardStore();
  if (!store) {
    console.error("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Nothing done.");
    process.exit(1);
  }
  if (!(process.env.OPENAI_API_KEY ?? "").trim()) {
    console.error("OPENAI_API_KEY is not set, so nothing could be approved. Nothing done.");
    process.exit(1);
  }

  const tally = { accounts: 0, nameApproved: 0, nameRejected: 0, namePending: 0, picApproved: 0, picRejected: 0, picPending: 0, picNone: 0 };
  let after: string | null = null;
  for (;;) {
    const ids = await store.profileIds(after, PAGE);
    if (ids.length === 0) break;
    for (const id of ids) {
      const r = await refreshIdentity(id);
      tally.accounts += 1;
      if (r.name === "approved") tally.nameApproved += 1; else if (r.name === "rejected") tally.nameRejected += 1; else tally.namePending += 1;
      if (r.avatar === "approved") tally.picApproved += 1; else if (r.avatar === "rejected") tally.picRejected += 1;
      else if (r.avatar === "pending") tally.picPending += 1; else tally.picNone += 1;
      if (r.name === "rejected" || r.avatar === "rejected") {
        console.log(`  rejected: account ${id} name=${r.name} picture=${r.avatar}`);
      }
      await new Promise(res => setTimeout(res, PAUSE_MS));
    }
    after = ids[ids.length - 1];
    console.log(`  ...${tally.accounts} accounts checked`);
  }

  console.log("");
  console.log("Done.");
  console.log(`  accounts checked:   ${tally.accounts}`);
  console.log(`  names:    approved ${tally.nameApproved}, rejected ${tally.nameRejected}, could not check ${tally.namePending}`);
  console.log(`  pictures: approved ${tally.picApproved}, rejected ${tally.picRejected}, could not check ${tally.picPending}, none ${tally.picNone}`);
  if (tally.namePending + tally.picPending > 0) {
    console.log("  Some could not be checked (moderation or storage did not answer). Run this again to retry those.");
  }
}

main().catch(err => { console.error("Backfill failed:", err); process.exit(1); });
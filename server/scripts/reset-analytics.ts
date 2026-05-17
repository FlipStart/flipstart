/**
 * server/scripts/reset-analytics.ts
 *
 * One-time analytics reset script for FlipStart beta launch.
 * Clears all dev/test analytics data so the Founder Dashboard
 * starts clean when real users arrive.
 *
 * WHAT IT CLEARS:
 *   - events[]      — analytics event stream (overcounted, dev noise)
 *   - sessions[]    — session records (inflated from missing timeout)
 *   - scanRecords[] — AI scan data (dev/test scans only)
 *   - feedback[]    — Founder Dashboard feedback (dev/test data)
 *
 * WHAT IT PRESERVES:
 *   - scanCounter   — today's scan budget (resets daily, no reason to touch)
 *   - any unknown keys in the JSON (preserved as-is for safety)
 *   - the file itself and volume structure
 *
 * USAGE:
 *   RESET_ANALYTICS_CONFIRM=true npx tsx server/scripts/reset-analytics.ts
 *
 * To run against Railway:
 *   1. In Railway dashboard → your service → "Shell" tab
 *   2. Run: RESET_ANALYTICS_CONFIRM=true npx tsx server/scripts/reset-analytics.ts
 *   OR
 *   1. Set DATA_DIR locally to point at a downloaded backup of the volume
 *   2. Run locally, then re-upload the file
 */

import * as fs   from "fs";
import * as path from "path";

// ─── Safety gate ──────────────────────────────────────────────────────────────

if (process.env.RESET_ANALYTICS_CONFIRM !== "true") {
  console.error("");
  console.error("❌  RESET ABORTED — safety confirmation missing.");
  console.error("");
  console.error("    This script permanently clears FlipStart analytics data.");
  console.error("    To confirm you understand, re-run with:");
  console.error("");
  console.error("    RESET_ANALYTICS_CONFIRM=true npx tsx server/scripts/reset-analytics.ts");
  console.error("");
  process.exit(1);
}

// ─── File paths ───────────────────────────────────────────────────────────────

const DATA_DIR  = process.env.DATA_DIR ?? "/tmp";
const DATA_FILE = path.join(DATA_DIR, "flipstart-beta.json");

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  FlipStart Analytics Reset");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  DATA_DIR  : ${DATA_DIR}`);
console.log(`  DATA_FILE : ${DATA_FILE}`);
console.log("");

// ─── Check file exists ────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_FILE)) {
  console.log("⚠️  No data file found at:", DATA_FILE);
  console.log("   Nothing to reset. The file will be created fresh on next server start.");
  console.log("");
  process.exit(0);
}

// ─── Read current data ────────────────────────────────────────────────────────

let current: Record<string, unknown>;
try {
  current = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
} catch (e) {
  console.error("❌  Failed to read data file:", e);
  console.error("   Aborting — no changes made.");
  process.exit(1);
}

// ─── Print before counts ──────────────────────────────────────────────────────

const before = {
  feedback:    Array.isArray(current.feedback)    ? (current.feedback as unknown[]).length    : 0,
  events:      Array.isArray(current.events)      ? (current.events as unknown[]).length      : 0,
  sessions:    Array.isArray(current.sessions)    ? (current.sessions as unknown[]).length    : 0,
  scanRecords: Array.isArray(current.scanRecords) ? (current.scanRecords as unknown[]).length : 0,
};

console.log("📊  Current counts (BEFORE reset):");
console.log(`    feedback[]    : ${before.feedback} entries`);
console.log(`    events[]      : ${before.events} entries`);
console.log(`    sessions[]    : ${before.sessions} entries`);
console.log(`    scanRecords[] : ${before.scanRecords} entries`);
console.log("");

// ─── Back up the current file ─────────────────────────────────────────────────

const timestamp  = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupFile = path.join(DATA_DIR, `flipstart-beta-backup-${timestamp}.json`);

try {
  fs.copyFileSync(DATA_FILE, backupFile);
  console.log(`💾  Backup saved to: ${backupFile}`);
  console.log("    (Keep this file until you confirm the reset looks correct.)");
  console.log("");
} catch (e) {
  console.error("❌  Failed to create backup:", e);
  console.error("   Aborting — no changes made.");
  process.exit(1);
}

// ─── Build the reset store ────────────────────────────────────────────────────
// Preserve scanCounter and any unknown keys. Clear the four analytics arrays.

const reset: Record<string, unknown> = {
  ...current,           // start with everything (preserves unknown future keys)
  feedback:    [],      // clear — dev/test AI accuracy data
  events:      [],      // clear — overcounted dev sessions and events
  sessions:    [],      // clear — inflated session records
  scanRecords: [],      // clear — dev/test scan records
  // scanCounter is kept via the spread above
};

// ─── Atomic write ─────────────────────────────────────────────────────────────

const TMP_FILE = DATA_FILE + ".tmp";
try {
  fs.writeFileSync(TMP_FILE, JSON.stringify(reset, null, 2), "utf-8");
  fs.renameSync(TMP_FILE, DATA_FILE);
} catch (e) {
  console.error("❌  Failed to write reset file:", e);
  console.error("   Your backup is safe at:", backupFile);
  process.exit(1);
}

// ─── Verify and print after counts ───────────────────────────────────────────

const written: Record<string, unknown> = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

const after = {
  feedback:    Array.isArray(written.feedback)    ? (written.feedback as unknown[]).length    : 0,
  events:      Array.isArray(written.events)      ? (written.events as unknown[]).length      : 0,
  sessions:    Array.isArray(written.sessions)    ? (written.sessions as unknown[]).length    : 0,
  scanRecords: Array.isArray(written.scanRecords) ? (written.scanRecords as unknown[]).length : 0,
};

console.log("✅  Reset complete. Counts AFTER:");
console.log(`    feedback[]    : ${after.feedback} entries`);
console.log(`    events[]      : ${after.events} entries`);
console.log(`    sessions[]    : ${after.sessions} entries`);
console.log(`    scanRecords[] : ${after.scanRecords} entries`);
console.log("");

const sc = written.scanCounter as { dateKey?: string; count?: number } | undefined;
console.log("🔒  Preserved (unchanged):");
console.log(`    scanCounter   : { dateKey: "${sc?.dateKey ?? ""}", count: ${sc?.count ?? 0} }`);
console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  FlipStart Founder Dashboard will now start clean.");
console.log("  Analytics will accumulate real user data from here.");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
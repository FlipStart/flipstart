/**
 * lib/hunt-context.tsx
 *
 * The live Hunt session: module-level state (no React context, survives tab
 * switches) that is ALSO saved on the phone, so a hunt survives backgrounding,
 * an app restart and iOS terminating FlipStart.
 *
 * ── Item model ────────────────────────────────────────────────────────────────
 * One HuntItem per scan (huntItemId = `hi_<scanId>`), so a scan can never
 * become two items. `status` is STATE ONLY — changing it never touches the
 * money fields:
 *
 *   pending  → analysed (and charged) but not decided yet. Saved with the hunt
 *              so an app close can't lose it; reopening restores the user to
 *              its Discovery Analysis. Not counted in Scanned / Kept / Removed
 *              and never written into a saved bundle.
 *   kept     → in the haul.
 *   removed  → passed on, recoverable.
 *
 * `kept` (boolean) is kept as a mirror of status === 'kept' for older readers
 * and saved bundles. Fees, profit, ROI and rating always come from
 * lib/huntEconomics (the same engine as normal Analysis) at the item's own
 * thrift price.
 *
 *   kept item     → thriftPrice ≥ $0.01, always (enforced here, not just in UI)
 *   removed item  → keeps whatever price it had; 0 only if it was removed
 *                   before a price was ever entered
 *
 * ── Persistence ───────────────────────────────────────────────────────────────
 * Key: `flipstart_active_hunt:<userId>` — per account, like XP. Rewritten after
 * every change through a queue, so writes land in order. The timer is never
 * stored; duration is always now − startedAt.
 *
 * The record is deleted in exactly two cases:
 *   1. the finished hunt's bundle is confirmed in saved Scan History
 *      (finishHunt marks it, confirmHuntBundlesPersisted / hydration deletes it)
 *   2. the user chooses Leave Hunt (discardHunt)
 * If the app dies after finishHunt but before the bundle reached storage, the
 * next launch finds no bundle and resumes the hunt instead of losing it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScanResult } from './types';
import type { HuntErrorStage } from './analytics';
import {
  huntEconomics, parseThriftPrice, provisionalEconomics,
  type HuntRating,
} from './huntEconomics';
import { isHuntDemoActive, __setHuntDemoActive } from './huntDemoMode';

export type { HuntRating } from './huntEconomics';
export { recLabelToHuntRating } from './huntEconomics';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HuntPhoto { uri: string; label: 'Tag' | 'Detail' }

/**
 * Lightweight sold-comps evidence saved with a Hunt item.
 *
 * `response` is the production comps PUBLIC contract (what SoldCompsSection
 * reads), trimmed to at most 3 cards and with every debug / founder field
 * stripped by lib/huntComps.toCompsSnapshot — never the raw provider data.
 * It survives restart, Hunt completion (copied into the bundle), server cache
 * expiry and redeploys, because nothing on the server is needed to show it.
 */
export interface HuntCompsSnapshot {
  v:           1;
  savedAt:     number;
  analysisId?: string;
  response:    Record<string, unknown>;
}

export type HuntItemStatus = 'pending' | 'kept' | 'removed';

export interface HuntItem {
  huntItemId:     string;       // `hi_<scanId>` — stable, used for route params
  scanId:         string;       // matches ScanResult.id
  analysisId?:    string;       // server analysis id (comps / listings lookups)
  itemName:       string;
  brand:          string;
  category:       string;
  imageUri:       string;       // main photo — hosted URL once uploaded
  allImageUris:   string[];     // kept for older readers; [imageUri]
  extraPhotos?:   HuntPhoto[];  // Tag / Detail, same shape as FlipResult.extraPhotos
  estimatedValue: number;
  thriftPrice:    number;       // ≥ 0.01 when kept; 0 only = never priced (removed)
  fees?:          number;
  profit:         number;
  roi?:           number;
  status:         HuntItemStatus;
  kept:           boolean;      // mirror of status === 'kept' (older readers)
  huntRating:     HuntRating;   // FINAL rating at thriftPrice (provisional if never priced)
  addedAt:        number;
  priceUpdatedAt?: number;
  scanSnapshot:   ScanResult;   // full AI result
  compsSnapshot?: HuntCompsSnapshot;
}

export interface HuntSession {
  id:        string;
  name:      string;
  startedAt: number;
  isActive:  boolean;
  items:     HuntItem[];
}

interface PersistedHunt {
  version:        1;
  ownerId:        string;
  savedAt:        number;
  session:        HuntSession;
  /** Set by finishHunt: the bundle id we are waiting to see in saved history. */
  endedBundleId?: string;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let _activeHunt: HuntSession | null = null;
let _ownerId: string | null = null;
let _hydratedFor: string | null = null;
/** A restore was skipped because the demo was running; exitHuntDemo finishes it. */
let _hydrateDeferred = false;
const _listeners = new Set<() => void>();

function _notify(persist = true) {
  if (persist) _persist();
  _listeners.forEach(fn => { try { fn(); } catch { /* a listener never breaks the hunt */ } });
}

/** Replace the session reference so React subscribers see a change. */
function _touch() {
  if (_activeHunt) _activeHunt = { ..._activeHunt, items: [..._activeHunt.items] };
}

function _statusFields(status: HuntItemStatus): Pick<HuntItem, 'status' | 'kept'> {
  return { status, kept: status === 'kept' };
}

/** An item's status; items saved before statuses existed fall back to `kept`. */
export function itemStatus(i: Pick<HuntItem, 'kept'> & { status?: HuntItemStatus }): HuntItemStatus {
  return i.status ?? (i.kept ? 'kept' : 'removed');
}
export const keptItemsOf    = (s: HuntSession) => s.items.filter(i => itemStatus(i) === 'kept');
export const removedItemsOf = (s: HuntSession) => s.items.filter(i => itemStatus(i) === 'removed');
/** The analysed-but-undecided find, if any (newest first). */
export const pendingItemOf  = (s: HuntSession | null) =>
  s ? s.items.find(i => itemStatus(i) === 'pending') ?? null : null;

// ─── Which mode a scan belongs to ─────────────────────────────────────────────
// A scan goes to the hunt only when the user chose that: every scan from Live
// Hunt, or a Home / tab scan where they picked "Add to Hunt". A hunt merely
// existing (e.g. restored after a restart) never captures a Home scan.

let _scanDestination: 'hunt' | 'normal' = 'normal';

export function setScanDestination(d: 'hunt' | 'normal'): void {
  _scanDestination = d;
}

/** True when the scan in progress belongs to the live hunt. */
export function scanGoesToHunt(): boolean {
  return _scanDestination === 'hunt' && isHuntActive();
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export const ACTIVE_HUNT_KEY = (uid: string) => `flipstart_active_hunt:${uid}`;
/** Must match useFlipStore's per-user key (a test pins the two together). */
export const SAVED_FLIPS_KEY = (uid: string) => `flipstart_flips:${uid}`;

let _writeChain: Promise<void> = Promise.resolve();
let _pendingEndedBundleId: string | null = null;

function _enqueue(op: () => Promise<void>): Promise<void> {
  _writeChain = _writeChain.then(op, op).catch(() => {});
  return _writeChain;
}

// ─── Reliability reporting ────────────────────────────────────────────────────
// A Hunt problem the user never sees still gets counted (stage + hunt id only —
// no message, name or item data), once per stage per hunt so a broken disk
// cannot flood analytics. Analytics is loaded lazily so this module stays free
// of it; tests install a sink instead.
type HuntErrorSink = (stage: HuntErrorStage, huntId: string | null) => void;
let _errorSink: HuntErrorSink | null = null;
const _reportedErrors = new Set<string>();

export function setHuntErrorSink(fn: HuntErrorSink | null): void { _errorSink = fn; }

export function reportHuntError(stage: HuntErrorStage, huntId?: string | null): void {
  if (isHuntDemoActive()) return;                // the demo never reports
  const id = huntId ?? _activeHunt?.id ?? null;
  const key = `${stage}:${id ?? ''}`;
  if (_reportedErrors.has(key)) return;
  _reportedErrors.add(key);
  try {
    if (_errorSink) { _errorSink(stage, id); return; }
    void import('./analytics').then(m => m.logHuntError(stage, id)).catch(() => {});
  } catch { /* reporting never breaks the hunt */ }
}

function _persist(): Promise<void> {
  if (isHuntDemoActive()) return Promise.resolve();   // demo state never reaches the phone
  const owner = _ownerId;
  if (!owner) return Promise.resolve();          // Hunt Mode requires an account
  const session = _activeHunt;
  if (!session) return Promise.resolve();
  const record: PersistedHunt = {
    version: 1, ownerId: owner, savedAt: Date.now(), session,
  };
  return _enqueue(async () => {
    try { await AsyncStorage.setItem(ACTIVE_HUNT_KEY(owner), JSON.stringify(record)); }
    catch (e) { reportHuntError('persist_write', session.id); if (__DEV__) console.warn('[hunt] persist failed', e); }
  });
}

function _deletePersisted(owner: string): Promise<void> {
  return _enqueue(async () => {
    try { await AsyncStorage.removeItem(ACTIVE_HUNT_KEY(owner)); } catch { /* retried next launch */ }
  });
}

/** True when this bundle id is in the saved-history blob. */
function _bundleIsSaved(rawFlips: string | null, bundleId: string): boolean {
  if (!rawFlips) return false;
  try {
    const list = JSON.parse(rawFlips);
    return Array.isArray(list) && list.some((e: any) => e?.type === 'hunt_bundle' && e?.id === bundleId);
  } catch { return false; }
}

/** Old in-memory items (pre-persistence builds) never had fees/roi. */
function _normalizeItem(raw: any): HuntItem | null {
  if (!raw || typeof raw !== 'object' || !raw.scanId || !raw.scanSnapshot) return null;
  return {
    ...raw,
    huntItemId:   raw.huntItemId || `hi_${raw.scanId}`,
    allImageUris: Array.isArray(raw.allImageUris) ? raw.allImageUris : [raw.imageUri].filter(Boolean),
    thriftPrice:  Number.isFinite(raw.thriftPrice) ? raw.thriftPrice : 0,
    profit:       Number.isFinite(raw.profit) ? raw.profit : 0,
    ..._statusFields(raw.status === 'pending' || raw.status === 'kept' || raw.status === 'removed'
      ? raw.status : (raw.kept === true ? 'kept' : 'removed')),
  } as HuntItem;
}

/**
 * Point the hunt at the signed-in account and restore its saved hunt.
 * Call on every auth change (root layout does, alongside setXpUserId).
 * A hunt belonging to another account is dropped from memory, never shown.
 */
export async function setHuntUserId(uid: string | null): Promise<void> {
  if (_ownerId !== uid) {
    _hydratedFor = null;
    _hydrateDeferred = false;
    if (isHuntDemoActive()) __setHuntDemoActive(false);   // a different account never inherits a demo
    if (_activeHunt) {
      _activeHunt = null;             // previous account's hunt stays saved under ITS key
      _notify(false);
    }
  }
  _ownerId = uid;
  if (!uid || _hydratedFor === uid) return;
  _hydratedFor = uid;
  await hydrateActiveHunt(uid);
}

/** Load the saved hunt for this account. Exported for tests. */
export async function hydrateActiveHunt(uid: string): Promise<HuntSession | null> {
  let rec: PersistedHunt | null = null;
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_HUNT_KEY(uid));
    rec = raw ? JSON.parse(raw) as PersistedHunt : null;
  } catch { rec = null; reportHuntError('hydrate_read', null); }
  if (isHuntDemoActive()) {
    // The demo owns the in-memory slot right now. Leave the saved Hunt exactly
    // as it is and load it when the demo ends.
    _hydrateDeferred = true;
    return null;
  }
  if (!rec || rec.version !== 1 || rec.ownerId !== uid || !rec.session?.id) return null;

  if (rec.endedBundleId) {
    // Finished last time. Delete only once the bundle is really in history;
    // otherwise resume so the user can save it again (XP is idempotent per hunt id).
    const flipsRaw = await AsyncStorage.getItem(SAVED_FLIPS_KEY(uid)).catch(() => null);
    if (_bundleIsSaved(flipsRaw, rec.endedBundleId)) {
      await _deletePersisted(uid);
      return null;
    }
  }
  if (_activeHunt) return _activeHunt;           // a hunt started meanwhile wins
  const items = (rec.session.items ?? []).map(_normalizeItem).filter(Boolean) as HuntItem[];
  _activeHunt = { ...rec.session, isActive: true, items };
  _notify();                                     // re-save without the ended marker
  return _activeHunt;
}

/**
 * Called by the flip store after it has written history to the phone. If the
 * hunt we just finished is in there, its active-hunt record can go.
 */
export function confirmHuntBundlesPersisted(savedIds: string[]): void {
  const pending = _pendingEndedBundleId;
  const owner = _ownerId;
  if (!pending || !owner || !savedIds.includes(pending)) return;
  _pendingEndedBundleId = null;
  void _deletePersisted(owner);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startHunt(name?: string): HuntSession {
  _activeHunt = {
    id:        `hunt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name:      name?.trim() || 'Thrift Hunt',
    startedAt: Date.now(),
    isActive:  true,
    items:     [],
  };
  if (!isHuntDemoActive()) _pendingEndedBundleId = null;
  _notify();
  return _activeHunt;
}

export function getActiveHunt(): HuntSession | null {
  return _activeHunt;
}

export function isHuntActive(): boolean {
  return _activeHunt !== null && _activeHunt.isActive;
}

function _baseItem(scan: ScanResult): Omit<HuntItem, 'thriftPrice' | 'fees' | 'profit' | 'roi' | 'huntRating' | 'kept' | 'status'> {
  const id = scan.identification as any;
  const front = scan.imageUri || scan.allImageUris?.[0] || '';
  return {
    huntItemId:     `hi_${scan.id}`,
    scanId:         scan.id,
    analysisId:     id?.v1?.analysisId ?? (scan as any).analysisId ?? undefined,
    itemName:       id?.item_name ?? '',
    brand:          id?.brand ?? '',
    category:       id?.category ?? '',
    imageUri:       front,
    allImageUris:   [front].filter(Boolean),
    estimatedValue: (scan.market_data as any)?.adjusted_estimated_value ?? 0,
    addedAt:        Date.now(),
    scanSnapshot:   scan,
  };
}

export type KeepResult = 'kept' | 'needs_price' | 'no_hunt';

/**
 * Keep a freshly scanned find. A valid thrift price is REQUIRED — without one
 * nothing is saved and 'needs_price' comes back. Re-keeping the same scan
 * updates the one existing item; it never adds a second.
 */
export function keepScanInHunt(scan: ScanResult, priceInput: string | number): KeepResult {
  if (!_activeHunt) return 'no_hunt';
  const price = parseThriftPrice(priceInput);
  if (price === null) return 'needs_price';
  const econ = huntEconomics(scan, price);
  const existing = _activeHunt.items.find(i => i.scanId === scan.id);
  const item: HuntItem = {
    ...(existing ?? _baseItem(scan)),
    thriftPrice: econ.thriftPrice, fees: econ.fees, profit: econ.profit, roi: econ.roi,
    huntRating: econ.huntRating, ..._statusFields('kept'), priceUpdatedAt: Date.now(),
  };
  _upsert(item);
  return 'kept';
}

/**
 * Pass on a freshly scanned find. Any price the user typed is kept with it, so
 * restoring later returns the exact same item. Without a price, the rating is
 * the provisional one (at FlipStart's suggested buy price) — display only.
 */
export function removeScanFromHunt(scan: ScanResult, priceInput?: string | number | null): boolean {
  if (!_activeHunt) return false;
  const price = parseThriftPrice(priceInput ?? null);
  const existing = _activeHunt.items.find(i => i.scanId === scan.id);
  let money: Pick<HuntItem, 'thriftPrice' | 'fees' | 'profit' | 'roi' | 'huntRating'>;
  if (price !== null) {
    const e = huntEconomics(scan, price);
    money = { thriftPrice: e.thriftPrice, fees: e.fees, profit: e.profit, roi: e.roi, huntRating: e.huntRating };
  } else if (existing && existing.thriftPrice > 0) {
    money = { thriftPrice: existing.thriftPrice, fees: existing.fees, profit: existing.profit, roi: existing.roi, huntRating: existing.huntRating };
  } else {
    const p = provisionalEconomics(scan);
    money = { thriftPrice: 0, fees: 0, profit: 0, roi: 0, huntRating: p.huntRating };
  }
  _upsert({ ...(existing ?? _baseItem(scan)), ...money, ..._statusFields('removed'), ...(price !== null ? { priceUpdatedAt: Date.now() } : {}) });
  return true;
}

/**
 * Record a finished hunt scan BEFORE the user decides, so closing the app
 * can't lose a scan that was already analysed and charged. Idempotent per
 * scan: an existing item (pending or decided) is left exactly as it is.
 */
export function addPendingScanToHunt(scan: ScanResult): HuntItem | null {
  if (!_activeHunt || !scan?.id) return null;
  const existing = _activeHunt.items.find(i => i.scanId === scan.id);
  if (existing) return existing;
  const p = provisionalEconomics(scan);
  const item: HuntItem = {
    ..._baseItem(scan),
    thriftPrice: 0, fees: 0, profit: 0, roi: 0, huntRating: p.huntRating,
    ..._statusFields('pending'),
  };
  _upsert(item);
  return item;
}

function _upsert(item: HuntItem) {
  if (!_activeHunt) return;
  const idx = _activeHunt.items.findIndex(i => i.scanId === item.scanId);
  if (idx !== -1) _activeHunt.items[idx] = item;
  else _activeHunt.items.unshift(item);          // newest first
  _touch();
  _notify();
}

/**
 * Change the thrift price of an item already in the hunt (kept or removed).
 * Recomputes fees, profit, ROI and rating with the shared engine. Never adds
 * an item and never changes the scanned count.
 */
export function setHuntItemPrice(huntItemId: string, priceInput: string | number): 'updated' | 'invalid' | 'not_found' {
  if (!_activeHunt) return 'not_found';
  const item = _activeHunt.items.find(i => i.huntItemId === huntItemId);
  if (!item) return 'not_found';
  const price = parseThriftPrice(priceInput);
  if (price === null) return 'invalid';
  const e = huntEconomics(item.scanSnapshot, price);
  Object.assign(item, {
    thriftPrice: e.thriftPrice, fees: e.fees, profit: e.profit, roi: e.roi,
    huntRating: e.huntRating, priceUpdatedAt: Date.now(),
  });
  _touch();
  _notify();
  return 'updated';
}

/** Move a kept item to Removed (swipe in Live Hunt). Money fields untouched. */
export function moveHuntItemToRemoved(scanId: string): void {
  if (!_activeHunt) return;
  const item = _activeHunt.items.find(i => i.scanId === scanId);
  if (!item || itemStatus(item) !== 'kept') return;
  Object.assign(item, _statusFields('removed'));
  _touch();
  _notify();
}

/**
 * Move a removed item back to Kept — the identical item, nothing reset.
 * An item that was removed before it was ever priced can't be kept yet:
 * returns 'needs_price' and changes nothing.
 */
export function restoreHuntItem(huntItemId: string): 'restored' | 'needs_price' | 'not_found' {
  if (!_activeHunt) return 'not_found';
  const item = _activeHunt.items.find(i => i.huntItemId === huntItemId);
  if (!item) return 'not_found';
  if (itemStatus(item) !== 'removed') return 'not_found';
  if (!(item.thriftPrice >= 0.01)) return 'needs_price';
  Object.assign(item, _statusFields('kept'));
  // Front of the list so it shows as the most recent kept find.
  _activeHunt.items = [item, ..._activeHunt.items.filter(i => i.huntItemId !== huntItemId)];
  _touch();
  _notify();
  return 'restored';
}

/** Swap in uploaded photo URLs for an item (by scanId). No-op if it is gone. */
export function setHuntItemPhotos(scanId: string, photos: { imageUri?: string; extraPhotos?: HuntPhoto[] }): void {
  if (!_activeHunt) return;
  const it = _activeHunt.items.find(i => i.scanId === scanId);
  if (!it) return;
  if (photos.imageUri) {
    it.imageUri = photos.imageUri;
    it.allImageUris = [photos.imageUri, ...(it.allImageUris ?? []).slice(1)];
  }
  if (photos.extraPhotos) it.extraPhotos = photos.extraPhotos;
  _touch();
  _notify();
}

/**
 * Save the sold-comps snapshot on an item (any status). Works after the user
 * has already decided, so a search that lands late is never lost. No-op when
 * the item is gone (hunt finished / discarded). Never touches money fields.
 */
export function setHuntItemComps(huntItemId: string, snapshot: HuntCompsSnapshot): boolean {
  if (!_activeHunt) return false;
  const it = _activeHunt.items.find(i => i.huntItemId === huntItemId);
  if (!it) return false;
  it.compsSnapshot = snapshot;
  _touch();
  _notify();
  return true;
}

/** Back-compat alias: main photo only. */
export function updateHuntItemImage(scanId: string, cloudUri: string): void {
  setHuntItemPhotos(scanId, { imageUri: cloudUri });
}

/** Look up a hunt item by its stable huntItemId across kept + removed. */
export function getHuntItemById(huntItemId: string): HuntItem | null {
  if (!_activeHunt) return null;
  return _activeHunt.items.find(i => i.huntItemId === huntItemId) ?? null;
}

/**
 * The hunt was saved as a bundle. Clears it from memory; the saved record
 * stays, marked with the bundle id, until the flip store confirms the bundle
 * is on the phone (confirmHuntBundlesPersisted).
 */
export function finishHunt(bundleId: string): HuntSession | null {
  if (!_activeHunt) return null;
  const ended = { ..._activeHunt, isActive: false };
  if (isHuntDemoActive()) {
    // Nothing is saved, nothing is marked as waiting for history.
    _activeHunt = null;
    _scanDestination = 'normal';
    _notify(false);
    return ended;
  }
  const owner = _ownerId;
  if (owner) {
    const record: PersistedHunt = {
      version: 1, ownerId: owner, savedAt: Date.now(),
      session: { ...ended, isActive: true }, endedBundleId: bundleId,
    };
    void _enqueue(async () => {
      try { await AsyncStorage.setItem(ACTIVE_HUNT_KEY(owner), JSON.stringify(record)); } catch { /* resumes next launch */ }
    });
  }
  _pendingEndedBundleId = bundleId;
  _activeHunt = null;
  _scanDestination = 'normal';
  _notify(false);
  return ended;
}

/** Leave Hunt without saving: forget it everywhere. */
export function discardHunt(): HuntSession | null {
  if (!_activeHunt) return null;
  const ended = { ..._activeHunt, isActive: false };
  if (isHuntDemoActive()) {
    // Leaving the demo must never delete the user's real saved Hunt.
    _activeHunt = null;
    _scanDestination = 'normal';
    _notify(false);
    return ended;
  }
  _activeHunt = null;
  _pendingEndedBundleId = null;
  _scanDestination = 'normal';
  if (_ownerId) void _deletePersisted(_ownerId);
  _notify(false);
  return ended;
}

// ─── Guided demo Hunt ─────────────────────────────────────────────────────────
// The onboarding demo runs on the REAL Hunt screens against throwaway data. It
// borrows the in-memory slot (only when no real Hunt is active), and while it
// does, persistence, analytics, XP, history and uploads are all off (see
// lib/huntDemoMode). Nothing here is ever written to the phone.

export type EnterDemoResult = 'entered' | 'real_hunt_active' | 'already_demo';

export interface DemoSeedEntry {
  scan:        ScanResult;
  thriftPrice: number;
  decision:    'kept' | 'removed';
}

/**
 * Start the demo Hunt. Refuses while a real Hunt is active: the demo must never
 * stand in the way of, or be mixed with, a real one.
 */
export function enterHuntDemo(opts: { name?: string; startedAgoMs?: number; session?: boolean } = {}): EnterDemoResult {
  if (isHuntDemoActive()) return 'already_demo';
  if (_activeHunt) return 'real_hunt_active';
  __setHuntDemoActive(true);
  _scanDestination = 'normal';
  // session:false switches the sandbox on but starts no Hunt yet: the demo opens on
  // the real Hunt start screen, and the Hunt begins when the user taps START HUNT.
  if (opts.session !== false) beginHuntDemoSession(opts);
  else _notify(false);
  return 'entered';
}

/** Start the demo's Hunt (demo mode only, and only when it has none). */
export function beginHuntDemoSession(opts: { name?: string; startedAgoMs?: number } = {}): HuntSession | null {
  if (!isHuntDemoActive() || _activeHunt) return _activeHunt;
  _activeHunt = {
    id:        `demo_hunt_${Date.now()}`,
    name:      opts.name?.trim() || 'Demo Hunt',
    startedAt: Date.now() - Math.max(0, opts.startedAgoMs ?? 0),
    isActive:  true,
    items:     [],
  };
  _notify(false);
  return _activeHunt;
}

/** Make the demo Hunt look like it has been running for `agoMs` (demo mode only). */
export function setHuntDemoElapsed(agoMs: number): void {
  if (!isHuntDemoActive() || !_activeHunt) return;
  _activeHunt = { ..._activeHunt, startedAt: Date.now() - Math.max(0, agoMs) };
  _notify(false);
}

/**
 * Add already-decided items to the demo Hunt through the SAME keep / remove
 * functions a real Hunt uses, so their shape, money and rating can never drift
 * from the product. Only works while the demo is running.
 */
export function seedHuntDemoItems(entries: DemoSeedEntry[]): void {
  if (!isHuntDemoActive() || !_activeHunt) return;
  for (const e of entries) {
    if (e.decision === 'kept') keepScanInHunt(e.scan, e.thriftPrice);
    else removeScanFromHunt(e.scan, e.thriftPrice);
  }
}

/**
 * Throw the demo away. The saved Hunt (if any) was never touched; a restore
 * that was skipped while the demo ran happens now.
 */
export function exitHuntDemo(): void {
  if (!isHuntDemoActive()) return;
  __setHuntDemoActive(false);
  _activeHunt = null;
  _scanDestination = 'normal';
  _huntItemDetailReturnPending = false;
  _notify(false);
  if (_hydrateDeferred && _ownerId) {
    _hydrateDeferred = false;
    void hydrateActiveHunt(_ownerId);
  }
}

/** @deprecated use finishHunt(bundleId) or discardHunt(). Kept for old call sites. */
export function endHunt(): HuntSession | null {
  return discardHunt();
}

export function subscribeToHunt(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Resolves once every queued write has finished. Tests and the save flow use it. */
export function flushHuntPersistence(): Promise<void> {
  return _writeChain;
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

/**
 * scanned = kept + removed. Price edits and restores never change it. A
 * pending (undecided) find is reported separately and counts once decided.
 */
export function getHuntStats(session: HuntSession) {
  const kept    = keptItemsOf(session);
  const removed = removedItemsOf(session);
  const profit  = kept.reduce((s, i) => s + (i.profit ?? 0), 0);
  const cost    = kept.reduce((s, i) => s + (i.thriftPrice ?? 0), 0);
  return {
    scanned:         kept.length + removed.length,
    kept:            kept.length,
    passed:          removed.length,
    pending:         session.items.length - kept.length - removed.length,
    estimatedProfit: Math.round(profit),
    totalCost:       Math.round(cost * 100) / 100,
  };
}

// ─── Hunt Item Detail → Live Hunt return intent flag ──────────────────────────

let _huntItemDetailReturnPending = false;

export function markReturningFromHuntItemDetail(): void {
  _huntItemDetailReturnPending = true;
}

export function consumeReturningFromHuntItemDetail(): boolean {
  const was = _huntItemDetailReturnPending;
  _huntItemDetailReturnPending = false;
  return was;
}

// ─── Restoring an undecided find after a restart ──────────────────────────────

let _pendingRestoreDone = false;

/**
 * True exactly once per app launch, when the restored hunt has an analysed
 * find still waiting for Keep / Remove. Home uses it to take the user straight
 * back to that Discovery Analysis (via Live Hunt) — no new scan, no new charge.
 */
export function shouldRestorePendingFind(): boolean {
  if (isHuntDemoActive()) return false;          // never spend the once-per-launch restore on demo data
  if (_pendingRestoreDone) return false;
  if (!isHuntActive() || !pendingItemOf(_activeHunt)) return false;
  _pendingRestoreDone = true;
  return true;
}

/** Test seam. */
export function __resetHuntForTests(): void {
  __setHuntDemoActive(false); _hydrateDeferred = false;
  _pendingRestoreDone = false;
  _activeHunt = null; _ownerId = null; _hydratedFor = null;
  _pendingEndedBundleId = null; _writeChain = Promise.resolve();
  _scanDestination = 'normal';
  _listeners.clear();
  _reportedErrors.clear(); _errorSink = null;
}
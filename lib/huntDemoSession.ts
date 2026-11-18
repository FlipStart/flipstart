/**
 * lib/huntDemoSession.ts
 *
 * The control surface the guided demo uses. It owns no state of its own: it
 * switches the sandbox on and off (lib/huntDemoMode via lib/hunt-context),
 * builds the canned scans, and produces the finish result, all in memory.
 *
 * Everything that could escape the sandbox is closed at the place it would
 * happen (see lib/huntDemoMode). Nothing in this file writes to storage, the
 * network, XP, saved history or analytics.
 */
import {
    enterHuntDemo, exitHuntDemo, seedHuntDemoItems, finishHunt, getActiveHunt,
    keptItemsOf, removedItemsOf, beginHuntDemoSession, setHuntDemoElapsed,
    type EnterDemoResult, type HuntItem,
  } from '@/lib/hunt-context';
  import { isHuntDemoActive, setHuntDemoBundle, getHuntDemoBundle, clearHuntDemoBundle, setHuntDemoXp } from '@/lib/huntDemoMode';
  import { applyHuntXp, setLastCompletionResult, consumeLastCompletionResult, type HuntXpResult } from '@/lib/huntXp';
  import {
    DEMO_JACKET, DEMO_POLO, DEMO_PREFILL_KEPT, DEMO_PREFILL_REMOVED,
    buildDemoScan, DEMO_HUNT_MINUTES, type DemoItemSeed,
  } from '@/lib/huntDemoData';
  import { stopCoach } from '@/lib/huntDemoCoach';
  import type { ScanResult } from '@/lib/types';
  import type { HuntBundle, HuntBundleItem } from '@/types/flip';
  
  /** Photo key → displayable URI. The app passes demoPhotoUri; tests pass nothing. */
  export type DemoPhotoResolver = (key?: string) => string;
  const noPhotos: DemoPhotoResolver = () => '';
  
  /** How long the made-up Hunt appears to have been running (a believable first hour). */
  const DEMO_STARTED_AGO_MS = DEMO_HUNT_MINUTES * 60_000;
  
  export type StartDemoResult = EnterDemoResult;
  
  /**
   * Begin the demo. Refuses while a real Hunt is active so the two can never mix.
   * Starts empty: the walkthrough decides when the prefilled haul appears.
   */
  export function startDemoHunt(): StartDemoResult {
    return enterHuntDemo({ name: 'Demo Hunt', startedAgoMs: DEMO_STARTED_AGO_MS });
  }
  
  /**
   * Switch the sandbox on WITHOUT starting a Hunt, so the demo can open on the real
   * Hunt start screen (a running Hunt would redirect it to Live Hunt).
   */
  export function enterDemoMode(): StartDemoResult {
    return enterHuntDemo({ session: false });
  }
  
  /** The user tapped START HUNT in the demo: begin the (empty) demo Hunt. */
  export function beginDemoHuntSession(name?: string): void {
    beginHuntDemoSession({ name: name?.trim() || 'Demo Hunt' });
  }
  
  /** The demo's find for a given step. Same canned scan the camera "finds". */
  export type DemoFindKey = 'jacket' | 'polo';
  
  /**
   * The established-Hunt moment: the rest of the haul appears (3 kept, 2 passed) and
   * the clock reads like a real trip. Idempotent.
   */
  export function applyDemoPrefill(photo: DemoPhotoResolver = noPhotos): void {
    const h = getActiveHunt();
    if (!h || h.items.some(i => i.scanId === DEMO_PREFILL_KEPT[0].id)) return;
    seedDemoPrefill(photo);
    setHuntDemoElapsed(DEMO_STARTED_AGO_MS);
  }
  
  /** The thrift price the demo uses for a find (the tag the coach tells the user to enter). */
  export function demoPriceFor(scanId: string): number | null {
    const seed = [DEMO_JACKET, DEMO_POLO].find(s => s.id === scanId);
    return seed ? seed.thriftPrice : null;
  }
  
  /** The scan the demo camera "finds". Same shape as a real analysed scan. */
  export function demoScanFor(which: 'jacket' | 'polo', photo: DemoPhotoResolver = noPhotos): ScanResult {
    const seed = which === 'jacket' ? DEMO_JACKET : DEMO_POLO;
    return buildDemoScan(seed, photo(seed.photoKey));
  }
  
  /** Put the already-decided finds in the haul (3 kept, 2 passed) via the real keep/remove path. */
  export function seedDemoPrefill(photo: DemoPhotoResolver = noPhotos): void {
    const toEntry = (seed: DemoItemSeed, decision: 'kept' | 'removed') => ({
      scan: buildDemoScan(seed, photo(seed.photoKey)),
      thriftPrice: seed.thriftPrice,
      decision,
    });
    seedHuntDemoItems([
      ...DEMO_PREFILL_KEPT.map(s => toEntry(s, 'kept')),
      ...DEMO_PREFILL_REMOVED.map(s => toEntry(s, 'removed')),
    ]);
  }
  
  function toBundleItem(i: HuntItem, kept: boolean): HuntBundleItem {
    return {
      huntItemId: i.huntItemId, scanId: i.scanId, itemName: i.itemName, brand: i.brand,
      category: i.category, imageUri: i.imageUri, thriftPrice: i.thriftPrice, profit: i.profit,
      huntRating: i.huntRating, kept, scanSnapshot: i.scanSnapshot,
      ...(i.allImageUris?.length ? { allImageUris: i.allImageUris } : {}),
      ...(typeof i.fees === 'number' ? { fees: i.fees } : {}),
    };
  }
  
  /**
   * "Finish Hunt" in the demo. Builds the bundle the completion screens read, scores
   * it with the real XP rules against a brand-new profile, and keeps both in memory.
   * Nothing is saved, synced or awarded. Returns null outside the demo.
   */
  export async function finishDemoHunt(): Promise<{ bundle: HuntBundle; xp: HuntXpResult } | null> {
    if (!isHuntDemoActive()) return null;
    const hunt = getActiveHunt();
    if (!hunt) return null;
    const now = Date.now();
    const keptItems = keptItemsOf(hunt).map(i => toBundleItem(i, true));
    const removedItems = removedItemsOf(hunt).map(i => toBundleItem(i, false));
    const totalCost = Math.round(keptItems.reduce((s, i) => s + i.thriftPrice, 0) * 100) / 100;
    const totalProfit = keptItems.reduce((s, i) => s + i.profit, 0);
    const base: HuntBundle = {
      type: 'hunt_bundle', id: hunt.id, huntTitle: hunt.name, timestamp: now,
      startedAt: hunt.startedAt, endedAt: now, durationMs: now - hunt.startedAt,
      keptItems, removedItems, keptItemCount: keptItems.length, removedItemCount: removedItems.length,
      totalCost, totalEstimatedProfit: totalProfit,
      estimatedROI: totalCost > 0 ? Math.round((totalProfit / totalCost) * 100) : 0,
    };
    const xp = await applyHuntXp(base);                  // demo branch: pure, saves nothing
    const bundle: HuntBundle = { ...base, xpEarned: xp.totalXpEarned, xpBreakdown: xp.breakdown };
    setHuntDemoBundle(bundle);
    setHuntDemoXp(xp);                                   // the results screen reads it back
    setLastCompletionResult(xp);
    finishHunt(bundle.id);                               // demo branch: clears memory only
    return { bundle, xp };
  }
  
  /** The finished demo bundle, for the completion screens. null outside the demo. */
  export function getDemoBundle(id?: string | null): HuntBundle | null {
    return isHuntDemoActive() ? getHuntDemoBundle<HuntBundle>(id) : null;
  }
  
  /** Leave the demo for any reason (finish, Exit Demo, back out). Real state returns untouched. */
  export function endDemoHunt(): void {
    stopCoach();
    consumeLastCompletionResult();
    clearHuntDemoBundle();
    exitHuntDemo();
  }
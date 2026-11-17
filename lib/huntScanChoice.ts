/**
 * lib/huntScanChoice.ts
 *
 * A Home or tab-bar scan while a hunt is running asks which mode it belongs
 * to — it is never silently pulled into the hunt just because one exists
 * (for example one restored after an app restart).
 *
 *   Hunt in progress
 *   Add this scan to "Bins #2"?
 *   [Add to Hunt]  [Scan Normally]  [Cancel]
 *
 * Scans started from Live Hunt don't ask: they always belong to the hunt.
 */
import { Alert } from 'react-native';
import { getActiveHunt, isHuntActive, setScanDestination } from './hunt-context';
import { logEvent } from './analytics';

export function chooseScanDestination(proceed: () => void, origin: 'home' | 'tab'): void {
  const hunt = getActiveHunt();
  if (!hunt || !isHuntActive()) {
    setScanDestination('normal');
    proceed();
    return;
  }
  const pick = (dest: 'hunt' | 'normal') => {
    setScanDestination(dest);
    try { logEvent('hunt_scan_destination_chosen', { hunt_id: hunt.id, choice: dest, origin }); } catch {}
    proceed();
  };
  Alert.alert(
    'Hunt in progress',
    `Add this scan to “${hunt.name || 'Thrift Hunt'}”?`,
    [
      { text: 'Add to Hunt',   onPress: () => pick('hunt') },
      { text: 'Scan Normally', onPress: () => pick('normal') },
      { text: 'Cancel', style: 'cancel' },
    ],
    { cancelable: true },
  );
}
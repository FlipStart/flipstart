/**
 * useAfterModalClose
 *
 * A native modal (react-native <Modal>) on iOS is still sliding away for a moment after it is
 * told to close. A screen change made in that moment can be dropped or garbled by iOS, so the
 * button the user pressed appears to do nothing. This runs the follow-up work once the modal is
 * actually gone: wire `onDismiss` on the <Modal> to `run`, and call `closeThen(close, fn)` from the
 * button. On Android there is no such gap, so `fn` runs straight away. A timer is the safety net
 * for the case where iOS never reports the dismissal, so the follow-up always runs, exactly once.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const SAFETY_MS = 700;

export function useAfterModalClose() {
  const fnRef    = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const run = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const fn = fnRef.current;
    fnRef.current = null;
    fn?.();
  }, []);

  const closeThen = useCallback((close: () => void, fn: () => void) => {
    close();
    if (Platform.OS !== 'ios') { fn(); return; }
    fnRef.current = fn;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(run, SAFETY_MS);
  }, [run]);

  return { run, closeThen };
}
/**
 * Module-level store for a photo captured via the tab bar's center scan button.
 *
 * The tab bar (_layout.tsx) captures a photo and stores it here.
 * The home screen (index.tsx) checks for it on focus via useFocusEffect,
 * then shows the photo review flow as if the user tapped "Scan Item".
 *
 * This avoids passing large base64 data through navigation params.
 */

export interface PendingCapture {
    uri: string;
    base64: string;
    mimeType: string;
  }
  
  let _capture: PendingCapture | null = null;
  
  export function setPendingCapture(data: PendingCapture): void {
    _capture = data;
  }
  
  export function consumePendingCapture(): PendingCapture | null {
    const data = _capture;
    _capture = null;
    return data;
  }
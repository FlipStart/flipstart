/**
 * components/comps/tokens.ts
 *
 * Shared tokens and formatters for the Sold Comps section.
 *
 * Extracted so the components below and app/results.tsx cannot drift apart on
 * colour, and so currency formatting lives in exactly one place. The previous
 * inline version hardcoded a `$` in three separate spots, which silently
 * mislabels a GBP or EUR comp.
 */
export const C = {
    bg:      '#FFFFFF',
    card:    '#FFFEFA',
    cardB:   '#DDD2AC',
    forest:  '#2A4A2A',
    brown:   '#5A3A1A',
    muted:   '#8A7050',
    gold:    '#BE9C2C',
    cream:   '#F4EED8',
    /** Sold prices only. Deliberately brighter than FOREST so a completed sale
     *  reads as the most positive number on the card without shouting. */
    soldGreen: '#1E7A34',
    amber:   '#8A5A1A',
    placeholder: '#EFE8D0',
  } as const;
  
  /** Cards are square-ish so items stay comparable at a glance. */
  export const CARD_RADIUS = 14;
  export const IMAGE_RATIO = 1;
  
  const SYMBOL: Record<string, string> = {
    USD: '$', GBP: '£', EUR: '€', CAD: 'C$', AUD: 'A$', JPY: '¥',
  };
  
  /**
   * Currency-aware money formatting.
   *
   * Drops cents when the amount is whole — "$30" reads better than "$30.00" on a
   * card — but keeps them when they exist, because $29.99 and $30 are different
   * numbers and rounding one into the other misreports a real sale.
   *
   * An unknown currency gets its ISO code rather than a wrong symbol.
   */
  export function formatMoney(amount: number, currency = 'USD'): string {
    if (!Number.isFinite(amount)) return '—';
    const sym = SYMBOL[currency.toUpperCase()];
    const whole = Math.abs(amount % 1) < 0.005;
    const n = whole ? String(Math.round(amount)) : amount.toFixed(2);
    return sym ? `${sym}${n}` : `${n} ${currency.toUpperCase()}`;
  }
  
  /** "Sold Jul 28". Returns null rather than inventing a date. */
  export function formatSoldDate(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  
  export const MARKETPLACE_LABEL: Record<string, string> = {
    ebay: 'eBay', depop: 'Depop', poshmark: 'Poshmark',
    mercari: 'Mercari', vinted: 'Vinted',
  };
  
  /** Honest label. Unknown stays unknown rather than defaulting to eBay. */
  export function marketplaceLabel(key: string | null | undefined): string | null {
    if (!key) return null;
    return MARKETPLACE_LABEL[key.toLowerCase()] ?? null;
  }
  
  export type ConfidenceLabel = 'high' | 'moderate' | 'low' | 'insufficient';
  
  /**
   * Confidence colour.
   *
   * Low is amber, never red. A low-confidence comp set is ordinary information —
   * most thrift items have thin sold data — and red would read as a malfunction.
   */
  export function confidenceColor(label: ConfidenceLabel | null): string {
    switch (label) {
      case 'high':     return C.forest;
      case 'moderate': return C.gold;
      case 'low':      return C.amber;
      default:         return C.muted;
    }
  }
  
  export function confidenceText(label: ConfidenceLabel | null, percent: number | null): string {
    if (!label || label === 'insufficient') return 'Insufficient match';
    const word = label === 'high' ? 'High' : label === 'moderate' ? 'Moderate' : 'Low';
    return typeof percent === 'number' ? `${word} confidence · ${percent}%` : `${word} confidence`;
  }
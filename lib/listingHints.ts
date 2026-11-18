/**
 * lib/listingHints.ts
 *
 * What the app tells the server about a scan when asking for listings.
 *
 * The server prefers its own stored analysis (looked up by analysisId). These
 * hints are only its fallback for scans older than that store keeps, so a
 * listing for an old scan still gets the real size, fit and condition instead
 * of "size not provided".
 */
export interface ListingRequestExtras {
  scannerId?: string;
  analysisId?: string;
  hints?: {
    eraStatus?: string;
    productionDecade?: string;
    styleEra?: string;
    sizeLabel?: string;
    targetDepartment?: string;
    primaryColor?: string;
    obviousDamage?: string[];
    assessmentLimited?: boolean;
    /** What is printed / embroidered on the item, so the listing can name it. */
    design?: string[];
  };
}

const str = (v: unknown, max: number): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : undefined;
};

/** Builds the extras from a scan's canonical V1 passthrough (any shape-safe). */
export function listingExtras(v1: any, scannerId?: string | null, analysisId?: string | null): ListingRequestExtras {
  const damage = Array.isArray(v1?.obviousDamage)
    ? v1.obviousDamage.filter((d: unknown) => typeof d === 'string' && d.trim()).slice(0, 5).map((d: string) => d.slice(0, 80))
    : undefined;
  // The named thing first, then what the photos showed.
  const design = v1
    ? [v1.characterOrLicense, v1.artist, v1.team, v1.event, v1.subject, ...(Array.isArray(v1.designNotes) ? v1.designNotes : [])]
        .map((d: unknown) => str(d, 110))
        .filter((d): d is string => !!d)
        .filter((d, i, a) => a.indexOf(d) === i)
        .slice(0, 4)
    : [];
  return {
    scannerId: str(scannerId, 200),
    analysisId: str(analysisId ?? v1?.analysisId, 200),
    hints: v1 ? {
      eraStatus:         str(v1.eraStatus, 40),
      productionDecade:  str(v1.productionDecade, 20),
      styleEra:          str(v1.styleEra, 20),
      sizeLabel:         str(v1.sizeLabel, 24),
      targetDepartment:  str(v1.targetDepartment, 20),
      primaryColor:      str(v1.primaryColor, 40),
      obviousDamage:     damage && damage.length ? damage : undefined,
      assessmentLimited: typeof v1.assessmentLimited === 'boolean' ? v1.assessmentLimited : undefined,
      design:            design.length ? design : undefined,
    } : undefined,
  };
}
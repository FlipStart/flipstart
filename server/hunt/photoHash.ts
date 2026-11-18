/**
 * server/hunt/photoHash.ts
 *
 * A 64-bit "difference hash" of a photo: shrink it to 9x8 grey pixels and record,
 * for each of the 64 neighbouring pairs, whether the left one is brighter. Two
 * copies of the same image (re-saved, re-compressed, slightly resized) differ in
 * a handful of bits; two different photos differ in about half of them.
 *
 * Hunt XP uses it to spot the same image being scanned again, by one account or
 * by several. It is evidence, not proof: a fresh photo of the same item has a
 * different hash, which is why repeats are also compared by item (itemKey).
 *
 * sharp is loaded lazily and optionally. If it is missing or a photo cannot be
 * decoded the hash is null, and the evidence gate treats "no hash" as "could not
 * check" (big finds stay capped) rather than as a pass.
 */

export interface PhotoHash {
    hex:   string;                         // 16 hex characters
    bands: [number, number, number, number];   // the four 16-bit quarters, for indexed lookups
  }
  
  type SharpFactory = (input: Buffer) => {
    greyscale(): any; resize(w: number, h: number, o: Record<string, unknown>): any;
  };
  
  let sharpLoad: Promise<SharpFactory | null> | null = null;
  async function loadSharp(): Promise<SharpFactory | null> {
    if (!sharpLoad) {
      sharpLoad = import("sharp")
        .then(m => ((m as any).default ?? m) as SharpFactory)
        .catch(err => {
          console.error("[hunt] sharp is not available, photo hashes are OFF (big finds stay capped):",
            err instanceof Error ? err.message : err);
          return null;
        });
    }
    return sharpLoad;
  }
  
  /** The four 16-bit quarters of a 16-character hex hash. */
  export function bandsOf(hex: string): [number, number, number, number] {
    return [0, 4, 8, 12].map(i => parseInt(hex.slice(i, i + 4), 16)) as [number, number, number, number];
  }
  
  const POP = (() => { const t = new Uint8Array(65536); for (let i = 1; i < 65536; i++) t[i] = t[i >> 1] + (i & 1); return t; })();
  
  /** Bits that differ between two hashes (0-64). 64 when either is malformed. */
  export function hamming(a: string | null | undefined, b: string | null | undefined): number {
    if (!a || !b || a.length !== 16 || b.length !== 16) return 64;
    let d = 0;
    for (let i = 0; i < 16; i += 4) {
      const x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
      if (Number.isNaN(x)) return 64;
      d += POP[x];
    }
    return d;
  }
  
  /** Hash from 72 grey pixels (9 wide, 8 tall, row by row). Exported for tests. */
  export function dhashFromGrey(px: ArrayLike<number>): string {
    let hex = "";
    for (let row = 0; row < 8; row++) {
      let byte = 0;
      for (let col = 0; col < 8; col++) {
        const i = row * 9 + col;
        byte = (byte << 1) | (px[i] > px[i + 1] ? 1 : 0);
      }
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  }
  
  /** Hash a base64 photo (no data: prefix). null when it cannot be computed. Never throws. */
  export async function hashPhoto(base64: string | null | undefined): Promise<PhotoHash | null> {
    if (!base64) return null;
    try {
      const sharp = await loadSharp();
      if (!sharp) return null;
      const { data } = await sharp(Buffer.from(base64, "base64"))
        .greyscale()
        .resize(9, 8, { fit: "fill", kernel: "lanczos3" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (!data || data.length < 72) return null;
      const hex = dhashFromGrey(data);
      return { hex, bands: bandsOf(hex) };
    } catch (err) {
      console.warn("[hunt] photo hash failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }
/**
 * __tests__/version/app-version.test.ts
 *
 * The comparator behind the force-update gate.
 *
 * These decide whether a real user is locked out of the app, so they are
 * exhaustive about the boring parts: numeric ordering, unequal segment counts,
 * and every shape of malformed input.
 */
import { describe, expect, it } from "vitest";
import { parseVersion, compareVersions, isBelowMinimum } from "@/lib/appVersion";

describe("parseVersion", () => {
  it("accepts dotted numerics of any length", () => {
    expect(parseVersion("2")).toEqual([2]);
    expect(parseVersion("2.1")).toEqual([2, 1]);
    expect(parseVersion("2.1.3")).toEqual([2, 1, 3]);
    expect(parseVersion("10.20.30")).toEqual([10, 20, 30]);
    expect(parseVersion(" 2.1 ")).toEqual([2, 1]);
  });

  it("returns null for anything it cannot be sure about", () => {
    for (const bad of ["", "  ", "v2.1", "2.1-beta", "2.1.x", "2..1", "2.", ".1",
                       "abc", "2,1", null, undefined, 21 as unknown as string]) {
      expect(parseVersion(bad as string), String(bad)).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  it("compares segments as numbers, not text", () => {
    // The classic failure: "2.10" sorts below "2.9" as a string.
    expect(compareVersions([2, 10], [2, 9])).toBe(1);
    expect(compareVersions([2, 9], [2, 10])).toBe(-1);
    expect(compareVersions([10, 0], [9, 99])).toBe(1);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions([2, 1], [2, 1, 0])).toBe(0);
    expect(compareVersions([2, 1], [2, 1, 1])).toBe(-1);
    expect(compareVersions([2, 1, 0], [2, 1])).toBe(0);
    expect(compareVersions([3], [2, 9, 9])).toBe(1);
  });

  it("is symmetric", () => {
    const pairs: Array<[number[], number[]]> = [
      [[2, 1], [2, 2]], [[2, 1], [2, 1]], [[3, 0], [2, 9]], [[2, 1], [2, 1, 0]],
    ];
    for (const [a, b] of pairs) {
      // Summed rather than negated: -0 !== 0 under Object.is, which toBe uses.
      expect(compareVersions(a, b) + compareVersions(b, a), `${a} / ${b}`).toBe(0);
    }
  });
});

describe("isBelowMinimum — the lockout decision", () => {
  it("blocks only a genuinely older version", () => {
    expect(isBelowMinimum("2.0", "2.1")).toBe(true);
    expect(isBelowMinimum("2.0.9", "2.1")).toBe(true);
    expect(isBelowMinimum("1.9.9", "2.0")).toBe(true);
  });

  it("does not block the exact minimum", () => {
    // Launch day: shipping 2.1 with a minimum of 2.1 must gate nobody.
    expect(isBelowMinimum("2.1", "2.1")).toBe(false);
    expect(isBelowMinimum("2.1.0", "2.1")).toBe(false);
    expect(isBelowMinimum("2.1", "2.1.0")).toBe(false);
  });

  it("does not block a newer version", () => {
    expect(isBelowMinimum("2.2", "2.1")).toBe(false);
    expect(isBelowMinimum("2.10", "2.9")).toBe(false);   // numeric, not textual
    expect(isBelowMinimum("3.0", "2.9.9")).toBe(false);
  });

  it("FAILS OPEN on every unparseable input", () => {
    // Each of these would lock out an install base if it returned true.
    for (const [installed, minimum] of [
      ["2.1-beta", "2.2"], ["", "2.2"], [null, "2.2"], [undefined, "2.2"],
      ["2.1", "2.2-rc"], ["2.1", ""], ["2.1", null], ["2.1", undefined],
      ["garbage", "garbage"],
    ] as Array<[string | null | undefined, string | null | undefined]>) {
      expect(isBelowMinimum(installed, minimum), `${installed} / ${minimum}`).toBe(false);
    }
  });
});
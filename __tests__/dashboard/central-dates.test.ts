import { describe, expect, it } from "vitest";
import * as D from "../../server/dashboardDates";
describe("central dates", () => {
  it("maps an evening Central instant to the local day, not the UTC one", () => {
    // 2026-09-20 19:00 Central == 2026-09-21 00:00 UTC
    expect(D.centralDay("2026-09-21T00:00:00Z")).toBe("2026-09-20");
    expect(D.centralDay("2026-09-21T05:00:00Z")).toBe("2026-09-21");
  });
  it("single day is a full 24h in CDT", () => {
    const r = D.centralRangeUtc("2026-09-20", "2026-09-20")!;
    expect((r.endMs - r.startMs) / 3_600_000).toBe(24);
    expect(new Date(r.startMs).toISOString()).toBe("2026-09-20T05:00:00.000Z");
  });
  it("spring forward is 23 hours", () => {
    const r = D.centralRangeUtc("2026-03-08", "2026-03-08")!;
    expect((r.endMs - r.startMs) / 3_600_000).toBe(23);
  });
  it("fall back is 25 hours", () => {
    const r = D.centralRangeUtc("2026-11-01", "2026-11-01")!;
    expect((r.endMs - r.startMs) / 3_600_000).toBe(25);
  });
  it("addCentralDays crosses DST correctly", () => {
    expect(D.addCentralDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(D.addCentralDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(D.addCentralDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(D.addCentralDays("2026-09-20", -7)).toBe("2026-09-13");
  });
  it("counts inclusive days", () => {
    expect(D.centralDaysBetween("2026-09-20", "2026-09-20")).toBe(1);
    expect(D.centralDaysBetween("2026-09-14", "2026-09-20")).toBe(7);
  });
  it("is safe on garbage", () => {
    expect(D.centralDay("nonsense")).toBe("");
    expect(D.centralDay(null)).toBe("");
    expect(D.centralRangeUtc("2026-13-99", "2026-09-20")).toBeNull();
  });
  it("formats a label", () => { expect(D.formatDayLabel("2026-09-20")).toBe("Sep 20, 2026"); });
});
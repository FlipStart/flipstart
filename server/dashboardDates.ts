/**
 * server/dashboardDates.ts
 *
 * The Founder Dashboard's one clock and one calendar.
 *
 * ── Why Central, and why everywhere ─────────────────────────────────────────
 * The dashboard is read by one person in St. Charles, Illinois, who thinks in
 * local calendar days: "how did the campaign do on the 20th?" A UTC dashboard
 * answers a different question, because 7pm Central on the 20th is already the
 * 21st in UTC — an evening TikTok post would land on the wrong day.
 *
 * Every day-based metric goes through here. Half-converting would be worse
 * than leaving it UTC: retention anchored on UTC days while the date filter
 * used Central days would quietly disagree, and nothing on screen would say so.
 *
 * ── No dependency ───────────────────────────────────────────────────────────
 * Intl carries the IANA database, so DST is handled by the platform rather
 * than by arithmetic we would have to maintain. America/Chicago shifts twice a
 * year and the boundary days are 23 and 25 hours long; the helpers below are
 * written so that is never assumed away.
 */

export const DASHBOARD_TZ = "America/Chicago";
export const DASHBOARD_TZ_LABEL = "Central Time";

/** en-CA formats as YYYY-MM-DD, which is the shape every key here uses. */
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DASHBOARD_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

/** Parts of an instant, as seen in Central. */
const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DASHBOARD_TZ, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/**
 * The Central calendar day containing an instant, as "YYYY-MM-DD".
 *
 * Accepts an ISO string or a Date. Returns "" for anything unparseable rather
 * than throwing, because this runs over raw database rows and one malformed
 * timestamp must not take down the dashboard.
 */
export function centralDay(value: string | Date | null | undefined): string {
  if (!value) return "";
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(t)) return "";
  return dayFmt.format(new Date(t));
}

/** Central offset in minutes at a given instant (e.g. -300 CDT, -360 CST). */
function offsetMinutesAt(t: number): number {
  const p = partsFmt.formatToParts(new Date(t));
  const get = (type: string) => Number(p.find(x => x.type === type)?.value);
  // The same wall-clock reading, interpreted as if it were UTC.
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asUtc - Math.floor(t / 1000) * 1000) / 60_000;
}

/**
 * The UTC instant of midnight starting a Central calendar day.
 *
 * Two passes: guess using UTC midnight, measure the real offset at that guess,
 * then correct. A second measurement catches the rare case where the guess and
 * the answer sit on opposite sides of a DST transition — the spring-forward
 * day has no 02:00 at all, and the fall-back day has 01:00 twice.
 */
export function centralDayStartUtc(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const base = Date.parse(day + "T00:00:00Z");
  if (!Number.isFinite(base)) return null;
  /**
   * Reject dates that do not exist.
   *
   * Date.parse ROLLS OVER rather than failing: "2026-02-31" silently becomes
   * March 3rd. Left alone, a typo would return a real window for a date the
   * user never chose — the exact silent reinterpretation this must avoid.
   * Round-tripping the parse catches it.
   */
  const d = new Date(base);
  const roundTrip = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  if (roundTrip !== day) return null;
  let t = base - offsetMinutesAt(base) * 60_000;
  const check = offsetMinutesAt(t);
  const t2 = base - check * 60_000;
  if (t2 !== t) t = t2;
  // If the nominal midnight does not exist (spring forward), step forward to
  // the first instant that IS on this day rather than returning the day before.
  if (centralDay(new Date(t)) !== day) {
    for (let add = 1; add <= 4; add++) {
      const cand = t + add * 3_600_000;
      if (centralDay(new Date(cand)) === day) return cand;
    }
  }
  return t;
}

/**
 * Half-open [start, end) in UTC milliseconds for an inclusive range of Central
 * calendar days.
 *
 * Half-open on purpose: "<= 23:59:59.999" drops the final millisecond and
 * breaks differently depending on the precision of whatever is being compared.
 * `from = to` yields that entire single day, which is what picking one date on
 * a calendar means.
 */
export function centralRangeUtc(fromDay: string, toDay: string): { startMs: number; endMs: number } | null {
  const start = centralDayStartUtc(fromDay);
  const nextDay = addCentralDays(toDay, 1);
  const end = nextDay ? centralDayStartUtc(nextDay) : null;
  if (start === null || end === null) return null;
  return { startMs: start, endMs: end };
}

/** Add (or subtract) calendar days in Central, DST-safe. */
export function addCentralDays(day: string, n: number): string | null {
  const start = centralDayStartUtc(day);
  if (start === null) return null;
  // Noon avoids landing inside a DST transition when stepping day by day.
  return centralDay(new Date(start + n * 86_400_000 + 12 * 3_600_000));
}

/** Today's Central calendar day. */
export const centralToday = (now: Date = new Date()): string => centralDay(now);

/** "Sep 20, 2026" for display. */
const labelFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC", year: "numeric", month: "short", day: "numeric",
});
export function formatDayLabel(day: string): string {
  const t = Date.parse(day + "T12:00:00Z");
  return Number.isFinite(t) ? labelFmt.format(new Date(t)) : day;
}

/** Inclusive count of Central days in a range, for per-day averages. */
export function centralDaysBetween(fromDay: string, toDay: string): number {
  const r = centralRangeUtc(fromDay, toDay);
  if (!r) return 0;
  return Math.max(0, Math.round((r.endMs - r.startMs) / 86_400_000));
}
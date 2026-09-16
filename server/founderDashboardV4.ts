/**
 * server/founderDashboardV4.ts
 *
 * Founder Dashboard V4 — server-rendered HTML.
 *
 * Same route, same auth, same architecture as V3: one HTML string built from
 * a metrics object. The business funnel comes first; V3's product sections are
 * imported unchanged and rendered further down. Nothing from V3 is deleted.
 *
 * ── Trust is visible, quietly ───────────────────────────────────────────────
 * Every metric carries EXACT / DERIVED / ESTIMATED / NOT TRACKED / LEGACY.
 * The renderer shows it as a small badge with a tooltip and a legend at the
 * top — present, not shouting.
 *
 * ── Small samples are labelled, never hidden ────────────────────────────────
 * Every rate renders as "n / d · pct" so 5.6% is never mistaken for a trend
 * when it is 2 of 36. Denominators under 20 get a subtle marker.
 *
 * ── PII stays in this HTML ──────────────────────────────────────────────────
 * Purchaser emails appear only in the server-rendered Paid User Journeys
 * table, behind FOUNDER_DASHBOARD_SECRET. Every value passes through esc().
 * There is no client-side JS that fetches or holds user data.
 */
import {
    esc, card, section, bar, isErr, errorCard,
    renderTrust, renderCost, renderHunt, renderProgress, renderAchievements,
    renderBrands, renderDiamonds, renderListings, renderSold, renderScans,
  } from "./founderDashboardV3";
  import type { Metric, Trust, PaywallRow, PaidJourney } from "./founderMetricsV4";
  
  // ── Formatting ───────────────────────────────────────────────────────────────
  
  const num = (v: unknown, dp = 0): string => {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v); if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
  };
  const pct = (v: number | null): string => v === null ? "—" : `${(v * 100).toFixed(1)}%`;
  const hrs = (h: number | null): string => {
    if (h === null || !Number.isFinite(h)) return "—";
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 48) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  };
  const when = (s: string | null | undefined): string => s ? esc(s.slice(0, 16).replace("T", " ")) : "—";
  
  const TRUST_LABEL: Record<Trust, string> = { EXACT: "exact", DERIVED: "derived", ESTIMATED: "est.", NOT_TRACKED: "n/t", LEGACY: "legacy" };
  const TRUST_TIP: Record<Trust, string> = {
    EXACT: "A count from an authoritative table.", DERIVED: "Arithmetic over exact inputs.",
    ESTIMATED: "A model, not a measurement.", NOT_TRACKED: "Not collected.", LEGACY: "Known unreliable. Shown for context only.",
  };
  const badge = (t: Trust) => `<span class="tb tb-${t.toLowerCase()}" title="${esc(TRUST_TIP[t])}">${TRUST_LABEL[t]}</span>`;
  const small = (d: number | undefined) => (d !== undefined && d < 20) ? `<span class="ss" title="Small sample: fewer than 20 in the denominator">n&lt;20</span>` : "";
  
  /** A metric card. Handles unavailable, rates with N, and plain counts. */
  function m(label: string, x: Metric | null | undefined, opts: { dp?: number; fmt?: "pct" | "hrs" | "num" } = {}): string {
    if (!x) return card(label, "—");
    if (x.available === false) return `<div class="stat na"><div class="stat-v">Not yet available</div><div class="stat-l">${esc(label)}</div><div class="stat-s">${esc(x.note ?? "Available after Analytics V4 cutover")}</div></div>`;
    let v: string, sub = "";
    if (x.trust === "DERIVED" && x.d !== undefined && x.n !== undefined) {
      v = pct(x.value); sub = `${num(x.n)} / ${num(x.d)} ${small(x.d)}`;
    } else if (opts.fmt === "hrs") { v = hrs(x.value); if (x.d !== undefined) sub = `n=${num(x.d)} ${small(x.d)}`; }
    else if (opts.fmt === "pct") { v = pct(x.value); }
    else { v = num(x.value, opts.dp ?? 0); if (x.d !== undefined) sub = `n=${num(x.d)} ${small(x.d)}`; }
    return `<div class="stat"><div class="stat-v">${v} ${badge(x.trust)}</div><div class="stat-l">${esc(label)}</div>${sub || x.note ? `<div class="stat-s">${sub}${x.note ? ` <span class="muted">${esc(x.note)}</span>` : ""}</div>` : ""}</div>`;
  }
  const grid = (cards: string[]) => `<div class="stat-grid">${cards.join("")}</div>`;
  const na = (label: string, note = "Awaiting Analytics V4 client release") => `<div class="card na"><div class="card-h">${esc(label)}</div><div class="muted">${esc(note)}</div></div>`;
  const rate = (n: number, d: number) => d ? `${num(n)} / ${num(d)} · ${pct(n / d)} ${small(d)}` : "—";
  const table = (head: string[], rows: string[][], cls = "") => rows.length
    ? `<table class="${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : `<div class="muted">No data yet.</div>`;
  const funnel = (rows: Array<{ stage: string; users: number; note?: string }>) => {
    const top = rows[0]?.users || 0;
    return `<table class="funnel">${rows.map((r, i) => {
      const prev = rows[i - 1]?.users ?? r.users;
      const drop = i === 0 || !prev ? "" : `<span class="muted">−${pct(1 - r.users / prev)} vs prev</span>`;
      return `<tr><td class="stg">${esc(r.stage)}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ""}</td><td class="r">${num(r.users)}</td><td class="r">${top ? pct(r.users / top) : "—"}</td><td class="w">${bar(top ? r.users / top * 100 : 0)}</td><td>${drop}</td></tr>`;
    }).join("")}</table>`;
  };
  const buckets = (obj: Record<string, number>, total?: number) => {
    const t = total ?? Object.values(obj).reduce((a, b) => a + b, 0);
    return table(["Bucket", "Users", "Share"], Object.entries(obj).map(([k, v]) => [esc(k), num(v), t ? pct(v / t) : "—"]));
  };
  const legend = () => `<div class="legend">${(["EXACT", "DERIVED", "ESTIMATED", "NOT_TRACKED", "LEGACY"] as Trust[]).map(t => `${badge(t)} ${esc(TRUST_TIP[t])}`).join(" &nbsp; ")}</div>`;
  
  // ── Sections ─────────────────────────────────────────────────────────────────
  
  function renderExecutive(x: any): string {
    const a = x.acquisition, mo = x.monetization, pw = x.paywalls, ret = x.retentionV2, ue = x.unitEconomics, sc = x.scans;
    if (isErr(a) || isErr(mo)) return errorCard("Executive", isErr(a) ? a : mo);
    const c = x.cutover;
    const banner = c?.configured
      ? `<div class="banner ok">Analytics V4 active since ${esc(c.at)}</div>`
      : `<div class="banner warn"><strong>Awaiting Analytics V4 client release.</strong> ${esc(c?.status ?? "")} — V4-only metrics show “Not yet available” until then.</div>`;
    return section("exec", "1 · Executive", banner + legend() + grid([
      m("Total users", a.totalUsers), m("New users 7d", a.new7), m("New users 30d", a.new30),
      m("DAU", a.dau), m("WAU", a.wau), m("MAU", a.mau), m("DAU / MAU", a.dauMau, { fmt: "pct" }),
      m("Scans 7d", sc && !isErr(sc) ? { value: sc.scans7 ?? sc.last7 ?? null, trust: "EXACT" } : null),
      m("Activated (1+ scan)", x.activation && !isErr(x.activation) ? x.activation.activationRate : null),
      m("Paywall viewers 7d", pw && !isErr(pw) ? pw.viewers7 : null), m("Purchases 7d", pw && !isErr(pw) ? pw.purchases7 : null),
      m("Current Monthly", mo.currentMonthly), m("Current Annual", mo.currentAnnual), m("Scan-pack buyers", mo.scanPackBuyers),
      m("Total purchases", { value: (mo.purchaseCompletions?.value ?? 0) + (mo.scanPackPurchases?.value ?? 0), trust: "EXACT" }),
      m("Revenue", mo.revenue), m("MRR", mo.mrr),
      m("Est. API spend", ue && !isErr(ue) ? ue.estimatedSpend : null, { dp: 2 }),
      m("D7 retention", ret && !isErr(ret) ? ret.d7 : null),
    ]));
  }
  
  function renderAcquisition(a: any): string {
    if (isErr(a)) return errorCard("Acquisition", a);
    const trend = table(["Day", "New", "Active"], a.trend.slice(-14).reverse().map((r: any) => [esc(r.day), num(r.newUsers), num(r.active)]), "compact");
    const growth = `<div class="spark">${a.cumulative.map((p: any) => `<span title="${esc(p.day)}: ${p.users}" style="height:${Math.max(2, p.users / (a.cumulative.at(-1)?.users || 1) * 40)}px"></span>`).join("")}</div><div class="muted">Cumulative users, last 30 days</div>`;
    return section("acq", "2 · Acquisition / Users", grid([
      m("Total profiles", a.totalUsers), m("New today", a.newToday), m("New 7d", a.new7), m("New 30d", a.new30),
      m("Active today", a.dau), m("Active 7d", a.wau), m("Active 30d", a.mau),
    ]) + `<div class="two"><div class="card"><div class="card-h">Cumulative growth</div>${growth}</div><div class="card"><div class="card-h">Daily trend (last 14d, UTC)</div>${trend}</div></div>
    <div class="note-block">${badge("NOT_TRACKED")} ${esc(a.attributionNote)}</div>`);
  }
  
  function renderActivation(x: any): string {
    if (isErr(x)) return errorCard("Activation", x);
    return section("act", "3 · Activation", grid([
      m("Activation rate", x.activationRate), m("Never scanned", x.neverScanned), m("Onboarding completed (event)", x.onboardingCompleted),
      m("Median account → first scan", x.hoursToFirstScanMedian, { fmt: "hrs" }), m("Mean account → first scan", x.hoursToFirstScanMean, { fmt: "hrs" }),
    ]) + `<div class="card"><div class="card-h">Lifecycle (nested — each stage is a subset of the one above)</div>${funnel(x.lifecycle)}</div>`,
    "first scan from the scans table, not events");
  }
  
  function renderMonetization(mo: any): string {
    if (isErr(mo)) return errorCard("Monetization", mo);
    return section("mon", "4 · Monetization", grid([
      m("Current Free", mo.currentFree), m("Current Monthly", mo.currentMonthly), m("Current Annual", mo.currentAnnual), m("Total paying", mo.totalPaying),
      m("Scan-pack buyers", mo.scanPackBuyers), m("Paywall viewers (all time)", mo.paywallViewers),
      m("Purchase starts", mo.purchaseStarts), m("Purchase completions", mo.purchaseCompletions),
      m("Cancellations", mo.purchaseCancellations), m("Failures", mo.purchaseFailures),
      m("Viewer → purchase", mo.viewToPurchase),
      m("Monthly purchases", mo.monthlyPurchases), m("Annual purchases", mo.annualPurchases), m("Scan-pack purchases", mo.scanPackPurchases),
      m("Known revenue", mo.revenue), m("MRR", mo.mrr),
    ]) + `<div class="card"><div class="card-h">Plan selection (all paywalls)</div>${buckets({ Monthly: mo.planSelection.monthly, Annual: mo.planSelection.annual })}</div>`);
  }
  
  function renderPaywalls(pw: any): string {
    if (isErr(pw)) return errorCard("Paywalls", pw);
    const rows = (pw.rows as PaywallRow[]).map(r => [
      `<code>${esc(r.source)}</code>`, num(r.impressions), num(r.uniqueViewers), num(r.impressionsPerViewer, 2),
      num(r.monthlySelected), num(r.annualSelected), num(r.purchaseStarts), num(r.purchases), num(r.cancelled), num(r.failed),
      r.impressionToPurchase.d ? rate(r.impressionToPurchase.n!, r.impressionToPurchase.d) : "—",
      r.startToCompletion.d ? rate(r.startToCompletion.n!, r.startToCompletion.d) : "—",
    ]);
    const v4 = (pw.rows as PaywallRow[]).map(r => {
      const u = r.continueFree.available === false;
      const e = r.entitlementAtImpression;
      return [`<code>${esc(r.source)}</code>`,
        u ? "—" : num(r.continueFree.value), u ? "—" : num(r.closed.value), u ? "—" : num(r.backgroundedActive.value),
        u ? "—" : num(r.avgScansRemainingAtImpression.value, 1),
        e ? `F ${e.free} · M ${e.monthly} · A ${e.annual} · ? ${e.unknown}` : "—"];
    });
    const v4Block = pw.rows[0]?.continueFree?.available === false
      ? na("Post-cutover outcomes (Continue Free, close, backgrounded, balance and entitlement at impression)")
      : `<div class="card"><div class="card-h">Post-cutover outcomes</div>${table(["Paywall", "Continue Free", "Closed", "Backgrounded w/ paywall", "Avg scans left", "Entitlement F/M/A/?"], v4)}</div>`;
    return section("pw", "5 · Paywalls", grid([
      m("Most shown", { value: null, trust: "EXACT", note: pw.mostShown ?? "—" }), m("Unique viewers (all time)", pw.totalViewers),
      m("Viewers 7d", pw.viewers7), m("Purchases 7d", pw.purchases7), m("Legacy dismissed rows", pw.legacyDismissed),
    ]) + `<div class="card"><div class="card-h">Per-paywall comparison (sorted by impressions)</div>${table(["Paywall", "Impr.", "Uniq", "Impr/viewer", "Monthly sel.", "Annual sel.", "Starts", "Purchases", "Cancel", "Fail", "Impr→purchase", "Start→complete"], rows)}</div>
    <div class="two"><div class="card"><div class="card-h">Repeat exposure (impressions per viewer)</div>${buckets(pw.repeatExposure)}</div>${v4Block}</div>`,
    "all paywall events are historical-safe; V4 outcomes are gated");
  }
  
  function renderOnboardingOffer(o: any): string {
    if (isErr(o)) return errorCard("Onboarding offer", o);
    const L = o.legacy;
    const legacy = funnel([
      { stage: "Offer shown", users: L.shown.value }, { stage: "Plan selected", users: L.planSelected.value },
      { stage: "Purchase started", users: L.purchaseStarted.value }, { stage: "Purchase completed", users: L.purchaseCompleted.value },
    ]);
    const v4 = o.v4.available ? funnel([
      { stage: "Offer shown", users: o.v4.shown.value }, { stage: "Monthly selected", users: o.v4.monthlySelected.value },
      { stage: "Annual selected", users: o.v4.annualSelected.value }, { stage: "Purchase started", users: o.v4.purchaseStarted.value },
      { stage: "Purchase completed", users: o.v4.purchaseCompleted.value }, { stage: "Continue Free", users: o.v4.continueFree.value },
      { stage: "Backgrounded with offer open", users: o.v4.backgroundedActive.value },
    ]) + grid([m("Later activity", o.v4.laterActivity), m("No later activity", o.v4.noLaterActivity)]) +
      `<div class="note-block">${badge("DERIVED")} Abandonment: ${esc(o.v4.abandonmentDefinition)}</div>`
      : na("Post-cutover exact funnel (Monthly / Annual selected, Continue Free, backgrounded, later activity)");
    return section("offer", "6 · Onboarding Offer", `<div class="two">
      <div class="card"><div class="card-h">All-time funnel</div>${legacy}${grid([m("Conversion", L.conversion), m("Inferred Continue Free", L.inferredContinueFree)])}</div>
      <div class="card"><div class="card-h">Post-cutover</div>${v4}</div></div>`);
  }
  
  function renderPaidJourneys(pj: any): string {
    if (isErr(pj)) return errorCard("Paid user journeys", pj);
    const tp = pj.hoursToPay, sb = pj.scansBeforePay;
    const agg = grid([
      m("Paying users", pj.payingUsers), m("With confirmed purchase event", pj.withKnownPurchaseTime),
      m("Mean account → pay", { value: tp.mean, trust: "DERIVED", d: tp.d }, { fmt: "hrs" }), m("Median account → pay", { value: tp.median, trust: "DERIVED", d: tp.d }, { fmt: "hrs" }),
      m("Fastest", { value: tp.fastest, trust: "DERIVED" }, { fmt: "hrs" }), m("Slowest", { value: tp.slowest, trust: "DERIVED" }, { fmt: "hrs" }),
      m("Mean scans before pay", { value: sb.mean, trust: "DERIVED", d: sb.d }, { dp: 1 }), m("Median scans before pay", { value: sb.median, trust: "DERIVED", d: sb.d }, { dp: 1 }),
      m("Mean sessions before pay", { value: pj.sessionsBeforePay.mean, trust: "DERIVED", d: pj.sessionsBeforePay.d }, { dp: 1 }),
      m("Mean paywall impressions before pay", { value: pj.paywallsBeforePay.mean, trust: "DERIVED", d: pj.paywallsBeforePay.d }, { dp: 1 }),
    ]);
    const rows = (pj.journeys as PaidJourney[]).slice(0, 200).map(j => [
      esc(j.displayName ?? "—"), esc(j.email ?? "—"), `<code class="uid" title="${esc(j.userId)}">${esc(j.userId.slice(0, 8))}…</code>`,
      esc(j.currentPlan), esc(j.firstPaidKind), esc(j.firstPaidProduct ?? "—"),
      when(j.accountCreatedAt ?? j.profileCreatedAt), when(j.firstScanAt), when(j.firstPaywallAt), when(j.firstPurchaseAt), when(j.latestActivityAt),
      hrs(j.hoursAccountToPay), hrs(j.hoursFirstScanToPay), hrs(j.hoursFirstPaywallToPay),
      num(j.scansBeforePay), num(j.sessionsBeforePay), num(j.activeDaysBeforePay), num(j.paywallImpressionsBeforePay), num(j.uniquePaywallSourcesBeforePay),
      esc(j.firstPaywallSource ?? "—"), esc(j.lastPaywallBeforePay ?? "—"), j.convertingPaywall ? `<code>${esc(j.convertingPaywall)}</code>` : `<span class="muted">UNKNOWN</span>`,
      num(j.scanStoreVisitsBeforePay), num(j.huntEventsBeforePay), num(j.listingsBeforePay),
    ]);
    const attribution = table(["Converting paywall", "Purchases"], pj.byConvertingPaywall.map((r: any) => [r.source === "UNKNOWN" ? `<span class="muted">UNKNOWN</span>` : `<code>${esc(r.source)}</code>`, num(r.purchases)]));
    return section("paid", "7 · Paid User Journeys", agg +
      `<div class="two"><div class="card"><div class="card-h">Time to pay (mutually exclusive)</div>${buckets(pj.timeBuckets)}<div class="muted">Placed by first match: same session → same UTC day → &lt;24h → 1–3d → 4–7d → 8–14d → 15+d.</div></div>
       <div class="card"><div class="card-h">Scans before first payment</div>${buckets(pj.scanBuckets)}</div></div>
       <div class="card"><div class="card-h">Purchases by converting paywall</div>${attribution}<div class="muted">Direct attribution = source on purchase_completed, confirmed by the preceding purchase_started. Disagreement → UNKNOWN.</div></div>
       <div class="card wide"><div class="card-h">Every paying user (newest first, up to 200) — founder-only, contains email</div>
       ${table(["Name", "Email", "UID", "Plan", "Kind", "Product", "Account", "First scan", "First paywall", "First purchase", "Last active",
                "Acct→pay", "Scan→pay", "Paywall→pay", "Scans", "Sessions", "Days", "PW impr.", "PW srcs", "First PW", "Last PW", "Converting", "Store visits", "Hunt", "Listings"], rows, "compact wrap")}</div>`,
      pj.smallSample ? "small sample" : "");
  }
  
  function renderScanStore(s: any): string {
    if (isErr(s)) return errorCard("Scan Store", s);
    const skus = table(["Pack", "Scans", "Attempts", "Purchases", "Cancels", "Failures", "Attempt → purchase"],
      s.skus.map((k: any) => [`${esc(k.name)} <code>${esc(k.sku)}</code>`, num(k.scans), num(k.attempts), num(k.purchases), num(k.cancels), num(k.failures), k.conversion.d ? rate(k.conversion.n, k.conversion.d) : "—"]));
    const v4 = s.v4.available
      ? `<div class="card"><div class="card-h">Post-cutover context</div>${table(["Entry source", "Opens"], s.v4.entrySource.map((r: any) => [`<code>${esc(r.source)}</code>`, num(r.opens)]))}
         ${grid([m("Opened at 0 scans", s.v4.atZero), m("Opened above 0", s.v4.aboveZero), m("Avg balance at open", s.v4.avgBalanceAtOpen, { dp: 1 }), m("Avg scans left at attempt", s.v4.avgRemainingAtAttempt, { dp: 1 })])}
         <div class="muted">Visitors by entitlement: Free ${s.v4.entitlement.free} · Monthly ${s.v4.entitlement.monthly} · Annual ${s.v4.entitlement.annual} · Unknown ${s.v4.entitlement.unknown}</div></div>`
      : na("Post-cutover context (entry source, entitlement, balance at open, users at 0 scans)");
    return section("store", "8 · Scan Store", grid([
      m("Opens", s.opens), m("Unique visitors", s.uniqueVisitors), m("Repeat visitors", s.repeatVisitors), m("Opens / visitor", s.opensPerVisitor, { dp: 2 }),
      m("Visitor → buyer", s.visitorToBuyer), m("Completed", { value: s.outcomes.completed, trust: "EXACT" }), m("Cancelled", { value: s.outcomes.cancelled, trust: "EXACT" }), m("Failed", { value: s.outcomes.failed, trust: "EXACT" }),
      m("Median first visit → purchase", { value: s.hoursFirstVisitToPurchase.median, trust: "DERIVED", d: s.hoursFirstVisitToPurchase.d }, { fmt: "hrs" }), m("Revenue", s.revenue),
    ]) + `<div class="two"><div class="card"><div class="card-h">Funnel (unique users)</div>${funnel(s.funnel)}<div class="muted">StoreKit sheet presentation is not tracked, so it is not a stage.</div></div>
    <div class="card"><div class="card-h">Entry mode (legacy field)</div>${table(["Mode", "Opens"], s.entryMode.map((r: any) => [esc(r.mode), num(r.opens)]))}</div></div>
    <div class="card"><div class="card-h">Per SKU</div>${skus}</div>${v4}`, s.smallSample ? "small sample" : "");
  }
  
  function cohortCard(c: any): string {
    const allow = c.allowance
      ? `<div class="muted">Allowance: mean ${num(c.allowance.meanUsed, 1)} / ${num(c.allowance.limit)} used this period (${pct(c.allowance.meanPct)}) · median ${num(c.allowance.medianUsed, 1)} · n=${c.allowance.d} ${small(c.allowance.d)}<br>${esc(c.allowance.note)}</div>`
      : "";
    return `<div class="card"><div class="card-h">Current ${esc(c.plan)} · ${num(c.users.value)} users ${badge("EXACT")}</div>
      ${grid([m("Active today", c.activeToday), m("Active 7d", c.active7), m("Active 30d", c.active30),
        m("Lifetime scans / user (mean)", { value: c.lifetimeScansMean, trust: "DERIVED" }, { dp: 1 }), m("Lifetime scans / user (median)", { value: c.lifetimeScansMedian, trust: "DERIVED" }, { dp: 1 }),
        m("Scans 7d / user", { value: c.scans7PerUser, trust: "DERIVED" }, { dp: 2 }), m("Scans 30d / user", { value: c.scans30PerUser, trust: "DERIVED" }, { dp: 2 }),
        m("Sessions / user", { value: c.sessionsPerUser, trust: "DERIVED" }, { dp: 1 }), m("Active days / user", { value: c.activeDaysPerUser, trust: "DERIVED" }, { dp: 1 }),
        m("Listings", { value: c.listings, trust: "EXACT" }), m("Hunt users", { value: c.huntUsers, trust: "EXACT" }), m("Account age (mean days)", { value: c.accountAgeDaysMean, trust: "DERIVED" }, { dp: 1 })])}
      ${allow}<div class="muted">${esc(c.classificationNote)}</div></div>`;
  }
  function renderCohorts(c: any): string {
    if (isErr(c)) return errorCard("Cohorts", c);
    return section("cohorts", "9 · User Cohorts (current plan)", cohortCard(c.free) + cohortCard(c.monthly) + cohortCard(c.annual));
  }
  
  function renderFree(f: any): string {
    if (isErr(f)) return errorCard("Free user behaviour", f);
    return section("free", "10 · Free User Behaviour", grid([
      m("Current Free users", f.users), m("Never scanned", f.neverScanned), m("Exhausted 15 free scans", f.exhausted), m("Exhaustion rate", f.exhaustedRate),
      m("Lifetime scans (mean)", { value: f.lifetimeMean, trust: "DERIVED" }, { dp: 1 }), m("Lifetime scans (median)", { value: f.lifetimeMedian, trust: "DERIVED" }, { dp: 1 }),
      m("Active days (mean)", { value: f.activeDaysMean, trust: "DERIVED" }, { dp: 1 }), m("Active days (median)", { value: f.activeDaysMedian, trust: "DERIVED" }, { dp: 1 }),
      m("Median time to first scan", { value: f.hoursToFirstScanMedian.value, trust: "DERIVED", d: f.hoursToFirstScanMedian.d }, { fmt: "hrs" }),
    ]) + `<div class="two"><div class="card"><div class="card-h">Lifetime scans consumed</div>${buckets(f.buckets)}</div>
    <div class="card"><div class="card-h">Post-cutover</div>${na("Paywall views and conversion by scans consumed; outcome by scans remaining")}<div class="muted">${esc(f.balanceHistoryNote)}</div></div></div>`);
  }
  
  function renderRetentionV2(r: any): string {
    if (isErr(r)) return errorCard("Retention", r);
    return section("ret", "11 · Retention", grid([m("D1", r.d1), m("D3", r.d3), m("D7", r.d7), m("D14", r.d14), m("D30", r.d30)]) +
      `<div class="muted">Anchor: ${esc(r.anchor)} · timezone ${esc(r.timezone)} · ${num(r.cohortUsers)} users with an anchor. Only users old enough for each window are counted in its denominator.</div>`,
      "re-anchored on first activity, not profile creation");
  }
  
  function renderSessionsV2(s: any): string {
    if (isErr(s)) return errorCard("Sessions", s);
    return section("sess", "12 · Sessions", grid([m("Sessions today", s.sessionsToday), m("Sessions 7d", s.sessions7), m("Sessions / user 7d", s.sessionsPerUser7, { dp: 2 })]) +
      `<div class="note-block">${badge("LEGACY")} ${esc(s.durationNote.note)}</div>`);
  }
  
  function renderFeatureUsage(f: any): string {
    if (isErr(f)) return errorCard("Feature usage", f);
    const rows = f.map((r: any) => [esc(r.feature), r.accessed === null ? `<span class="muted">n/t</span>` : num(r.accessed), r.paywallTriggered === null ? `<span class="muted">n/a</span>` : num(r.paywallTriggered), r.completed === null ? `<span class="muted">n/t</span>` : num(r.completed), r.completedUsers === null ? "—" : num(r.completedUsers), `<span class="muted">${esc(r.note)}</span>`]);
    return section("feat", "13 · Feature Usage", `<div class="card">${table(["Feature", "Accessed", "Paywall triggered", "Completed", "Users", "Source"], rows)}<div class="muted">A paywall being triggered is not feature usage; the columns are kept separate on purpose.</div></div>`);
  }
  
  function renderUnitEconomics(u: any): string {
    if (isErr(u)) return errorCard("Unit economics", u);
    return section("cost", "14 · Cost / Unit Economics", grid([
      m("Est. API spend (all time)", u.estimatedSpend, { dp: 2 }), m("Est. cost / scan", u.costPerScan, { dp: 3 }), m("Est. cost / user", u.costPerUser, { dp: 3 }),
      m("Est. cost / active user (30d)", u.costPerActiveUser30, { dp: 3 }), m("Scans 30d", u.scans30),
    ]) + `<div class="note-block">${badge("ESTIMATED")} ${esc(u.marginNote)}</div>` + (u.v3 && !isErr(u.v3) ? renderCost(u.v3).replace(/<h2>[\s\S]*?<\/h2>/, `<h3>V3 cost detail</h3>`) : ""));
  }
  
  function renderDataQualityV4(q: any): string {
    if (isErr(q)) return errorCard("Data quality", q);
    const c = q.cutover;
    return section("dq", "23 · Data Quality", `<div class="banner ${c.configured ? "ok" : "warn"}">${esc(c.status)}</div>` + grid([
      m("Analytics events", q.totalEvents), m("Authenticated", q.authenticated), m("Anonymous", q.anonymous), m("Missing session_id", q.missingSession),
      m("Latest event", { value: null, trust: "EXACT", note: q.latestEvent ?? "—" }),
      m("Post-cutover events", q.postCutoverEvents), m("Snapshot coverage", q.snapshotCoverage), m("Unknown snapshot %", q.unknownSnapshotPct),
      m("Legacy paywall_dismissed", q.legacyDismissed), m("Continue Free (post)", q.continueFreePost), m("paywall_closed (post)", q.closedPost),
      m("scan_completed (post)", q.scanCompletedPost), m("scan_completed (legacy)", q.scanCompletedLegacy),
    ]) + (q.anomalies.length ? `<div class="banner warn">${q.anomalies.map((a: string) => esc(a)).join("<br>")}</div>` : "") +
      `<div class="note-block">${badge("NOT_TRACKED")} ${esc(q.revenueCatHistoryNote)}</div>`);
  }
  
  // ── Composer ─────────────────────────────────────────────────────────────────
  
  const TOC: Array<[string, string]> = [
    ["exec", "Executive"], ["acq", "Users"], ["act", "Activation"], ["mon", "Monetization"], ["pw", "Paywalls"], ["offer", "Onboarding offer"],
    ["paid", "Paid journeys"], ["store", "Scan Store"], ["cohorts", "Cohorts"], ["free", "Free users"], ["ret", "Retention"], ["sess", "Sessions"],
    ["scans", "Scans"], ["feat", "Features"], ["cost", "Cost"], ["trust", "Scan trust"], ["hunt", "Hunt"], ["progress", "Progress"],
    ["achievements", "Achievements"], ["brands", "Brands"], ["diamonds", "Diamonds"], ["listings", "Listings"], ["sold", "Sold"], ["dq", "Data quality"],
  ];
  
  export function generateFounderDashboardV4(metrics: any): string {
    if (metrics && metrics.configured === false) {
      return shell(`<div class="banner warn"><strong>Supabase not configured.</strong> Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.</div>`, "—");
    }
    if (metrics && metrics.fatal) return shell(`<div class="banner warn"><strong>Failed to load data:</strong> ${esc(metrics.fatal)}</div>`, "—");
    if (metrics && metrics.v4Error) {
      return shell(`<div class="banner warn"><strong>V4 metrics failed:</strong> ${esc(metrics.v4Error)} — showing V3 sections only.</div>` +
        [renderScans(metrics.scans), renderTrust(metrics.trust), renderCost(metrics.cost), renderHunt(metrics.hunt), renderProgress(metrics.progress),
         renderAchievements(metrics.achievements), renderBrands(metrics.brands), renderDiamonds(metrics.diamonds), renderListings(metrics.listings), renderSold(metrics.sold)].join(""), metrics.generatedAt);
    }
    const body = [
      renderExecutive(metrics), renderAcquisition(metrics.acquisition), renderActivation(metrics.activation),
      renderMonetization(metrics.monetization), renderPaywalls(metrics.paywalls), renderOnboardingOffer(metrics.onboardingOffer),
      renderPaidJourneys(metrics.paidJourneys), renderScanStore(metrics.scanStore), renderCohorts(metrics.cohorts),
      renderFree(metrics.freeBehaviour), renderRetentionV2(metrics.retentionV2), renderSessionsV2(metrics.sessionsV2),
      renderScans(metrics.scans), renderFeatureUsage(metrics.featureUsage), renderUnitEconomics(metrics.unitEconomics),
      // V3 product analytics, preserved and demoted below the business funnel.
      renderTrust(metrics.trust), renderHunt(metrics.hunt), renderProgress(metrics.progress), renderAchievements(metrics.achievements),
      renderBrands(metrics.brands), renderDiamonds(metrics.diamonds), renderListings(metrics.listings), renderSold(metrics.sold),
      renderDataQualityV4(metrics.dataQualityV4),
    ].join("");
    return shell(body, metrics.generatedAt);
  }
  
  function shell(body: string, generatedAt: string): string {
    const toc = TOC.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join("");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FlipStart · Founder Dashboard V4</title>
  <style>
  :root{--bg:#0f1512;--card:#161f1a;--line:#24312a;--fg:#e7e2d2;--muted:#8f9a91;--accent:#c4a334;--ok:#3a8f5a;--warn:#b7791f}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif}
  header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  header h1{font-size:15px;margin:0;color:var(--accent)}header .gen{color:var(--muted);font-size:11px;margin-left:auto}
  nav.toc{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11.5px}nav.toc a{color:var(--muted);text-decoration:none}nav.toc a:hover{color:var(--fg)}
  main{padding:14px 18px 60px;max-width:1500px;margin:0 auto}
  section{margin:0 0 26px}section h2{font-size:15px;margin:0 0 10px;padding-top:6px;border-top:1px solid var(--line)}section h2 .note{font-weight:400;color:var(--muted);font-size:11px;margin-left:10px}
  h3{font-size:12.5px;color:var(--muted);margin:14px 0 6px}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:10px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:9px 11px}.stat-v{font-size:19px;font-weight:600;line-height:1.2}.stat-l{color:var(--muted);font-size:11px;margin-top:2px}.stat-s{color:var(--muted);font-size:10.5px;margin-top:2px}
  .stat.na .stat-v{font-size:12px;color:var(--muted);font-weight:500}
  .card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin-bottom:10px}.card-h{font-weight:600;font-size:12px;margin-bottom:8px}.card.na{color:var(--muted)}.card.wide{overflow-x:auto}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:900px){.two{grid-template-columns:1fr}}
  table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:5px 7px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:11px}td.r,th.r{text-align:right}
  table.compact th,table.compact td{padding:3px 6px;font-size:11.5px}table.wrap{min-width:1800px}
  table.funnel td.stg{width:30%}table.funnel td.w{width:30%}
  .bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden}.bar-fill{height:100%}
  .tb{display:inline-block;font-size:9px;font-weight:600;letter-spacing:.4px;padding:1px 5px;border-radius:3px;vertical-align:middle;margin-left:4px;text-transform:uppercase;cursor:help}
  .tb-exact{background:#1f3b2a;color:#7bd394}.tb-derived{background:#1f2f3b;color:#7fb8e8}.tb-estimated{background:#3b331f;color:#e8c77f}.tb-not_tracked{background:#2a2a2a;color:#9a9a9a}.tb-legacy{background:#3b1f1f;color:#e88f7f}
  .ss{display:inline-block;font-size:9.5px;color:var(--warn);border:1px solid var(--warn);border-radius:3px;padding:0 4px;margin-left:4px;cursor:help}
  .legend{font-size:11px;color:var(--muted);margin:6px 0 12px}.muted{color:var(--muted);font-size:11px}.note-block{color:var(--muted);font-size:11.5px;padding:8px 10px;border-left:2px solid var(--line);margin:6px 0 10px}
  .banner{padding:9px 12px;border-radius:6px;margin-bottom:10px;font-size:12px}.banner.warn{background:#2c2410;border:1px solid var(--warn)}.banner.ok{background:#12291b;border:1px solid var(--ok)}
  .spark{display:flex;align-items:flex-end;gap:2px;height:44px}.spark span{flex:1;background:var(--accent);opacity:.7;border-radius:1px 1px 0 0;min-width:2px}
  code{font-size:11px;background:#0b110e;padding:1px 4px;border-radius:3px}.uid{cursor:help}
  </style></head><body>
  <header><h1>FlipStart · Founder Dashboard <span style="color:var(--muted);font-weight:400">V4</span></h1><nav class="toc">${toc}</nav><span class="gen">generated ${esc(generatedAt)}</span></header>
  <main>${body}</main></body></html>`;
  }
/**
 * server/founderDashboardV3.ts
 *
 * Pure HTML renderer for Founder Dashboard V3. Takes the metrics object from
 * getFounderDashboardV3Metrics() and returns a complete dark-themed HTML page.
 *
 * READ-ONLY. No forms, no destructive controls, no write actions.
 * Every section guards against `{ error }` or missing data and renders an error
 * card instead of throwing, so one bad section never blanks the page.
 */

// ─── Small HTML helpers ──────────────────────────────────────────────────────

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const num = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : esc(v);
};
const pctStr = (v: unknown): string =>
  (v === null || v === undefined) ? "—" : `${esc(v)}%`;
const money = (v: unknown): string =>
  (v === null || v === undefined) ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const dt = (v: unknown): string => {
  if (!v) return "—";
  try { return new Date(String(v)).toLocaleString(); } catch { return esc(v); }
};
const dateOnly = (v: unknown): string => {
  if (!v) return "—";
  try { return new Date(String(v)).toLocaleDateString(); } catch { return esc(v); }
};

function isErr(section: any): section is { error: string } {
  return section && typeof section === "object" && typeof section.error === "string";
}
function errorCard(title: string, section: any): string {
  return `<div class="card err"><div class="card-h">${esc(title)}</div>
    <div class="err-msg">⚠ Section failed: ${esc(section.error)}</div></div>`;
}
function card(label: string, value: string, sub = ""): string {
  return `<div class="stat"><div class="stat-v">${value}</div><div class="stat-l">${esc(label)}</div>${sub ? `<div class="stat-s">${esc(sub)}</div>` : ""}</div>`;
}
function section(id: string, title: string, body: string, note = ""): string {
  return `<section id="${esc(id)}"><h2>${esc(title)}${note ? `<span class="note">${esc(note)}</span>` : ""}</h2>${body}</section>`;
}

// Horizontal bar (for funnel / shares).
function bar(pctValue: number | null, colorVar = "--accent"): string {
  const w = Math.max(0, Math.min(100, pctValue ?? 0));
  return `<div class="bar"><div class="bar-fill" style="width:${w}%;background:var(${colorVar})"></div></div>`;
}

// ─── Section renderers ───────────────────────────────────────────────────────

function renderUsers(s: any): string {
  if (isErr(s)) return errorCard("Core User Metrics", s);
  const grid = [
    card("Total profiles", num(s.total)),
    card("New today", num(s.newToday)),
    card("New (7d)", num(s.new7)),
    card("New (30d)", num(s.new30)),
    card("Active today", num(s.activeToday)),
    card("Active this week", num(s.activeWeek)),
    card("Active this month", num(s.activeMonth)),
    card("Returning today", num(s.returningToday)),
    card("Returning this week", num(s.returningWeek)),
  ].join("");
  return section("users", "1 · Core User Metrics", `<div class="stat-grid">${grid}</div>`, "profiles-only");
}

function renderRetention(s: any): string {
  if (isErr(s)) return errorCard("Retention", s);
  const row = (label: string, d: any) => {
    if (!d) return "";
    if (d.label) return card(label, `<span class="muted">${esc(d.label)}</span>`, `${num(d.eligible)} eligible`);
    return card(label, pctStr(d.percentage), `${num(d.retained)}/${num(d.eligible)} retained`);
  };
  const grid = [row("Day 1", s.d1), row("Day 7", s.d7), row("Day 30", s.d30)].join("");
  return section("retention", "2 · Retention", `<div class="stat-grid">${grid}</div>`, "first active day = profile created");
}

function renderFunnel(s: any): string {
  if (isErr(s)) return errorCard("Activation Funnel", s);
  const rows = (s.stages ?? []).map((st: any) => `
    <tr>
      <td>${esc(st.label)}</td>
      <td class="r">${num(st.count)}</td>
      <td class="r">${pctStr(st.pctOfTotal)}</td>
      <td class="r">${st.dropFromPrev === null ? "—" : pctStr(st.dropFromPrev)}</td>
      <td style="width:30%">${bar(st.pctOfTotal)}</td>
    </tr>`).join("");
  return section("funnel", "3 · Activation Funnel",
    `<div class="card"><table>
      <thead><tr><th>Stage</th><th class="r">Users</th><th class="r">% of profiles</th><th class="r">Drop-off</th><th>—</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`, "profiles-only");
}

function renderConversion(s: any): string {
  if (isErr(s)) return errorCard("Account Funnel", s);
  const grid = [
    card("Onboarding starts", num(s.onboardingStarts)),
    card("Account creations", num(s.accountCreated)),
    card("Login successes", num(s.loginSuccess)),
    card("Acct conversion (onboarding)", pctStr(s.conversionFromOnboarding)),
  ].join("");
  return section("conversion", "4 · Account Funnel", `<div class="stat-grid">${grid}</div>`, "account required — no guests");
}

function renderSessions(s: any): string {
  if (isErr(s)) return errorCard("Session / App Open", s);
  const sessLen = s.avgSessionLabel
    ? `<span class="muted">${esc(s.avgSessionLabel)}</span>`
    : `${Math.round((s.avgSessionMs ?? 0) / 1000)}s`;
  const grid = [
    card("App opens today", num(s.appOpensToday)),
    card("App opens (7d)", num(s.appOpens7)),
    card("Sessions today", num(s.sessionsToday)),
    card("Sessions (7d)", num(s.sessions7)),
    card("Avg session length", sessLen),
    card("Sessions/active/day", num(s.sessionsPerActivePerDay)),
    card("Avg sessions/profile", num(s.avgSessionsPerProfile)),
  ].join("");
  return section("sessions", "5 · Session / App Open", `<div class="stat-grid">${grid}</div>`);
}

function renderScans(s: any): string {
  if (isErr(s)) return errorCard("Scan Metrics", s);
  const grid = [
    card("Scans started", num(s.started)),
    card("Scans completed", num(s.completed)),
    card("Scans failed", num(s.failed)),
    card("Completion rate", pctStr(s.completionRate)),
    card("Total saved (table)", num(s.totalSaved)),
    card("Listing generations", num(s.listingGen)),
    card("Listing rate/completed", pctStr(s.listingRatePerCompleted)),
    card("Avg scans/active/day", num(s.avgPerActive)),
    card("Median scans/active", num(s.median)),
    card("% users 5+ scans/day", pctStr(s.pct5Plus)),
  ].join("");
  const dailyRows = (s.dailyTable ?? []).map((d: any) => `
    <tr><td>${esc(d.date)}</td><td class="r">${num(d.completed)}</td><td class="r">${num(d.failed)}</td><td class="r">${pctStr(d.completionRate)}</td></tr>`).join("");
  const daily = `<div class="card"><div class="card-h">Scans by day (last 7d)</div><table>
    <thead><tr><th>Date</th><th class="r">Completed</th><th class="r">Failed</th><th class="r">Completion</th></tr></thead>
    <tbody>${dailyRows}</tbody></table></div>`;
  return section("scans", "6 · Scan Metrics", `<div class="stat-grid">${grid}</div>${daily}`, "profiles-only");
}

function renderTrust(s: any): string {
  if (isErr(s)) return errorCard("Scan Trust / Feedback", s);
  if (s.noData) return section("trust", "7 · Scan Trust / Feedback", `<div class="card"><div class="muted">No feedback submitted yet.</div></div>`);
  const grid = [
    card("Total feedback", num(s.total)),
    card("Accurate", num(s.accurate)),
    card("Somewhat", num(s.somewhat)),
    card("Bad/inaccurate", num(s.bad)),
    card("Scan Trust Score", pctStr(s.trustScore), "(accurate + 0.5·somewhat) / total"),
  ].join("");
  const catRows = (s.byCategory ?? []).slice(0, 12).map((c: any) =>
    `<tr><td>${esc(c.key)}</td><td class="r">${num(c.total)}</td><td class="r">${pctStr(c.score)}</td></tr>`).join("");
  const brandRows = (s.byBrand ?? []).slice(0, 12).map((c: any) =>
    `<tr><td>${esc(c.key)}</td><td class="r">${num(c.total)}</td><td class="r">${pctStr(c.score)}</td></tr>`).join("");
  const worstRows = (s.worstCategories ?? []).map((c: any) =>
    `<tr><td>${esc(c.key)}</td><td class="r">${num(c.total)}</td><td class="r">${pctStr(c.score)}</td></tr>`).join("");
  const recentRows = (s.recent ?? []).map((r: any) => `
    <tr>
      <td>${dateOnly(r.date)}</td>
      <td>${esc(r.item_title ?? "—")}</td>
      <td>${esc(r.brand ?? "—")}</td>
      <td>${esc(r.category ?? "—")}</td>
      <td>${esc(r.rating ?? "—")}</td>
      <td>${esc(r.recommendation ?? "—")}</td>
      <td class="r">${r.ai_value != null ? "$" + num(r.ai_value) : "—"}</td>
      <td class="r">${r.user_value != null ? "$" + num(r.user_value) : "—"}</td>
      <td class="r">${r.notes_present ? (r.note_length ? r.note_length + " ch" : "yes") : "—"}</td>
    </tr>`).join("");
  const tables = `
    <div class="two-col">
      <div class="card"><div class="card-h">Trust by category</div><table><thead><tr><th>Category</th><th class="r">N</th><th class="r">Score</th></tr></thead><tbody>${catRows || emptyRow(3)}</tbody></table></div>
      <div class="card"><div class="card-h">Trust by brand</div><table><thead><tr><th>Brand</th><th class="r">N</th><th class="r">Score</th></tr></thead><tbody>${brandRows || emptyRow(3)}</tbody></table></div>
    </div>
    <div class="card"><div class="card-h">Worst categories (≥2 ratings)</div><table><thead><tr><th>Category</th><th class="r">N</th><th class="r">Score</th></tr></thead><tbody>${worstRows || emptyRow(3)}</tbody></table></div>
    <div class="card"><div class="card-h">Recent feedback</div><div class="scroll-x"><table>
      <thead><tr><th>Date</th><th>Item</th><th>Brand</th><th>Category</th><th>Rating</th><th>Rec</th><th class="r">AI $</th><th class="r">User $</th><th class="r">Notes</th></tr></thead>
      <tbody>${recentRows || emptyRow(9)}</tbody></table></div></div>`;
  return section("trust", "7 · Scan Trust / Feedback", `<div class="stat-grid">${grid}</div>${tables}`);
}

function renderCost(s: any): string {
  if (isErr(s)) return errorCard("Cost / Budget", s);
  const grid = [
    card("Est. cost today", money(s.costToday)),
    card("Est. cost (7d)", money(s.cost7)),
    card("Est. cost (30d)", money(s.cost30)),
    card("Est. cost/active user", money(s.costPerActiveUser)),
    card("Est. cost/completed scan", money(s.costPerCompletedScan)),
    card("Total images (30d)", num(s.totalImages)),
    card("Avg images/scan", num(s.avgImagesPerScan)),
    card("Monthly budget used", s.hasBudget ? pctStr(s.budgetUsedPct) : "—", s.hasBudget ? `of ${money(s.monthlyBudget)}` : "no budget set"),
  ].join("");
  const rates = s.rates ? `<div class="card"><div class="muted">Rate assumptions — normal ${money(s.rates.NORMAL)}, hunt ${money(s.rates.HUNT)}, listing ${money(s.rates.LISTING)}, deep ${money(s.rates.DEEP)} per call. ${esc(s.tokenNote)}.</div></div>` : "";
  return section("cost", "8 · Cost / Budget", `<div class="stat-grid">${grid}</div>${rates}`, "Estimated");
}

function renderHunt(s: any): string {
  if (isErr(s)) return errorCard("Hunt Mode", s);
  const grid = [
    card("Hunt Mode opens", num(s.opened)),
    card("Hunts started", num(s.started)),
    card("Hunts ended", num(s.ended)),
    card("Hunt scans", num(s.huntScans)),
    card("Items saved", num(s.itemsSaved)),
    card("Avg items/hunt", num(s.avgItemsPerHunt)),
    card("Open → start rate", pctStr(s.openToStartRate)),
    card("Completion rate", pctStr(s.completionRate)),
    card("Abandoned", s.abandoned === null ? "Not tracked" : num(s.abandoned)),
    card("Avg duration", s.avgDuration === null ? "Not tracked" : num(s.avgDuration)),
  ].join("");
  return section("hunt", "9 · Hunt Mode", `<div class="stat-grid">${grid}</div>`);
}

function renderProgress(s: any): string {
  if (isErr(s)) return errorCard("Progress Tab Engagement", s);
  const grid = [
    card("Progress opens", num(s.progress?.total), `${num(s.progress?.uniqueUsers)} users`),
    card("Achievements opens", num(s.ach?.total), `${num(s.ach?.uniqueUsers)} users`),
    card("Brand Compendium opens", num(s.brand?.total), `${num(s.brand?.uniqueUsers)} users`),
    card("Diamonds opens", num(s.dia?.total), `${num(s.dia?.uniqueUsers)} users`),
    card("Opens/active user", num(s.opensPerActive)),
    card("Brand detail opens", num(s.brandDetailOpens)),
    card("Diamond detail opens", num(s.diamondDetailOpens)),
    card("Achievement cat. opens", num(s.achievementCategoryOpens)),
    card("Brand rarity opens", num(s.brandRarityOpens)),
  ].join("");
  const sh = s.subsectionShare ?? {};
  const shareTable = `<div class="card"><div class="card-h">Most popular Progress subsection (share of subsection clicks)</div><table>
    <thead><tr><th>Subsection</th><th class="r">Share</th><th>—</th></tr></thead><tbody>
    <tr><td>Achievements</td><td class="r">${pctStr(sh.achievements)}</td><td style="width:40%">${bar(sh.achievements)}</td></tr>
    <tr><td>Brand Compendium</td><td class="r">${pctStr(sh.brands)}</td><td>${bar(sh.brands)}</td></tr>
    <tr><td>Diamonds in the Rough</td><td class="r">${pctStr(sh.diamonds)}</td><td>${bar(sh.diamonds)}</td></tr>
    </tbody></table></div>`;
  return section("progress", "10 · Progress Tab Engagement", `<div class="stat-grid">${grid}</div>${shareTable}`);
}

function rarityBadge(label: string): string {
  const cls = "rb-" + esc(label).toLowerCase().replace(/[^a-z]/g, "");
  return `<span class="rb ${cls}">${esc(label)}</span>`;
}

function renderAchievements(s: any): string {
  if (isErr(s)) return errorCard("Achievement Analytics", s);
  const grid = [
    card("Total unlocked", num(s.totalUnlocked)),
    card("Avg per user", num(s.avgPerUser)),
    card("% with ≥1", pctStr(s.pctWithAny)),
    card("% with 5+", pctStr(s.pctWith5)),
    card("% with 10+", pctStr(s.pctWith10)),
  ].join("");
  const cats = Object.entries(s.byCategory ?? {}).map(([cat, rows]: any) => {
    const body = rows.map((r: any) => `
      <tr><td>${esc(r.name)}</td><td class="mono">${esc(r.id)}</td><td class="r">${num(r.users)}</td><td class="r">${pctStr(r.pct)}</td><td>${rarityBadge(r.rarity)}</td></tr>`).join("");
    return `<details class="card" open><summary>${esc(cat)} · ${rows.length}</summary><table>
      <thead><tr><th>Achievement</th><th>ID</th><th class="r">Users</th><th class="r">% users</th><th>Rarity</th></tr></thead>
      <tbody>${body}</tbody></table></details>`;
  }).join("");
  return section("achievements", "11 · Achievement Analytics",
    `<div class="stat-grid">${grid}</div>${cats}`, "source: user_achievements");
}

function renderBrands(s: any): string {
  if (isErr(s)) return errorCard("Brand Compendium Analytics", s);
  const rc = s.rarityCounts ?? {};
  const grid = [
    card("Total discoveries", num(s.totalDiscoveries)),
    card("Unique brands found", num(s.uniqueBrands), `of ${num(s.totalSupported)} supported`),
    card("Avg per user", num(s.avgPerUser)),
    card("% with ≥1 brand", pctStr(s.pctWithAny)),
    card("Common", num(rc.common)),
    card("Uncommon", num(rc.uncommon)),
    card("Rare", num(rc.rare)),
    card("Legendary", num(rc.legendary)),
  ].join("");
  const brandRow = (b: any) => `
    <tr><td>${esc(b.name)}</td><td>${rarityBadge(b.rarity)}</td><td>${esc(b.category ?? "—")}</td>
    <td class="r">${num(b.users)}</td><td class="r">${pctStr(b.pct)}</td>
    <td class="r">${num(b.detailOpens)}</td><td class="r">${b.detailClickRate === null ? "—" : pctStr(b.detailClickRate)}</td></tr>`;
  const list = (title: string, rows: any[]) =>
    `<div class="card"><div class="card-h">${esc(title)}</div><table>
      <thead><tr><th>Brand</th><th>Rarity</th><th>Category</th><th class="r">Users</th><th class="r">% users</th><th class="r">Detail opens</th><th class="r">Click rate</th></tr></thead>
      <tbody>${rows.map(brandRow).join("") || emptyRow(7)}</tbody></table></div>`;
  const rp = s.rarityPageOpens ?? {};
  const rarityPages = `<div class="card"><div class="card-h">Brand rarity page opens</div><table>
    <thead><tr><th>Rarity</th><th class="r">Opens</th></tr></thead><tbody>
    <tr><td>Common</td><td class="r">${num(rp.common)}</td></tr>
    <tr><td>Uncommon</td><td class="r">${num(rp.uncommon)}</td></tr>
    <tr><td>Rare</td><td class="r">${num(rp.rare)}</td></tr>
    <tr><td>Legendary</td><td class="r">${num(rp.legendary)}</td></tr>
    </tbody></table></div>`;
  // Full by-rarity collapsible
  const byRarity = Object.entries(s.byRarity ?? {}).map(([rar, rows]: any) =>
    `<details class="card"><summary>${esc(rar)} · ${rows.length}</summary><table>
      <thead><tr><th>Brand</th><th>Category</th><th class="r">Users</th><th class="r">% users</th><th class="r">Detail opens</th></tr></thead>
      <tbody>${rows.map((b: any) => `<tr><td>${esc(b.name)}</td><td>${esc(b.category ?? "—")}</td><td class="r">${num(b.users)}</td><td class="r">${pctStr(b.pct)}</td><td class="r">${num(b.detailOpens)}</td></tr>`).join("")}</tbody></table></details>`).join("");
  return section("brands", "12 · Brand Compendium Analytics",
    `<div class="stat-grid">${grid}</div>
     ${list("Most discovered brands", s.mostDiscovered ?? [])}
     ${list("Most clicked brand details", s.mostClicked ?? [])}
     ${list("Supported but never discovered", s.leastDiscovered ?? [])}
     ${rarityPages}
     <h3>All brands by rarity</h3>${byRarity}`, "source: user_brand_discoveries");
}

function renderDiamonds(s: any): string {
  if (isErr(s)) return errorCard("Diamonds in the Rough Analytics", s);
  const grid = [
    card("Total unlocks", num(s.totalUnlocks)),
    card("Unique diamonds", num(s.uniqueDiamonds), `of ${num(s.totalCatalog)} total`),
    card("Avg per user", num(s.avgPerUser)),
    card("% with ≥1 diamond", pctStr(s.pctWithAny)),
  ].join("");
  const diaRow = (d: any) => `
    <tr><td>${esc(d.title)}</td><td class="mono">${esc(d.id)}</td><td>${esc(d.category ?? "—")}</td>
    <td class="r">${num(d.users)}</td><td class="r">${pctStr(d.pct)}</td>
    <td class="r">${num(d.detailOpens)}</td><td class="r">${d.detailClickRate === null ? "—" : pctStr(d.detailClickRate)}</td></tr>`;
  const list = (title: string, rows: any[]) =>
    `<div class="card"><div class="card-h">${esc(title)}</div><table>
      <thead><tr><th>Diamond</th><th>ID</th><th>Category</th><th class="r">Users</th><th class="r">% users</th><th class="r">Detail opens</th><th class="r">Click rate</th></tr></thead>
      <tbody>${rows.map(diaRow).join("") || emptyRow(7)}</tbody></table></div>`;
  const never = (s.neverUnlocked ?? []).map((d: any) =>
    `<tr><td>${esc(d.title)}</td><td class="mono">${esc(d.id)}</td><td>${esc(d.category ?? "—")}</td></tr>`).join("");
  const neverCard = `<details class="card"><summary>Diamonds never unlocked · ${(s.neverUnlocked ?? []).length}</summary>
    <table><thead><tr><th>Diamond</th><th>ID</th><th>Category</th></tr></thead><tbody>${never || emptyRow(3)}</tbody></table></details>`;
  return section("diamonds", "13 · Diamonds in the Rough Analytics",
    `<div class="stat-grid">${grid}</div>
     ${list("Most unlocked diamonds", s.mostUnlocked ?? [])}
     ${list("Most clicked diamonds", s.mostClicked ?? [])}
     ${neverCard}`, "source: user_diamond_discoveries");
}

function renderListings(s: any): string {
  if (isErr(s)) return errorCard("Listing Generation", s);
  const p = s.platforms ?? {};
  const grid = [
    card("Total generations", num(s.total)),
    card("Today", num(s.today)),
    card("Last 7d", num(s.last7)),
    card("Rate/completed scan", pctStr(s.ratePerCompleted)),
    card("Rate/saved scan", pctStr(s.ratePerSaved)),
    card("eBay", num(p.ebay)),
    card("Depop", num(p.depop)),
    card("Both", num(p.both)),
    card("Failures", num(s.failures), s.failureRate === null ? "" : `${s.failureRate}% fail rate`),
  ].join("");
  const failRows = (s.recentFailures ?? []).map((f: any) =>
    `<tr><td>${dateOnly(f.date)}</td><td>${esc(f.item_title ?? "—")}</td><td>${esc(f.platform ?? "—")}</td><td>${esc(f.error_code ?? "—")}</td><td>${esc(f.stage ?? "—")}</td></tr>`).join("");
  const fails = (s.recentFailures ?? []).length
    ? `<div class="card"><div class="card-h">Recent failures</div><table><thead><tr><th>Date</th><th>Item</th><th>Platform</th><th>Error</th><th>Stage</th></tr></thead><tbody>${failRows}</tbody></table></div>`
    : "";
  return section("listings", "14 · Listing Generation", `<div class="stat-grid">${grid}</div>${fails}`);
}

function renderDataQuality(s: any): string {
  if (isErr(s)) return errorCard("Data Quality / Tracking Status", s);
  const grid = [
    card("Total events", num(s.totalEvents)),
    card("Events today", num(s.eventsToday)),
    card("Events w/ user_id", num(s.withUser)),
    card("Anon-only events", num(s.anonOnly)),
    card("Missing session_id", num(s.missingSession)),
    card("Latest event", dt(s.latestEvent)),
    card("Latest profile", dt(s.latestProfile)),
    card("Latest scan saved", dt(s.latestScan)),
  ].join("");
  const t = s.tables ?? {};
  const tbl = Object.entries(t).map(([name, ok]: any) =>
    `<tr><td class="mono">${esc(name)}</td><td>${ok ? '<span class="ok">connected</span>' : '<span class="bad">failed</span>'}</td></tr>`).join("");
  const ts = s.trackingStatus ?? {};
  const tags = (arr: string[], cls: string) => (arr ?? []).map(x => `<span class="tag ${cls}">${esc(x)}</span>`).join(" ");
  const statusCard = `<div class="card"><div class="card-h">Metric trust</div>
    <div class="tag-row"><span class="tag-lbl">Exact:</span> ${tags(ts.exact, "tag-ok")}</div>
    <div class="tag-row"><span class="tag-lbl">Estimated:</span> ${tags(ts.estimated, "tag-est")}</div>
    <div class="tag-row"><span class="tag-lbl">Not tracked yet:</span> ${tags(ts.notTracked, "tag-no")}</div></div>`;
  const connCard = `<div class="card"><div class="card-h">Table connectivity</div><table><thead><tr><th>Table</th><th>Status</th></tr></thead><tbody>${tbl}</tbody></table></div>`;
  return section("dataquality", "15 · Data Quality / Tracking Status",
    `<div class="stat-grid">${grid}</div><div class="two-col">${connCard}${statusCard}</div>`);
}

function renderSold(s: any): string {
  if (isErr(s)) return errorCard("Sold Items / Realized Profit", s);
  if (!s || !s.itemsSold) {
    return section("sold", "16 \u00b7 Sold Items / Realized Profit",
      `<div class="card"><div class="muted">No items marked sold yet.</div></div>`,
      "gross = sold \u2212 paid, pre-fees");
  }
  const acc = s.accuracy ?? {};
  const grid = [
    card("Items sold", num(s.itemsSold), `of ${num(s.totalScans)} total scans`),
    card("Realized revenue", "$" + num(s.realizedRevenue)),
    card("Gross realized profit", "$" + num(s.grossProfit), "sold \u2212 paid, pre-fees"),
    card("Avg sale price", "$" + num(s.avgSalePrice)),
    card("Sell-through rate", pctStr(s.sellThroughPct)),
    card("Avg days to sell", s.avgDaysToSell != null ? num(s.avgDaysToSell) : "\u2014"),
    card("AI avg \u0394 vs estimate", acc.avgDeltaPct != null ? `${acc.avgDeltaPct > 0 ? "+" : ""}${acc.avgDeltaPct}%` : "\u2014", `${num(acc.compared)} compared`),
    card("Sold within \u00b120% of est.", acc.within20 != null ? pctStr(acc.within20) : "\u2014", `${num(acc.soldOver)} over \u00b7 ${num(acc.soldUnder)} under`),
  ].join("");

  const rows = (s.items ?? []).map((r: any) => {
    const dcls = r.deltaPct == null ? "" : (Math.abs(r.deltaPct) <= 20 ? "ok" : "bad");
    const dstr = r.deltaPct == null ? "\u2014"
      : `${r.deltaAbs > 0 ? "+" : ""}$${num(Math.abs(r.deltaAbs))} (${r.deltaPct > 0 ? "+" : ""}${r.deltaPct}%)`;
    return `<tr>
      <td>${dateOnly(r.soldAt)}</td>
      <td>${esc(r.item)}</td>
      <td>${esc(r.brand ?? "\u2014")}</td>
      <td>${esc(r.category ?? "\u2014")}</td>
      <td class="r">$${num(r.paid)}</td>
      <td class="r">${r.aiEst != null ? "$" + num(r.aiEst) : "\u2014"}</td>
      <td class="r">$${num(r.soldPrice)}</td>
      <td class="r ${dcls}">${dstr}</td>
      <td class="r">$${num(r.grossProfit)}</td>
      <td class="r">${r.daysToSell != null ? num(r.daysToSell) : "\u2014"}</td>
    </tr>`;
  }).join("");

  const table = `<div class="card"><div class="card-h">All sold items \u2014 AI estimate vs actual</div>
    <div class="scroll-x"><table>
      <thead><tr><th>Sold</th><th>Item</th><th>Brand</th><th>Category</th><th class="r">Paid</th><th class="r">AI Est.</th><th class="r">Sold For</th><th class="r">\u0394 vs Est.</th><th class="r">Gross Profit</th><th class="r">Days</th></tr></thead>
      <tbody>${rows || emptyRow(10)}</tbody></table></div></div>`;

  return section("sold", "16 \u00b7 Sold Items / Realized Profit",
    `<div class="stat-grid">${grid}</div>${table}`,
    "gross = sold \u2212 paid, pre-fees");
}

function emptyRow(cols: number): string {
  return `<tr><td colspan="${cols}" class="muted" style="text-align:center">No data yet</td></tr>`;
}

// ─── Page shell ──────────────────────────────────────────────────────────────

const CSS = `
:root{
  --bg:#0e1118; --panel:#161b26; --panel2:#1d2330; --border:#272f3f;
  --text:#e6ebf2; --muted:#8a95a8; --accent:#4a90d9; --accent2:#3ddc84;
  --gold:#d6a839; --red:#e06a5a;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
header.top{padding:22px 28px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,#141a26,#0e1118);position:sticky;top:0;z-index:10}
header.top h1{margin:0;font-size:20px;letter-spacing:.3px}
header.top .sub{color:var(--muted);font-size:13px;margin-top:3px}
header.top .meta{color:var(--muted);font-size:12px;margin-top:8px}
nav.toc{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
nav.toc a{font-size:11px;color:var(--muted);text-decoration:none;padding:4px 9px;border:1px solid var(--border);border-radius:6px;background:var(--panel)}
nav.toc a:hover{color:var(--text);border-color:var(--accent)}
main{padding:22px 28px;max-width:1280px;margin:0 auto}
section{margin:0 0 34px}
section h2{font-size:15px;text-transform:uppercase;letter-spacing:1px;color:#aeb9cc;border-bottom:1px solid var(--border);padding-bottom:8px;margin:0 0 16px;display:flex;align-items:center;gap:10px}
section h3{font-size:13px;color:var(--muted);margin:20px 0 10px;text-transform:uppercase;letter-spacing:.5px}
.note{font-size:11px;color:var(--gold);text-transform:none;letter-spacing:0;border:1px solid var(--gold);border-radius:5px;padding:1px 7px;font-weight:600}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:14px}
.stat{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.stat-v{font-size:22px;font-weight:700;color:#fff}
.stat-l{font-size:12px;color:var(--muted);margin-top:3px}
.stat-s{font-size:11px;color:var(--muted);opacity:.8;margin-top:4px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:0 0 14px}
.card-h{font-size:13px;font-weight:600;color:#c4cdda;margin-bottom:10px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:820px){.two-col{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
td.r,th.r{text-align:right}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted)}
.muted{color:var(--muted)}
.scroll-x{overflow-x:auto}
.bar{background:var(--panel2);border-radius:5px;height:9px;overflow:hidden}
.bar-fill{height:100%;border-radius:5px}
details.card summary{cursor:pointer;font-weight:600;color:#c4cdda;list-style:none}
details.card summary::-webkit-details-marker{display:none}
details.card summary:before{content:'▸ ';color:var(--accent)}
details.card[open] summary:before{content:'▾ '}
.err{border-color:var(--red)}
.err-msg{color:var(--red);font-size:13px}
.ok{color:var(--accent2)} .bad{color:var(--red)}
.rb{font-size:10px;padding:1px 7px;border-radius:5px;font-weight:600}
.rb-verycommon{background:#23303f;color:#8fb8e0}
.rb-common{background:#1f3327;color:#7fcf9b}
.rb-uncommon{background:#2f2a16;color:#d6c14a}
.rb-rare{background:#2e1f33;color:#c79be0}
.rb-veryrare{background:#3a1f24;color:#e69aa0}
.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:5px;margin:2px 0}
.tag-ok{background:#1f3327;color:#7fcf9b}
.tag-est{background:#2f2a16;color:#d6c14a}
.tag-no{background:#3a1f24;color:#e69aa0}
.tag-row{margin:6px 0}
.tag-lbl{color:var(--muted);font-size:12px;margin-right:6px}
.banner{background:#3a1f24;border:1px solid var(--red);color:#f0c0b8;padding:14px 18px;border-radius:10px;margin-bottom:20px}
`;

const TOC = [
  ["users", "Users"], ["retention", "Retention"], ["funnel", "Funnel"],
  ["conversion", "Account Funnel"], ["sessions", "Sessions"], ["scans", "Scans"],
  ["trust", "Trust"], ["cost", "Cost"], ["hunt", "Hunt"], ["progress", "Progress"],
  ["achievements", "Achievements"], ["brands", "Brands"], ["diamonds", "Diamonds"],
  ["listings", "Listings"], ["dataquality", "Data Quality"], ["sold", "Sold"],
];

export function generateFounderDashboardV3(metrics: any): string {
  // Not configured → friendly setup page (still 200, but clearly explains).
  if (metrics && metrics.configured === false) {
    return shell(`<div class="banner">
      <strong>Supabase not configured for the dashboard.</strong><br>
      Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> in the server
      environment (Railway), then reload. These are server-side only — never put the
      service-role key in the mobile app.</div>`, "—");
  }
  if (metrics && metrics.fatal) {
    return shell(`<div class="banner"><strong>Failed to load data:</strong> ${esc(metrics.fatal)}</div>`, "—");
  }

  const body = [
    renderUsers(metrics.users),
    renderRetention(metrics.retention),
    renderFunnel(metrics.funnel),
    renderConversion(metrics.conversion),
    renderSessions(metrics.sessions),
    renderScans(metrics.scans),
    renderTrust(metrics.trust),
    renderCost(metrics.cost),
    renderHunt(metrics.hunt),
    renderProgress(metrics.progress),
    renderAchievements(metrics.achievements),
    renderBrands(metrics.brands),
    renderDiamonds(metrics.diamonds),
    renderListings(metrics.listings),
    renderDataQuality(metrics.dataQuality),
    renderSold(metrics.sold),
  ].join("");

  return shell(body, metrics.generatedAt);
}

function shell(body: string, generatedAt: string): string {
  const toc = TOC.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join("");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlipStart Founder Dashboard V3</title><style>${CSS}</style></head>
<body>
<header class="top">
  <h1>FlipStart Founder Dashboard V3</h1>
  <div class="sub">Supabase-backed analytics • Profiles-only real users</div>
  <div class="meta">Last updated: ${dt(generatedAt)}</div>
  <nav class="toc">${toc}</nav>
</header>
<main>${body}</main>
</body></html>`;
}
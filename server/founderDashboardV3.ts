/**
 * server/founderDashboardV3.ts
 *
 * Section renderers and HTML helpers from Founder Dashboard V3, kept because
 * the V5 page (server/founderDashboardV4.ts) imports them: scans, trust,
 * cost, hunt, progress, achievements, brands, diamonds, listings and sold.
 * The V3 page itself is gone; this file no longer builds a whole page.
 *
 * READ-ONLY. No forms, no destructive controls, no write actions.
 * Every section guards against `{ error }` or missing data and renders an error
 * card instead of throwing, so one bad section never blanks the page.
 */

// ─── Small HTML helpers ──────────────────────────────────────────────────────

export const esc = (v: unknown): string =>
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
const dateOnly = (v: unknown): string => {
  if (!v) return "—";
  try { return new Date(String(v)).toLocaleDateString(); } catch { return esc(v); }
};

export function isErr(section: any): section is { error: string } {
  return section && typeof section === "object" && typeof section.error === "string";
}
export function errorCard(title: string, section: any): string {
  return `<div class="card err"><div class="card-h">${esc(title)}</div>
    <div class="err-msg">⚠ Section failed: ${esc(section.error)}</div></div>`;
}
export function card(label: string, value: string, sub = ""): string {
  return `<div class="stat"><div class="stat-v">${value}</div><div class="stat-l">${esc(label)}</div>${sub ? `<div class="stat-s">${esc(sub)}</div>` : ""}</div>`;
}
export function section(id: string, title: string, body: string, note = ""): string {
  return `<section id="${esc(id)}"><h2>${esc(title)}${note ? `<span class="note">${esc(note)}</span>` : ""}</h2>${body}</section>`;
}

// Horizontal bar (for funnel / shares).
export function bar(pctValue: number | null, colorVar = "--accent"): string {
  const w = Math.max(0, Math.min(100, pctValue ?? 0));
  return `<div class="bar"><div class="bar-fill" style="width:${w}%;background:var(${colorVar})"></div></div>`;
}

// ─── Section renderers ───────────────────────────────────────────────────────

export function renderScans(s: any): string {
  if (isErr(s)) return section("scans", "6 · Scan Metrics", errorCard("Scan Metrics", s));
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

export function renderTrust(s: any): string {
  if (isErr(s)) return section("trust", "7 · Scan Trust / Feedback", errorCard("Scan Trust / Feedback", s));
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

export function renderCost(s: any): string {
  if (isErr(s)) return section("cost", "8 · Cost / Budget", errorCard("Cost / Budget", s));
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

export function renderHunt(s: any): string {
  if (isErr(s)) return section("hunt", "9 · Hunt Mode", errorCard("Hunt Mode", s));
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

export function renderProgress(s: any): string {
  if (isErr(s)) return section("progress", "10 · Progress Tab Engagement", errorCard("Progress Tab Engagement", s));
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

export function renderAchievements(s: any, extra = ""): string {
  if (isErr(s)) return section("achievements", "11 · Achievement Analytics", errorCard("Achievement Analytics", s) + extra);
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
    return `<details class="card"><summary>${esc(cat)} · ${rows.length}</summary><table>
      <thead><tr><th>Achievement</th><th>ID</th><th class="r">Users</th><th class="r">% users</th><th>Rarity</th></tr></thead>
      <tbody>${body}</tbody></table></details>`;
  }).join("");
  return section("achievements", "11 · Achievement Analytics",
    `<div class="stat-grid">${grid}</div>${extra}<details class="more"><summary>Every achievement, by category</summary>${cats}</details>`, "source: user_achievements");
}

export function renderBrands(s: any): string {
  if (isErr(s)) return section("brands", "12 · Brand Compendium Analytics", errorCard("Brand Compendium Analytics", s));
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
     <details class="more"><summary>Brand lists: most found, most clicked, never found, by rarity</summary>
     ${list("Most discovered brands", s.mostDiscovered ?? [])}
     ${list("Most clicked brand details", s.mostClicked ?? [])}
     ${list("Supported but never discovered", s.leastDiscovered ?? [])}
     ${rarityPages}
     <h3>All brands by rarity</h3>${byRarity}</details>`, "source: user_brand_discoveries");
}

export function renderDiamonds(s: any): string {
  if (isErr(s)) return section("diamonds", "13 · Diamonds in the Rough Analytics", errorCard("Diamonds in the Rough Analytics", s));
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

export function renderListings(s: any): string {
  if (isErr(s)) return section("listings", "14 · Listing Generation", errorCard("Listing Generation", s));
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

export function renderSold(s: any): string {
  if (isErr(s)) return section("sold", "16 \u00b7 Sold Items / Realized Profit", errorCard("Sold Items / Realized Profit", s));
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

export function emptyRow(cols: number): string {
  return `<tr><td colspan="${cols}" class="muted" style="text-align:center">No data yet</td></tr>`;
}
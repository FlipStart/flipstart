/**
 * server/dashboard.ts
 * Generates the Founder Analytics Dashboard HTML.
 * Kept in its own file to avoid nested template literal issues in index.ts.
 */

interface Entry {
    timestamp:  number;
    scanId:     string;
    prediction: {
      itemName:        string;
      brand:           string;
      category:        string;
      resaleLow:       number;
      resaleHigh:      number;
      suggestedBuy:    number;
      demand:          string;
      bestPlatform:    string;
      confidenceScore: number;
      recommendation:  string;
    };
    feedback: {
      accuracyRating:     string | null;
      buyDecision:        string | null;
      userEstimatedValue: number | null;
      notes:              string | null;
    };
  }
  
  interface DashboardInput {
    entries:   Entry[];
    summary:   any;
    scanStats: any;
    secret:    string;
  }
  
  function esc(s: any): string {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  
  function fmt(n: number | null): string {
    return n == null ? "—" : "$" + n;
  }
  
  function pct(n: number, total: number): string {
    return total ? Math.round((n / total) * 100) + "%" : "0%";
  }
  
  function ts(n: number): string {
    return new Date(n).toLocaleString("en-US", { timeZone: "America/Chicago" });
  }
  
  function badge(text: string | null, type: string): string {
    if (!text) return "—";
    return '<span class="badge badge-' + type + '">' + esc(text) + "</span>";
  }
  
  function accuracyBadge(r: string | null): string {
    if (!r) return "—";
    const t = r === "accurate" ? "green" : r === "bad" ? "red" : "yellow";
    return badge(r, t);
  }
  
  function decisionBadge(d: string | null): string {
    if (!d) return "—";
    const t = d === "bought" ? "green" : d === "passed" ? "red" : "gray";
    return badge(d, t);
  }
  
  function th(cols: string[]): string {
    return "<tr>" + cols.map(c => "<th>" + esc(c) + "</th>").join("") + "</tr>";
  }
  
  function td(cells: string[]): string {
    return "<tr>" + cells.map(c => "<td>" + c + "</td>").join("") + "</tr>";
  }
  
  function card(label: string, value: string, sub = ""): string {
    return (
      '<div class="card">' +
      '<div class="cv">' + esc(value) + "</div>" +
      '<div class="cl">' + esc(label) + "</div>" +
      (sub ? '<div class="cs">' + esc(sub) + "</div>" : "") +
      "</div>"
    );
  }
  
  export function generateDashboard({ entries, summary, scanStats, secret }: DashboardInput): string {
    const total = summary.total ?? 0;
  
    const accurateCount = summary.accuracyRatings?.accurate ?? 0;
    const somewhatCount = summary.accuracyRatings?.somewhat ?? 0;
    const badCount      = summary.accuracyRatings?.bad      ?? 0;
    const boughtCount   = summary.buyDecisions?.bought      ?? 0;
    const passedCount   = summary.buyDecisions?.passed      ?? 0;
    const unsureCount   = summary.buyDecisions?.unsure      ?? 0;
  
    const avgPredicted = total
      ? Math.round(entries.reduce((s, e) => s + e.prediction.resaleHigh, 0) / total)
      : 0;
  
    const withEst = entries.filter(e => e.feedback.userEstimatedValue != null);
    const avgUser = withEst.length
      ? Math.round(withEst.reduce((s, e) => s + (e.feedback.userEstimatedValue ?? 0), 0) / withEst.length)
      : null;
    const avgDiff = withEst.length
      ? Math.round(withEst.reduce((s, e) => s + ((e.feedback.userEstimatedValue ?? 0) - e.prediction.resaleHigh), 0) / withEst.length)
      : null;
  
    // Biggest misses
    const misses = withEst
      .map(e => ({ ...e, diff: (e.feedback.userEstimatedValue ?? 0) - e.prediction.resaleHigh }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 20);
  
    // Recent entries
    const recent = [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
  
    // By category
    const byCat: Record<string, Entry[]> = {};
    entries.forEach(e => {
      const c = e.prediction.category || "Unknown";
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(e);
    });
  
    // By platform
    const byPlat: Record<string, Entry[]> = {};
    entries.forEach(e => {
      const p = e.prediction.bestPlatform || "Unknown";
      if (!byPlat[p]) byPlat[p] = [];
      byPlat[p].push(e);
    });
  
    const topPlatform = Object.entries(byPlat).sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? "—";
    const usedPct = Math.round((scanStats.globalScansUsedToday / scanStats.globalDailyLimit) * 100);
  
    const CSS = [
      "* { box-sizing: border-box; margin: 0; padding: 0; }",
      "body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; font-size: 14px; }",
      ".topbar { background: #1a2035; padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2d3748; }",
      ".topbar h1 { font-size: 18px; font-weight: 700; color: #f0c040; }",
      ".topbar .meta { font-size: 12px; color: #718096; }",
      ".container { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }",
      "h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #a0aec0; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #2d3748; }",
      ".cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }",
      ".card { background: #1a2035; border: 1px solid #2d3748; border-radius: 8px; padding: 14px 18px; min-width: 130px; }",
      ".cv { font-size: 24px; font-weight: 800; color: #f0c040; }",
      ".cl { font-size: 11px; color: #718096; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }",
      ".cs { font-size: 11px; color: #4a5568; margin-top: 2px; }",
      "table { width: 100%; border-collapse: collapse; background: #1a2035; border-radius: 8px; overflow: hidden; margin-bottom: 8px; }",
      "th { background: #243050; padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #a0aec0; }",
      "td { padding: 8px 12px; border-top: 1px solid #2d3748; color: #cbd5e0; vertical-align: top; font-size: 13px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
      "tr:hover td { background: #1e2a45; }",
      ".badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 700; }",
      ".badge-green  { background: #1c4532; color: #68d391; }",
      ".badge-yellow { background: #2d3319; color: #f6e05e; }",
      ".badge-red    { background: #4a1c1c; color: #fc8181; }",
      ".badge-gray   { background: #2d3748; color: #a0aec0; }",
      ".exports { display: flex; gap: 10px; margin: 16px 0; }",
      ".exports a { background: #243050; color: #90cdf4; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 600; border: 1px solid #2d3748; }",
      ".scan-bar { background: #1a2035; border: 1px solid #2d3748; border-radius: 8px; padding: 14px 18px; margin-bottom: 8px; display: flex; gap: 32px; align-items: center; }",
      ".sv { font-size: 28px; font-weight: 800; color: #f0c040; }",
      ".sl { font-size: 11px; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; }",
      ".bar { height: 8px; border-radius: 4px; background: #2d3748; margin-top: 8px; width: 200px; }",
      ".bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg,#f0c040,#e53e3e); }",
      ".pos { color: #68d391; } .neg { color: #fc8181; }",
      "footer { text-align: center; color: #2d3748; font-size: 11px; padding: 32px; }",
      ".empty { color: #4a5568; padding: 12px; }",
    ].join(" ");
  
    // Build section: biggest misses
    let missesSection = '<p class="empty">No entries with user estimates yet.</p>';
    if (misses.length > 0) {
      const rows = misses.map(e => {
        const diffStr = (e.diff >= 0 ? '<span class="pos">+' : '<span class="neg">') + e.diff + "</span>";
        return td([
          esc(ts(e.timestamp)),
          esc(e.prediction.itemName),
          esc(e.prediction.brand),
          esc(e.prediction.category),
          esc(fmt(e.prediction.resaleHigh)),
          esc(fmt(e.feedback.userEstimatedValue)),
          diffStr,
          accuracyBadge(e.feedback.accuracyRating),
          esc(e.feedback.notes ?? "—"),
        ]);
      }).join("");
      missesSection = "<table><thead>" +
        th(["Time","Item","Brand","Category","AI High","User Est.","Diff","Accuracy","Notes"]) +
        "</thead><tbody>" + rows + "</tbody></table>";
    }
  
    // Build section: recent
    let recentSection = '<p class="empty">No feedback yet.</p>';
    if (recent.length > 0) {
      const rows = recent.map(e => td([
        esc(ts(e.timestamp)),
        esc(e.prediction.itemName),
        esc(e.prediction.brand),
        esc(e.prediction.category),
        esc(fmt(e.prediction.resaleLow) + "–" + fmt(e.prediction.resaleHigh)),
        esc(fmt(e.feedback.userEstimatedValue)),
        accuracyBadge(e.feedback.accuracyRating),
        decisionBadge(e.feedback.buyDecision),
        esc(e.prediction.confidenceScore + "%"),
        esc(e.prediction.bestPlatform),
        esc(e.feedback.notes ?? "—"),
      ])).join("");
      recentSection = "<table><thead>" +
        th(["Time","Item","Brand","Category","AI Range","User Est.","Accuracy","Decision","Conf","Platform","Notes"]) +
        "</thead><tbody>" + rows + "</tbody></table>";
    }
  
    // Build section: categories
    let catSection = '<p class="empty">No data yet.</p>';
    if (Object.keys(byCat).length > 0) {
      const rows = Object.entries(byCat)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([cat, es]) => {
          const we    = es.filter(e => e.feedback.userEstimatedValue != null);
          const avgAI = Math.round(es.reduce((s, e) => s + e.prediction.resaleHigh, 0) / es.length);
          const avgU  = we.length ? Math.round(we.reduce((s, e) => s + (e.feedback.userEstimatedValue ?? 0), 0) / we.length) : null;
          const avgD  = we.length ? Math.round(we.reduce((s, e) => s + ((e.feedback.userEstimatedValue ?? 0) - e.prediction.resaleHigh), 0) / we.length) : null;
          const bads  = es.filter(e => e.feedback.accuracyRating === "bad").length;
          return td([
            esc(cat), String(es.length), esc(fmt(avgAI)), esc(fmt(avgU)),
            avgD == null ? "—" : (avgD >= 0 ? "+" : "") + avgD,
            bads > 0 ? badge(String(bads), "red") : "0",
          ]);
        }).join("");
      catSection = "<table><thead>" +
        th(["Category","Count","Avg AI","Avg User","Avg Diff","Bad"]) +
        "</thead><tbody>" + rows + "</tbody></table>";
    }
  
    // Build section: platforms
    let platSection = '<p class="empty">No data yet.</p>';
    if (Object.keys(byPlat).length > 0) {
      const rows = Object.entries(byPlat)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([plat, es]) => {
          const avgConf = Math.round(es.reduce((s, e) => s + e.prediction.confidenceScore, 0) / es.length);
          const we      = es.filter(e => e.feedback.userEstimatedValue != null);
          const avgD    = we.length ? Math.round(we.reduce((s, e) => s + ((e.feedback.userEstimatedValue ?? 0) - e.prediction.resaleHigh), 0) / we.length) : null;
          return td([esc(plat), String(es.length), avgConf + "%", avgD == null ? "—" : (avgD >= 0 ? "+" : "") + avgD]);
        }).join("");
      platSection = "<table><thead>" +
        th(["Platform","Scans","Avg Confidence","Avg User Diff"]) +
        "</thead><tbody>" + rows + "</tbody></table>";
    }
  
    const dataDir = process.env.DATA_DIR ?? "/tmp";
    const now     = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  
    return [
      "<!DOCTYPE html><html lang='en'><head>",
      "<meta charset='UTF-8'>",
      "<meta name='viewport' content='width=device-width,initial-scale=1'>",
      "<title>FlipStart Founder Dashboard</title>",
      "<style>" + CSS + "</style>",
      "</head><body>",
      "<div class='topbar'><h1>⚡ FlipStart Founder Dashboard</h1>",
      "<div class='meta'>Beta · Private · " + now + " CT</div></div>",
      "<div class='container'>",
  
      "<div class='exports'>",
      "<a href='/api/dev/feedback?secret=" + esc(secret) + "'>📄 Raw JSON</a>",
      "<a href='/api/dev/feedback.csv?secret=" + esc(secret) + "'>⬇️ Download CSV</a>",
      "</div>",
  
      "<h2>Scan Budget</h2>",
      "<div class='scan-bar'>",
      "<div><div class='sv'>" + scanStats.globalScansRemainingToday + "</div><div class='sl'>Scans Left Today</div></div>",
      "<div><div class='sv' style='color:#a0aec0'>" + scanStats.globalScansUsedToday + "</div><div class='sl'>Used Today</div></div>",
      "<div><div class='sv' style='color:#a0aec0'>" + scanStats.globalDailyLimit + "</div><div class='sl'>Daily Limit</div></div>",
      "<div><div class='sl' style='margin-bottom:4px'>Daily Usage</div>",
      "<div class='bar'><div class='bar-fill' style='width:" + usedPct + "%'></div></div>",
      "<div style='font-size:11px;color:#4a5568;margin-top:4px'>Resets: " + esc(new Date(scanStats.resetTime).toLocaleString("en-US", { timeZone: "America/Chicago" })) + "</div></div>",
      "</div>",
  
      "<h2>Overview</h2><div class='cards'>",
      card("Total Feedback",    String(total)),
      card("Accurate",          String(accurateCount), pct(accurateCount, total)),
      card("Somewhat",          String(somewhatCount), pct(somewhatCount, total)),
      card("Bad Analysis",      String(badCount),      pct(badCount,      total)),
      card("Bought",            String(boughtCount),   pct(boughtCount,   total)),
      card("Passed",            String(passedCount),   pct(passedCount,   total)),
      card("Unsure",            String(unsureCount),   pct(unsureCount,   total)),
      card("Avg AI Resale",     fmt(avgPredicted)),
      card("Avg User Est.",     fmt(avgUser)),
      card("Avg Diff",          avgDiff == null ? "—" : (avgDiff >= 0 ? "+" : "") + "$" + Math.abs(avgDiff)),
      card("Top Category",      summary.topCategory ?? "—"),
      card("Top Platform",      topPlatform),
      "</div>",
  
      "<h2>Biggest AI Pricing Misses</h2>", missesSection,
      "<h2>Recent Feedback</h2>",           recentSection,
      "<h2>Category Insights</h2>",         catSection,
      "<h2>Platform Insights</h2>",         platSection,
  
      "<footer>FlipStart Founder Dashboard · Internal Only · " + total + " feedback entries · " + dataDir + "/flipstart-beta.json</footer>",
      "</div></body></html>",
    ].join("\n");
  }
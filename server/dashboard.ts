/**
 * server/dashboard.ts
 * Founder analytics dashboard — internal only, protected by DEV_SECRET.
 * Built via string concatenation (zero backtick nesting).
 *
 * v2 changes:
 *  - Diff uses aiEstimatedResale (adjusted_estimated_value), not resaleHigh
 *  - Recommendation trust analytics
 *  - Override tracking
 *  - Category trust score (worst first)
 *  - False positive / false negative detection
 *  - Confidence calibration buckets
 *  - Missing data diagnostics
 *  - Outcome schema ready (not yet collected in UI)
 */

const SIGNIFICANT_DIFF_PCT = 30;
const SIGNIFICANT_DIFF_ABS = 10;

interface Entry {
  timestamp:   number;
  scanId:      string;
  prediction: {
    itemName:           string;
    brand:              string;
    category:           string;
    resaleLow:          number;
    resaleHigh:         number;
    suggestedBuy:       number;
    aiEstimatedResale?: number;
    demand:             string;
    bestPlatform:       string;
    confidenceScore:    number;
    recommendation:     string;
  };
  feedback: {
    accuracyRating:     string | null;
    buyDecision:        string | null;
    userEstimatedValue: number | null;
    notes:              string | null;
  };
  outcome?: {
    actualSoldPrice?:        number;
    actualPlatformSold?:     string;
    actualDaysToSell?:       number;
    listingCreated?:         boolean;
    soldOutcomeSubmittedAt?: number;
  };
}

interface DashboardInput {
  entries:   Entry[];
  summary:   any;
  scanStats: any;
  analytics: any;   // getAnalyticsSummary() output — may be empty object if no events yet
  secret:    string;
}

function esc(s: any): string {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmt(n: number | null | undefined): string {
  return (n == null || isNaN(n as number)) ? "—" : "$" + n;
}
function pct(n: number, d: number): string {
  return d > 0 ? Math.round(n / d * 100) + "%" : "—";
}
function tsStr(n: number): string {
  return new Date(n).toLocaleString("en-US", { timeZone: "America/Chicago" });
}
function badge(text: string | null, type: string): string {
  if (!text) return "—";
  return '<span class="badge badge-' + type + '">' + esc(text) + "</span>";
}
function accuracyBadge(r: string | null): string {
  const t = r === "accurate" ? "green" : r === "bad" ? "red" : r === "somewhat" ? "yellow" : "gray";
  return badge(r, t);
}
function decisionBadge(d: string | null): string {
  const t = d === "bought" ? "green" : d === "passed" ? "red" : "gray";
  return badge(d, t);
}
function recBadge(r: string | null): string {
  if (!r) return "—";
  const lower = r.toLowerCase();
  const t = lower.includes("skip") ? "red" : lower.includes("risky") ? "yellow" : lower.includes("buy") ? "green" : "gray";
  return badge(r, t);
}
function th(cols: string[]): string {
  return "<tr>" + cols.map(c => "<th>" + esc(c) + "</th>").join("") + "</tr>";
}
function td(cells: string[]): string {
  return "<tr>" + cells.map((c, i) => {
    const isLast = i === cells.length - 1;
    return '<td' + (isLast ? ' style="white-space:normal;max-width:280px;word-break:break-word"' : "") + ">" + c + "</td>";
  }).join("") + "</tr>";
}
function card(label: string, value: string, sub = "", danger = false): string {
  const bg = danger ? "#4a1c1c" : "#1a2035";
  const vc = danger ? "#fc8181" : "#f0c040";
  return '<div style="background:' + bg + ';border-radius:8px;padding:12px 14px;min-width:130px">' +
    '<p style="font-size:12px;color:#a0aec0;margin:0 0 4px">' + esc(label) + "</p>" +
    '<p style="font-size:20px;font-weight:500;margin:0 0 2px;color:' + vc + '">' + esc(value) + "</p>" +
    (sub ? '<p style="font-size:11px;color:#718096;margin:0">' + esc(sub) + "</p>" : "") +
    "</div>";
}
function section(title: string, content: string): string {
  return '<h2 style="font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:1px;' +
    'color:#a0aec0;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid #2d3748">' + esc(title) + "</h2>" + content;
}
function emptyMsg(msg = "No data yet."): string {
  return '<p style="color:#718096;padding:12px;font-size:13px">' + esc(msg) + "</p>";
}
function buildTable(headers: string[], rows: string[]): string {
  if (rows.length === 0) return emptyMsg();
  return '<div class="tbl-wrap"><table><thead>' + th(headers) + "</thead><tbody>" + rows.join("") + "</tbody></table></div>";
}

function getAiResale(e: Entry): number | null {
  const v = e.prediction.aiEstimatedResale ?? e.prediction.resaleHigh;
  return (v != null && !isNaN(v)) ? v : null;
}
function getDiff(e: Entry) {
  const aiVal   = getAiResale(e);
  const userVal = e.feedback.userEstimatedValue;
  if (aiVal == null || userVal == null) return { aiVal, userVal, diff: null, absDiff: null, pctDiff: null };
  const diff    = aiVal - userVal;
  const absDiff = Math.abs(diff);
  const pctDiff = userVal > 0 ? Math.round(absDiff / userVal * 100) : null;
  return { aiVal, userVal, diff, absDiff, pctDiff };
}
function isSignificantMiss(e: Entry): boolean {
  const d = getDiff(e);
  if (d.absDiff == null) return false;
  return d.absDiff >= SIGNIFICANT_DIFF_ABS || (d.pctDiff != null && d.pctDiff >= SIGNIFICANT_DIFF_PCT);
}
function isBuyRec(rec: string): boolean { return rec.toLowerCase().includes("buy") && !rec.toLowerCase().includes("risky"); }
function isRiskyRec(rec: string): boolean { return rec.toLowerCase().includes("risky"); }
function isSkipRec(rec: string): boolean {
  const r = rec.toLowerCase();
  return r.includes("skip") || r.includes("don") || r.includes("pass");
}

const CSS = [
  "* { box-sizing: border-box; margin: 0; padding: 0; }",
  "body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; font-size: 14px; }",
  ".topbar { background: #1a2035; padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2d3748; }",
  ".topbar h1 { font-size: 18px; font-weight: 500; color: #f0c040; }",
  ".meta { font-size: 12px; color: #718096; }",
  ".container { max-width: 1280px; margin: 0 auto; padding: 24px 20px; }",
  "table { width: 100%; border-collapse: collapse; background: #1a2035; border-radius: 8px; margin-bottom: 8px; } .tbl-wrap { overflow-x: auto; margin-bottom: 8px; border-radius: 8px; }",
  "th { background: #243050; padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #a0aec0; }",
  "td { padding: 8px 12px; border-top: 1px solid #2d3748; color: #cbd5e0; font-size: 13px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; } td.wrap { white-space: normal; max-width: 260px; word-break: break-word; }",
  "tr:hover td { background: #1e2a45; }",
  ".badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 500; }",
  ".badge-green { background: #1c4532; color: #68d391; } .badge-yellow { background: #2d3319; color: #f6e05e; }",
  ".badge-red { background: #4a1c1c; color: #fc8181; } .badge-gray { background: #2d3748; color: #a0aec0; }",
  ".cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }",
  ".pos { color: #68d391; } .neg { color: #fc8181; }",
  ".exports a { background: #243050; color: #90cdf4; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 12px; border: 1px solid #2d3748; display: inline-block; margin-right: 8px; }",
  ".scan-bar { background: #1a2035; border: 1px solid #2d3748; border-radius: 8px; padding: 14px 18px; margin-bottom: 8px; display: flex; gap: 32px; align-items: center; }",
  ".sv { font-size: 28px; font-weight: 500; color: #f0c040; } .sl { font-size: 11px; color: #718096; text-transform: uppercase; }",
  ".bar { height: 8px; border-radius: 4px; background: #2d3748; margin-top: 8px; width: 200px; }",
  ".bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg,#f0c040,#e53e3e); }",
  "footer { text-align: center; color: #4a5568; font-size: 11px; padding: 32px; }",
  ".analytics-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(200px,1fr)); gap: 10px; margin-bottom: 12px; }",
  ".analytics-group { background: #131929; border: 1px solid #2d3748; border-radius: 8px; padding: 14px 16px; }",
  ".analytics-group-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #718096; margin-bottom: 10px; }",
  ".analytics-row { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; border-bottom: 1px solid #1e2a40; }",
  ".analytics-row:last-child { border-bottom: none; }",
  ".analytics-label { font-size: 12px; color: #a0aec0; }",
  ".analytics-value { font-size: 13px; font-weight: 500; color: #f0c040; }",
  ".analytics-value.dim { color: #718096; }",
  ".retention-bar { display: flex; gap: 12px; margin-top: 8px; }",
  ".ret-item { flex: 1; background: #1a2035; border-radius: 6px; padding: 10px; text-align: center; }",
  ".ret-pct { font-size: 22px; font-weight: 500; color: #f0c040; }",
  ".ret-label { font-size: 10px; color: #718096; text-transform: uppercase; margin-top: 2px; }",
].join(" ");

function aval(v: any, suffix = "", fallback = "—"): string {
  if (v === null || v === undefined || v === "—") return '<span class="analytics-value dim">' + fallback + "</span>";
  return '<span class="analytics-value">' + esc(String(v)) + esc(suffix) + "</span>";
}
function arow(label: string, value: any, suffix = "", fallback = "—"): string {
  return '<div class="analytics-row"><span class="analytics-label">' + esc(label) + "</span>" + aval(value, suffix, fallback) + "</div>";
}
function agroup(title: string, rows: string): string {
  return '<div class="analytics-group"><div class="analytics-group-title">' + esc(title) + "</div>" + rows + "</div>";
}

function generateAnalyticsSection(a: any): string {
  // a = getAnalyticsSummary() result — may be sparse if no events yet
  if (!a || a.totalEvents === 0) {
    return '<p style="color:#718096;font-size:13px;padding:12px 0">' +
      "No analytics events collected yet. Events will appear here once users open the app after this update is deployed." +
      "</p>";
  }

  const fmtMs = (ms: number) => {
    if (!ms) return "—";
    if (ms < 60000) return Math.round(ms / 1000) + "s";
    return Math.floor(ms / 60000) + "m " + Math.round((ms % 60000) / 1000) + "s";
  };
  const retPct = (ret: number, total: number) => total > 0 ? Math.round(ret / total * 100) + "%" : "—";

  const userGroup = agroup("Users",
    arow("Total unique users",   a.totalUniqueUsers) +
    arow("DAU (today)",          a.dau) +
    arow("WAU (last 7 days)",    a.wau) +
    arow("New users today",      a.newUsersToday) +
    arow("Returning users today",a.returningUsersToday)
  );

  const sessGroup = agroup("Sessions",
    arow("Total sessions",       a.totalSessions) +
    arow("Sessions today",       a.sessionsToday) +
    arow("Avg session length",   a.avgSessionMs ? fmtMs(a.avgSessionMs) : null) +
    arow("Sessions / user / day",a.sessPerUserDay)
  );

  const scanGroup = agroup("Scans",
    arow("Started",              a.scanStarted) +
    arow("Completed",            a.scanCompleted) +
    arow("Failed",               a.scanFailed) +
    arow("Completion rate",      a.scanStarted > 0 ? a.scanRate : null, "%") +
    arow("Avg scans / user / day",a.avgScansPerDay) +
    arow("Median scans / user / day",a.medianScansPerDay) +
    arow("Users with 5+ scans/day",a.pct5PlusScans != null ? a.pct5PlusScans : null, "%")
  );

  const listGroup = agroup("Listings Generated",
    arow("Total listings",       a.listingsTotal) +
    arow("% of completed scans", a.listingRate, "%") +
    arow("eBay listings",        a.ebayListings) +
    arow("Depop listings",       a.depopListings) +
    arow("eBay vs Depop",        (a.ebayListings || a.depopListings)
      ? (a.ebayListings + " : " + a.depopListings) : null)
  );

  const fbGroup = agroup("Feedback",
    arow("Feedback events",      a.feedbackEvents) +
    arow("Feedback rate",        a.scanCompleted > 0 ? a.feedbackRate : null, "%") +
    arow("Scan records saved",   a.totalScanRecords)
  );

  const ttvGroup = agroup("Time to Value",
    arow("Avg open → first scan", a.avgTTVSeconds != null ? a.avgTTVSeconds + "s" : null) +
    arow("Total events logged",  a.totalEvents)
  );

  const retSection = '<div style="margin-top:14px">' +
    '<div style="font-size:11px;color:#718096;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Retention</div>' +
    '<div class="retention-bar">' +
    '<div class="ret-item"><div class="ret-pct">' + retPct(a.day1Ret, a.day1Total)  + '</div><div class="ret-label">Day 1</div>' +
      (a.day1Total  ? '<div style="font-size:10px;color:#4a5568;margin-top:2px">' + a.day1Ret  + "/" + a.day1Total  + "</div>" : "") + "</div>" +
    '<div class="ret-item"><div class="ret-pct">' + retPct(a.day7Ret, a.day7Total)  + '</div><div class="ret-label">Day 7</div>' +
      (a.day7Total  ? '<div style="font-size:10px;color:#4a5568;margin-top:2px">' + a.day7Ret  + "/" + a.day7Total  + "</div>" : "") + "</div>" +
    '<div class="ret-item"><div class="ret-pct">' + retPct(a.day30Ret, a.day30Total) + '</div><div class="ret-label">Day 30</div>' +
      (a.day30Total ? '<div style="font-size:10px;color:#4a5568;margin-top:2px">' + a.day30Ret + "/" + a.day30Total + "</div>" : "") + "</div>" +
    "</div>" +
    '<p style="font-size:11px;color:#4a5568;margin-top:6px">Retention = returned on that day after first use. Only counts cohorts old enough to measure.</p>' +
    "</div>";

  return '<div class="analytics-grid">' +
    userGroup + sessGroup + scanGroup + listGroup + fbGroup + ttvGroup +
    "</div>" + retSection;
}

export function generateDashboard({ entries, summary, scanStats, analytics, secret }: DashboardInput): string {
  const total   = entries.length;
  const now     = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const usedPct = Math.round(scanStats.globalScansUsedToday / scanStats.globalDailyLimit * 100);

  const withDiff = entries.filter(e => getDiff(e).diff != null);

  const accurateCount = summary.accuracyRatings?.accurate  ?? 0;
  const somewhatCount = summary.accuracyRatings?.somewhat  ?? 0;
  const badCount      = summary.accuracyRatings?.bad       ?? 0;
  const boughtCount   = summary.buyDecisions?.bought       ?? 0;
  const passedCount   = summary.buyDecisions?.passed       ?? 0;
  const unsureCount   = summary.buyDecisions?.unsure       ?? 0;

  const avgAI = total ? Math.round(entries.reduce((s, e) => s + (getAiResale(e) ?? 0), 0) / total) : 0;
  const avgUser = withDiff.length ? Math.round(withDiff.reduce((s, e) => s + (e.feedback.userEstimatedValue ?? 0), 0) / withDiff.length) : null;
  const allDiffs = withDiff.map(e => getDiff(e).diff ?? 0);
  const avgDiff = allDiffs.length ? Math.round(allDiffs.reduce((a,b)=>a+b,0)/allDiffs.length) : null;
  const allAbsDiffs = withDiff.map(e => getDiff(e).absDiff ?? 0);
  const avgAbsDiff = allAbsDiffs.length ? Math.round(allAbsDiffs.reduce((a,b)=>a+b,0)/allAbsDiffs.length) : null;

  const misses = [...withDiff]
    .sort((a,b) => (getDiff(b).absDiff??0)-(getDiff(a).absDiff??0))
    .slice(0,20)
    .map(e => {
      const d = getDiff(e);
      const diffStr = (d.diff??0) >= 0
        ? '<span class="pos">AI +$' + Math.abs(d.diff??0) + " high</span>"
        : '<span class="neg">AI −$' + Math.abs(d.diff??0) + " low</span>";
      return td([esc(tsStr(e.timestamp)),esc(e.prediction.itemName),esc(e.prediction.brand),esc(e.prediction.category),
        esc(fmt(d.aiVal)),esc(fmt(d.userVal)),diffStr,d.pctDiff!=null?d.pctDiff+"%":"—",
        accuracyBadge(e.feedback.accuracyRating),esc(e.feedback.notes??"—")]);
    });

  const recent = [...entries].sort((a,b)=>b.timestamp-a.timestamp).slice(0,50)
    .map(e => {
      const d = getDiff(e);
      const diffStr = d.diff==null?"—": d.diff>=0?'<span class="pos">+$'+Math.abs(d.diff)+"</span>":'<span class="neg">−$'+Math.abs(d.diff)+"</span>";
      return td([esc(tsStr(e.timestamp)),esc(e.prediction.itemName),esc(e.prediction.brand),esc(e.prediction.category),
        esc(fmt(d.aiVal)),esc(fmt(d.userVal)),diffStr,accuracyBadge(e.feedback.accuracyRating),
        decisionBadge(e.feedback.buyDecision),recBadge(e.prediction.recommendation),
        esc(e.prediction.confidenceScore+"%"),esc(e.prediction.bestPlatform),esc(e.feedback.notes??"—")]);
    });

  const recGroups: Record<string,{bought:number;passed:number;unsure:number;total:number}> = {
    "BUY":{bought:0,passed:0,unsure:0,total:0},"RISKY_BUY":{bought:0,passed:0,unsure:0,total:0},
    "SKIP":{bought:0,passed:0,unsure:0,total:0},"OTHER":{bought:0,passed:0,unsure:0,total:0},
  };
  entries.forEach(e => {
    const d = e.feedback.buyDecision; if(!d) return;
    const rec = e.prediction.recommendation??"";
    const key = isBuyRec(rec)?"BUY":isRiskyRec(rec)?"RISKY_BUY":isSkipRec(rec)?"SKIP":"OTHER";
    recGroups[key].total++;
    if(d==="bought") recGroups[key].bought++; else if(d==="passed") recGroups[key].passed++; else recGroups[key].unsure++;
  });
  const recRows = Object.entries(recGroups).filter(([,g])=>g.total>0)
    .map(([rec,g])=>td([esc(rec),String(g.total),pct(g.bought,g.total),pct(g.passed,g.total),pct(g.unsure,g.total)]));

  const overrides = entries.filter(e => {
    const rec=e.prediction.recommendation??""; const dec=e.feedback.buyDecision; if(!dec) return false;
    return (isBuyRec(rec)||isRiskyRec(rec))&&dec==="passed" || isSkipRec(rec)&&dec==="bought";
  }).slice(0,30).map(e => {
    const d=getDiff(e);
    const diffStr=d.diff==null?"—":d.diff>=0?'<span class="pos">+$'+Math.abs(d.diff)+"</span>":'<span class="neg">−$'+Math.abs(d.diff)+"</span>";
    return td([esc(tsStr(e.timestamp)),esc(e.prediction.itemName),esc(e.prediction.brand),esc(e.prediction.category),
      recBadge(e.prediction.recommendation),decisionBadge(e.feedback.buyDecision),
      esc(fmt(d.aiVal)),esc(fmt(d.userVal)),diffStr,esc(e.feedback.notes??"—")]);
  });

  const catGroups: Record<string,Entry[]> = {};
  entries.forEach(e => { const c=e.prediction.category||"Unknown"; if(!catGroups[c]) catGroups[c]=[]; catGroups[c].push(e); });
  const catRows = Object.entries(catGroups)
    .map(([cat,es]) => {
      const acc=es.filter(e=>e.feedback.accuracyRating==="accurate").length;
      const som=es.filter(e=>e.feedback.accuracyRating==="somewhat").length;
      const bad=es.filter(e=>e.feedback.accuracyRating==="bad").length;
      const withFb=es.filter(e=>e.feedback.accuracyRating).length;
      const trust=withFb>0?Math.round((acc+som*0.5)/withFb*100):null;
      const we=es.filter(e=>getDiff(e).absDiff!=null);
      const avgAbs=we.length?Math.round(we.reduce((s,e)=>s+(getDiff(e).absDiff??0),0)/we.length):null;
      const buyRate=pct(es.filter(e=>e.feedback.buyDecision==="bought").length,es.filter(e=>e.feedback.buyDecision).length);
      return {cat,total:es.length,trust,acc,bad,avgAbs,buyRate};
    })
    .sort((a,b)=>(a.trust??100)-(b.trust??100))
    .map(r=>td([esc(r.cat),String(r.total),
      r.trust!=null?'<span class="'+( r.trust<50?"neg":r.trust>75?"pos":"")+"\">"+r.trust+"%</span>":"—",
      String(r.acc),String(r.bad),r.avgAbs!=null?fmt(r.avgAbs):"—",r.buyRate]));

  const falsePosCount = entries.filter(e => {
    const rec=e.prediction.recommendation??"";
    if(!isBuyRec(rec)&&!isRiskyRec(rec)) return false;
    return e.feedback.accuracyRating==="bad"||e.feedback.buyDecision==="passed"||isSignificantMiss(e)&&(getDiff(e).diff??0)>0;
  }).length;
  const falseNegCount = entries.filter(e => {
    const rec=e.prediction.recommendation??"";
    if(!isSkipRec(rec)) return false;
    return e.feedback.buyDecision==="bought"||isSignificantMiss(e)&&(getDiff(e).diff??0)<0;
  }).length;
  const worstCat = Object.entries(catGroups)
    .map(([cat,es])=>({cat,bad:es.filter(e=>e.feedback.accuracyRating==="bad").length,total:es.length}))
    .filter(x=>x.total>=3).sort((a,b)=>b.bad/b.total-a.bad/a.total)[0]?.cat??"—";

  const confBuckets = [{label:"0–39%",min:0,max:39},{label:"40–59%",min:40,max:59},{label:"60–79%",min:60,max:79},{label:"80–100%",min:80,max:100}];
  const confRows = confBuckets.map(b => {
    const es=entries.filter(e=>e.prediction.confidenceScore>=b.min&&e.prediction.confidenceScore<=b.max);
    if(es.length===0) return td([b.label,"0","—","—","—"]);
    const withRating=es.filter(e=>e.feedback.accuracyRating);
    const accRate=pct(es.filter(e=>e.feedback.accuracyRating==="accurate").length,withRating.length);
    const badRate=pct(es.filter(e=>e.feedback.accuracyRating==="bad").length,withRating.length);
    const we=es.filter(e=>getDiff(e).absDiff!=null);
    const avgAbs=we.length?fmt(Math.round(we.reduce((s,e)=>s+(getDiff(e).absDiff??0),0)/we.length)):"—";
    return td([b.label,String(es.length),accRate,badRate,avgAbs]);
  });

  const platGroups: Record<string,Entry[]> = {};
  entries.forEach(e=>{const p=e.prediction.bestPlatform||"Unknown";if(!platGroups[p])platGroups[p]=[];platGroups[p].push(e);});
  const platRows = Object.entries(platGroups).sort((a,b)=>b[1].length-a[1].length).map(([plat,es])=>{
    const avgConf=Math.round(es.reduce((s,e)=>s+e.prediction.confidenceScore,0)/es.length);
    const we=es.filter(e=>getDiff(e).diff!=null);
    const avgD=we.length?Math.round(we.reduce((s,e)=>s+(getDiff(e).diff??0),0)/we.length):null;
    const avgAbs=we.length?fmt(Math.round(we.reduce((s,e)=>s+(getDiff(e).absDiff??0),0)/we.length)):"—";
    return td([esc(plat),String(es.length),avgConf+"%",avgD==null?"—":((avgD>=0?"+":"−")+"$"+Math.abs(avgD)),avgAbs]);
  });

  // ── Brand analytics ────────────────────────────────────────────────────────
  // Groups every feedback entry by brand. Shows trust score, pricing accuracy,
  // and override rate so you can see at a glance which brands need prompt work.
  // Sorted: unknowns and single-entry brands last, problem brands first.
  const brandGroups: Record<string,Entry[]> = {};
  entries.forEach(e => {
    const b = (e.prediction.brand||"Unknown").trim();
    if (!brandGroups[b]) brandGroups[b] = [];
    brandGroups[b].push(e);
  });

  const brandRows = Object.entries(brandGroups)
    .map(([brand, es]) => {
      const withRating   = es.filter(e => e.feedback.accuracyRating);
      const acc          = es.filter(e => e.feedback.accuracyRating === "accurate").length;
      const som          = es.filter(e => e.feedback.accuracyRating === "somewhat").length;
      const bad          = es.filter(e => e.feedback.accuracyRating === "bad").length;
      const trust        = withRating.length > 0 ? Math.round((acc + som * 0.5) / withRating.length * 100) : null;
      const we           = es.filter(e => getDiff(e).absDiff != null);
      const avgAbsVal    = we.length ? Math.round(we.reduce((s,e) => s+(getDiff(e).absDiff??0), 0) / we.length) : null;
      // Avg direction: positive = AI overestimates, negative = AI underestimates
      const allD         = we.map(e => getDiff(e).diff ?? 0);
      const avgDir       = allD.length ? Math.round(allD.reduce((a,b)=>a+b,0)/allD.length) : null;
      const overrideCount= es.filter(e => {
        const rec=e.prediction.recommendation??""; const dec=e.feedback.buyDecision; if(!dec) return false;
        return (isBuyRec(rec)||isRiskyRec(rec))&&dec==="passed" || isSkipRec(rec)&&dec==="bought";
      }).length;
      const overridePct  = es.filter(e=>e.feedback.buyDecision).length > 0
        ? Math.round(overrideCount / es.filter(e=>e.feedback.buyDecision).length * 100) : null;
      const buyRate      = pct(es.filter(e=>e.feedback.buyDecision==="bought").length, es.filter(e=>e.feedback.buyDecision).length);
      return { brand, total: es.length, trust, acc, bad, avgAbsVal, avgDir, overrideCount, overridePct, buyRate };
    })
    // Sort: most problematic first (lowest trust, most overrides). Unknowns always last.
    .sort((a, b) => {
      if (a.brand === "Unknown") return 1;
      if (b.brand === "Unknown") return -1;
      // Primary: trust score ascending (worst first). Null trust (no ratings) goes to bottom.
      const tA = a.trust ?? 101;
      const tB = b.trust ?? 101;
      if (tA !== tB) return tA - tB;
      // Secondary: count descending (more data = more signal)
      return b.total - a.total;
    })
    .map(r => {
      const trustCell = r.trust != null
        ? '<span class="' + (r.trust < 50 ? "neg" : r.trust > 75 ? "pos" : "") + '">' + r.trust + "%</span>"
        : "—";
      const dirCell = r.avgDir == null ? "—"
        : r.avgDir > 0 ? '<span class="pos">AI +$' + r.avgDir + " high</span>"
        : r.avgDir < 0 ? '<span class="neg">AI −$' + Math.abs(r.avgDir) + " low</span>"
        : '<span style="color:#718096">On target</span>';
      const overrideCell = r.overridePct != null
        ? (r.overridePct >= 50 ? '<span class="neg">' + r.overrideCount + " (" + r.overridePct + "%)</span>"
          : r.overrideCount + " (" + r.overridePct + "%)")
        : "—";
      return td([
        esc(r.brand),
        String(r.total),
        trustCell,
        String(r.acc),
        String(r.bad),
        r.avgAbsVal != null ? fmt(r.avgAbsVal) : "—",
        dirCell,
        overrideCell,
        r.buyRate,
      ]);
    });

  const missing = {
    itemTitle:      entries.filter(e=>!e.prediction.itemName).length,
    brand:          entries.filter(e=>!e.prediction.brand||e.prediction.brand==="Unknown").length,
    category:       entries.filter(e=>!e.prediction.category).length,
    recommendation: entries.filter(e=>!e.prediction.recommendation).length,
    aiEstResale:    entries.filter(e=>e.prediction.aiEstimatedResale==null).length,
    userEstimate:   entries.filter(e=>e.feedback.userEstimatedValue==null).length,
    confidence:     entries.filter(e=>e.prediction.confidenceScore==null).length,
    buyDecision:    entries.filter(e=>!e.feedback.buyDecision).length,
    notes:          entries.filter(e=>!e.feedback.notes).length,
  };
  const missingRows = Object.entries(missing).map(([field,n])=>{
    const p=total>0?Math.round(n/total*100)+"%":"—";
    const val=n===0?"0":n>total*0.5?'<span class="neg">'+n+" ("+p+")</span>":n+" ("+p+")";
    return td([esc(field),val]);
  });

  return [
    "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>",
    "<meta name='viewport' content='width=device-width,initial-scale=1'>",
    "<title>FlipStart Founder Dashboard v2</title>",
    "<style>" + CSS + "</style></head><body>",
    "<div class='topbar'><h1>FlipStart Founder Dashboard v2</h1><div class='meta'>Private · " + now + " CT</div></div>",
    "<div class='container'>",
    "<div class='exports' style='margin:16px 0'>",
    "<a href='/api/dev/feedback?secret="             + esc(secret) + "'>Raw JSON</a>",
    "<a href='/api/dev/feedback.csv?secret="         + esc(secret) + "'>Download CSV</a>",
    "<a href='/api/dev/analytics-dashboard?secret="  + esc(secret) + "'>User Analytics</a>",
    "<a href='/api/dev/analytics?secret="            + esc(secret) + "'>Raw Analytics JSON</a>",
    "<a href='/api/dev/analytics.csv?secret="        + esc(secret) + "'>Analytics CSV</a>",
    "</div>",
    section("Usage Analytics", generateAnalyticsSection(analytics ?? {})),
    section("Scan Budget",
      "<div class='scan-bar'>" +
      "<div><div class='sv'>" + scanStats.globalScansRemainingToday + "</div><div class='sl'>Left today</div></div>" +
      "<div><div class='sv' style='color:#a0aec0'>" + scanStats.globalScansUsedToday + "</div><div class='sl'>Used</div></div>" +
      "<div><div class='sv' style='color:#a0aec0'>" + scanStats.globalDailyLimit + "</div><div class='sl'>Limit</div></div>" +
      "<div><div class='sl' style='margin-bottom:4px'>Daily usage</div><div class='bar'><div class='bar-fill' style='width:" + usedPct + "%'></div></div>" +
      "<div style='font-size:11px;color:#4a5568;margin-top:4px'>Resets: " + esc(new Date(scanStats.resetTime).toLocaleString("en-US",{timeZone:"America/Chicago"})) + "</div></div>" +
      "</div>"
    ),
    section("Overview","<div class='cards'>" +
      card("Feedback Entries",String(total)) +
      card("Accurate",String(accurateCount),pct(accurateCount,total)) +
      card("Somewhat",String(somewhatCount),pct(somewhatCount,total)) +
      card("Bad Analysis",String(badCount),pct(badCount,total),badCount>total*0.3) +
      card("Bought",String(boughtCount),pct(boughtCount,total)) +
      card("Passed",String(passedCount),pct(passedCount,total)) +
      card("Avg AI Est. Resale",fmt(avgAI)) +
      card("Avg User Est.",fmt(avgUser)) +
      card("Avg Diff (AI−User)",avgDiff!=null?(avgDiff>=0?"+":"−")+"$"+Math.abs(avgDiff):"—") +
      card("Avg Abs Diff",avgAbsDiff!=null?fmt(avgAbsDiff):"—") +
      "</div>"),
    section("Prediction Risk","<div class='cards'>" +
      card("False Positives",String(falsePosCount),"AI said buy, user disagreed",falsePosCount>3) +
      card("False Negatives",String(falseNegCount),"AI said skip, user bought") +
      card("Overrides",String(overrides.length>0?overrides.length:0),"User defied recommendation") +
      card("Worst Category",worstCat,"by bad analysis rate") +
      "</div>"),
    section("Biggest AI Pricing Misses — AI Est. Resale vs User Estimate",
      buildTable(["Time","Item","Brand","Category","AI Est. Resale","User Est.","Diff","Diff%","Accuracy","Notes"],misses)),
    section("Recommendation Trust",
      buildTable(["AI Recommendation","Feedback Count","Bought Rate","Passed Rate","Unsure Rate"],recRows)),
    section("Overridden Recommendations",
      buildTable(["Time","Item","Brand","Category","AI Rec","User Decision","AI Est.","User Est.","Diff","Notes"],overrides.length>0?overrides:[])),
    section("Category Trust Score — Worst First",
      buildTable(["Category","Count","Trust Score","Accurate","Bad","Avg Abs Diff","Buy Rate"],catRows)),
    section("Brand Performance — Worst First",
      "<p style='font-size:12px;color:#718096;margin-bottom:8px'>" +
      "Trust = (accurate + 0.5×somewhat) / rated. " +
      "AI Bias = avg direction of pricing error (positive = AI overestimates). " +
      "Override = user defied AI recommendation. " +
      "Sorted worst trust first — Unknown brand always last." +
      "</p>" +
      buildTable(["Brand","Scans","Trust","Accurate","Bad","Avg $$ Off","AI Bias","Overrides","Buy Rate"],brandRows)),
    section("Confidence Calibration",
      buildTable(["Confidence Bucket","Count","Accurate Rate","Bad Rate","Avg Abs Diff"],confRows)),
    section("Platform Insights",
      buildTable(["Platform","Count","Avg Confidence","Avg Diff (AI−User)","Avg Abs Diff"],platRows)),
    section("Recent Feedback (last 50)",
      buildTable(["Time","Item","Brand","Category","AI Est.","User Est.","Diff","Accuracy","Decision","Rec","Conf","Platform","Notes"],recent)),
    section("Data Quality — Missing Fields",
      "<p style='font-size:12px;color:#718096;margin-bottom:8px'>Red = over 50% missing. Collect these in the app.</p>" +
      buildTable(["Field","Missing"],missingRows)),
    "<footer>FlipStart Dashboard v2 · " + total + " entries · Diff = AI Est. Resale − User Est. · Threshold: ±" + SIGNIFICANT_DIFF_PCT + "% or $" + SIGNIFICANT_DIFF_ABS + "</footer>",
    "</div></body></html>",
  ].join("\n");
}
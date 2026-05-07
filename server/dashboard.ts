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
].join(" ");

export function generateDashboard({ entries, summary, scanStats, secret }: DashboardInput): string {
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
    "<a href='/api/dev/feedback?secret=" + esc(secret) + "'>Raw JSON</a>",
    "<a href='/api/dev/feedback.csv?secret=" + esc(secret) + "'>Download CSV</a>",
    "</div>",
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
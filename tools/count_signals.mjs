/**
 * Before/After confluence signal counter.
 * Runs both OLD (post-onset fix) and NEW (high-conviction) logic on the same data.
 * Outputs per-year counts and a breakdown of which filters eliminate signals.
 */

import { readFileSync } from 'fs';

const TICKERS = ['BOIL', 'HNU', '3NGL', 'KOLD', 'HND', '3NGS'];
const LEV  = { BOIL:3, HNU:2, '3NGL':3, KOLD:3, HND:2, '3NGS':3 };
const SIDE = { BOIL:'L', HNU:'L', '3NGL':'L', KOLD:'S', HND:'S', '3NGS':'S' };
const LEV_W = { BOIL:1.5, HNU:1.0, '3NGL':1.5, KOLD:1.5, HND:1.0, '3NGS':1.5 };
const WINS = [10, 5, 3];
const LONG_TKS  = new Set(['BOIL', 'HNU', '3NGL']);
const SHORT_TKS = new Set(['KOLD', 'HND', '3NGS']);

// ── Load data ─────────────────────────────────────────────────────────────────
const cache = {};
for (const tk of TICKERS) {
    const raw = JSON.parse(readFileSync(`data/flows/${tk}_flows.json`, 'utf8'));
    // Filter to 2021+ (when all 6 ETFs existed) and sort by date
    raw.data = raw.data.filter(d => d.date >= '2021-01-01').sort((a,b) => a.date.localeCompare(b.date));
    cache[tk] = raw;
}

// ── Shared: build sorted trading-date index ──────────────────────────────────
const allDates = [...new Set(TICKERS.flatMap(tk => cache[tk].data.map(d => d.date)))].sort();
const dIdx = new Map(allDates.map((d, i) => [d, i]));

// ── Shared: build NG proxy daily return map ───────────────────────────────────
function buildNGMap() {
    const SIGN = { BOIL:1, HNU:1, '3NGL':1, KOLD:-1, HND:-1, '3NGS':-1 };
    const raw = new Map();
    for (const tk of TICKERS) {
        for (const r of cache[tk].data) {
            const v = SIGN[tk] * (r.perf_pct || 0) / LEV[tk];
            const e = raw.get(r.date) || { sum: 0, count: 0 };
            e.sum += v; e.count++;
            raw.set(r.date, e);
        }
    }
    const out = new Map();
    for (const [dt, v] of raw) out.set(dt, v.sum / v.count);
    return out;
}
const ngMap = buildNGMap();
const ngDates = [...ngMap.keys()].sort();

function ngFwdMove(endDate, days) {
    const ei = ngDates.indexOf(endDate);
    if (ei < 0 || ei + days >= ngDates.length) return null;
    let prod = 1;
    for (let k = 1; k <= days; k++) prod *= 1 + (ngMap.get(ngDates[ei + k]) || 0);
    return prod - 1;
}

// ── Shared: score a cluster ───────────────────────────────────────────────────
function scoreCluster(cluster) {
    const best = {};
    for (const s of cluster) {
        const p = best[s.tk];
        if (!p || s.STR > p.STR || (s.confirmed && !p.confirmed)) best[s.tk] = s;
    }
    let raw = 0, total = 0;
    for (const [tk, s] of Object.entries(best)) {
        const sign = s.ngImpl === 'BULL' ? 1 : -1;
        const w = LEV_W[tk] * (s.STR / 100) * (s.confirmed ? 1.0 : 0.5);
        raw += sign * w; total += w;
    }
    const norm = total > 0 ? raw / total : 0;
    return { norm, etfCount: Object.keys(best).length };
}

// ─────────────────────────────────────────────────────────────────────────────
// OLD LOGIC  (post-onset fix only — current state)
// ─────────────────────────────────────────────────────────────────────────────
function collectOld() {
    const out = [];
    for (const tk of TICKERS) {
        const data = cache[tk].data;
        const lev = LEV[tk], side = SIDE[tk], thresh = lev * 0.01;
        let maf = 0;
        for (let i = 10; i < data.length; i++)
            for (const w of WINS) {
                if (i < w) continue;
                const f = Math.abs((data[i].cumulative_flow||0) - (data[i-w].cumulative_flow||0));
                if (f > maf) maf = f;
            }
        const lastType = {};
        for (let i = 10; i < data.length; i++) {
            for (const w of WINS) {
                if (i < w) continue;
                const cur = data[i], prev = data[i - w];
                let cumRet = 1;
                for (let j = i - w + 1; j <= i; j++) cumRet *= 1 + (data[j].perf_pct || 0);
                const priceMove = cumRet - 1;
                const flowSum   = (cur.cumulative_flow||0) - (prev.cumulative_flow||0);
                const isBear    = priceMove >  thresh && flowSum < 0;
                const isBull    = priceMove < -thresh && flowSum > 0;
                const curType   = isBear ? 'BEAR' : isBull ? 'BULL' : null;
                const prevType  = lastType[w] || null;
                lastType[w]     = curType;
                if (curType === null || curType === prevType) continue;

                const avgDaily  = flowSum / w;
                const zAtEnd    = cur.flow_zscore ?? 0;
                const presAtEnd = Math.round(cur.pressure ?? 0);
                const s         = i - w + 1;
                const canPre3   = s - 3 >= 0;
                let avgPre3 = null;
                if (canPre3) avgPre3 = ((data[s-3]?.usd_flow||0)+(data[s-2]?.usd_flow||0)+(data[s-1]?.usd_flow||0))/3;
                let cd = 0;
                for (let j = s; j <= i; j++) { const df = data[j].usd_flow||0; if (isBear ? df<0 : df>0) cd++; }
                const fc    = cd / w;
                const ef    = data[i].usd_flow || 0;
                const efOk  = isBear ? ef < 0 : ef > 0;
                const confirmed =
                    (isBear ? zAtEnd <= -0.5 : zAtEnd >= 0.5) &&
                    (isBear ? presAtEnd < 0  : presAtEnd > 0)  &&
                    (avgPre3 === null || (isBear ? avgDaily < avgPre3 : avgDaily > avgPre3)) &&
                    fc >= 0.5;
                const pN  = Math.min(Math.abs(priceMove) / (thresh * 5), 1);
                const fN  = maf > 0 ? Math.min(Math.abs(flowSum) / maf, 1) : 0;
                const cN  = fc;
                const eN  = efOk ? Math.min(Math.abs(ef) / (Math.abs(avgDaily)||1), 1.5) / 1.5 : 0;
                const STR = Math.round(pN*30 + fN*30 + (w/10)*12 + cN*15 + eN*13);
                if (!confirmed && STR < 50) continue;
                const ngImpl = side === 'L' ? (isBear ? 'BEAR' : 'BULL') : (isBear ? 'BULL' : 'BEAR');
                out.push({ date: cur.date, tk, side, isBear, ngImpl, w, STR, confirmed });
            }
        }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
}

function clusterOld(signals) {
    if (!signals.length) return [];
    const clusters = [];
    let cur = [signals[0]];
    for (let i = 1; i < signals.length; i++) {
        const gap = (dIdx.get(signals[i].date)||0) - (dIdx.get(cur[cur.length-1].date)||0);
        if (gap <= 3) cur.push(signals[i]);
        else { clusters.push(cur); cur = [signals[i]]; }
    }
    clusters.push(cur);
    // min 2 ETFs
    return clusters.filter(c => new Set(c.map(s => s.tk)).size >= 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW LOGIC  (high-conviction)
// ─────────────────────────────────────────────────────────────────────────────
function buildP70Map() {
    // For each (tk, w): collect all |flowSum| values, return P70
    const p70 = {};
    for (const tk of TICKERS) {
        const data = cache[tk].data;
        for (const w of WINS) {
            const vals = [];
            for (let i = w; i < data.length; i++) {
                vals.push(Math.abs((data[i].cumulative_flow||0) - (data[i-w].cumulative_flow||0)));
            }
            vals.sort((a,b) => a - b);
            p70[`${tk}_${w}`] = vals[Math.floor(vals.length * 0.70)] || 0;
        }
    }
    return p70;
}

function collectNew(p70) {
    const out = [];
    for (const tk of TICKERS) {
        const data = cache[tk].data;
        const lev = LEV[tk], side = SIDE[tk], thresh = lev * 0.01;
        let maf = 0;
        for (let i = 10; i < data.length; i++)
            for (const w of WINS) {
                if (i < w) continue;
                const f = Math.abs((data[i].cumulative_flow||0) - (data[i-w].cumulative_flow||0));
                if (f > maf) maf = f;
            }
        const lastType = {};
        for (let i = 10; i < data.length; i++) {
            for (const w of WINS) {
                if (i < w) continue;
                const cur = data[i], prev = data[i - w];
                let cumRet = 1;
                for (let j = i - w + 1; j <= i; j++) cumRet *= 1 + (data[j].perf_pct || 0);
                const priceMove = cumRet - 1;
                const flowSum   = (cur.cumulative_flow||0) - (prev.cumulative_flow||0);
                const isBear    = priceMove >  thresh && flowSum < 0;
                const isBull    = priceMove < -thresh && flowSum > 0;
                const curType   = isBear ? 'BEAR' : isBull ? 'BULL' : null;
                const prevType  = lastType[w] || null;
                lastType[w]     = curType;
                if (curType === null || curType === prevType) continue;

                // ── NEW: P70 flow magnitude rarity gate ──────────────────────
                if (Math.abs(flowSum) < p70[`${tk}_${w}`]) continue;

                const avgDaily  = flowSum / w;
                const zAtEnd    = cur.flow_zscore ?? 0;
                const presAtEnd = Math.round(cur.pressure ?? 0);
                const s         = i - w + 1;
                const canPre3   = s - 3 >= 0;
                let avgPre3 = null;
                if (canPre3) avgPre3 = ((data[s-3]?.usd_flow||0)+(data[s-2]?.usd_flow||0)+(data[s-1]?.usd_flow||0))/3;
                let cd = 0;
                for (let j = s; j <= i; j++) { const df = data[j].usd_flow||0; if (isBear ? df<0 : df>0) cd++; }
                const fc    = cd / w;
                const ef    = data[i].usd_flow || 0;
                const efOk  = isBear ? ef < 0 : ef > 0;

                // ── NEW: z-score floor raised 0.5 → 1.0 ─────────────────────
                const confirmed =
                    (isBear ? zAtEnd <= -1.0 : zAtEnd >= 1.0) &&
                    (isBear ? presAtEnd < 0  : presAtEnd > 0)  &&
                    (avgPre3 === null || (isBear ? avgDaily < avgPre3 : avgDaily > avgPre3)) &&
                    fc >= 0.5;

                const pN  = Math.min(Math.abs(priceMove) / (thresh * 5), 1);
                const fN  = maf > 0 ? Math.min(Math.abs(flowSum) / maf, 1) : 0;
                const cN  = fc;
                const eN  = efOk ? Math.min(Math.abs(ef) / (Math.abs(avgDaily)||1), 1.5) / 1.5 : 0;
                const STR = Math.round(pN*30 + fN*30 + (w/10)*12 + cN*15 + eN*13);

                // ── NEW: AND gate (both confirmed AND STR ≥ 65) ──────────────
                if (!confirmed || STR < 65) continue;

                const ngImpl = side === 'L' ? (isBear ? 'BEAR' : 'BULL') : (isBear ? 'BULL' : 'BEAR');
                out.push({ date: cur.date, tk, side, isBear, ngImpl, w, STR, confirmed });
            }
        }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
}

function clusterNew(signals) {
    if (!signals.length) return [];
    const clusters = [];
    let cur = [signals[0]];
    for (let i = 1; i < signals.length; i++) {
        // ── NEW: gap widened 3 → 5 ───────────────────────────────────────────
        const gap = (dIdx.get(signals[i].date)||0) - (dIdx.get(cur[cur.length-1].date)||0);
        if (gap <= 5) cur.push(signals[i]);
        else { clusters.push(cur); cur = [signals[i]]; }
    }
    clusters.push(cur);

    return clusters.filter(c => {
        const tks = new Set(c.map(s => s.tk));
        // ── NEW: min 4 ETFs ──────────────────────────────────────────────────
        if (tks.size < 4) return false;
        // ── NEW: cross-side requirement (≥1 long + ≥1 short same NG dir) ────
        // Determine cluster's majority NG direction
        let bull = 0, bear = 0;
        for (const s of c) s.ngImpl === 'BULL' ? bull++ : bear++;
        const majorDir = bull >= bear ? 'BULL' : 'BEAR';
        const majorSigs = c.filter(s => s.ngImpl === majorDir);
        const hasLong  = majorSigs.some(s => LONG_TKS.has(s.tk));
        const hasShort = majorSigs.some(s => SHORT_TKS.has(s.tk));
        return hasLong && hasShort;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN & REPORT
// ─────────────────────────────────────────────────────────────────────────────
const p70 = buildP70Map();

const oldSignals  = collectOld();
const oldClusters = clusterOld(oldSignals);
// Apply score filter |norm| ≥ 0 (old has no score floor — all pass)
const oldRows = oldClusters;

const newSignals  = collectNew(p70);
const newClusters = clusterNew(newSignals);
// ── NEW: |norm| ≥ 0.5 score floor ────────────────────────────────────────────
const newRows = newClusters.filter(c => Math.abs(scoreCluster(c).norm) >= 0.50);

// Per-year counts (2021–present)
function countByYear(clusters) {
    const byYear = {};
    for (const c of clusters) {
        const yr = c[0].date.slice(0, 4);
        byYear[yr] = (byYear[yr] || 0) + 1;
    }
    return byYear;
}

const oldByYear = countByYear(oldRows);
const newByYear = countByYear(newRows);
const years = [...new Set([...Object.keys(oldByYear), ...Object.keys(newByYear)])].sort();

console.log('\n══════════════════════════════════════════════════════════');
console.log('  CONFLUENCE SIGNAL COUNT — BEFORE vs AFTER');
console.log('══════════════════════════════════════════════════════════');
console.log(`${'Year'.padEnd(8)} ${'OLD (rows)'.padEnd(14)} ${'NEW (rows)'.padEnd(14)} Change`);
console.log('─'.repeat(52));
let totalOld = 0, totalNew = 0;
for (const yr of years) {
    const o = oldByYear[yr] || 0;
    const n = newByYear[yr] || 0;
    totalOld += o; totalNew += n;
    const pct = o > 0 ? Math.round((n - o) / o * 100) : '—';
    console.log(`${yr.padEnd(8)} ${String(o).padEnd(14)} ${String(n).padEnd(14)} ${pct}%`);
}
console.log('─'.repeat(52));
const span = years.length;
console.log(`${'TOTAL'.padEnd(8)} ${String(totalOld).padEnd(14)} ${String(totalNew).padEnd(14)}`);
console.log(`${'PER YR'.padEnd(8)} ${(totalOld/span).toFixed(1).padEnd(14)} ${(totalNew/span).toFixed(1).padEnd(14)}`);

console.log('\n── Filter Attrition (NEW pipeline) ──────────────────────');
console.log(`  Raw onset signals:          ${newSignals.length + '  (post-onset dedup)'}`);
const afterP70 = (() => {
    // count raw signals before AND/STR gate but after P70
    let n = 0;
    for (const tk of TICKERS) {
        const data = cache[tk].data;
        const lev = LEV[tk], side = SIDE[tk], thresh = lev * 0.01;
        const lastType = {};
        for (let i = 10; i < data.length; i++) {
            for (const w of WINS) {
                if (i < w) continue;
                const cur = data[i], prev = data[i - w];
                let cumRet = 1;
                for (let j = i - w + 1; j <= i; j++) cumRet *= 1 + (data[j].perf_pct || 0);
                const priceMove = cumRet - 1;
                const flowSum   = (cur.cumulative_flow||0) - (prev.cumulative_flow||0);
                const isBear    = priceMove >  thresh && flowSum < 0;
                const isBull    = priceMove < -thresh && flowSum > 0;
                const curType   = isBear ? 'BEAR' : isBull ? 'BULL' : null;
                const prevType  = lastType[w] || null;
                lastType[w]     = curType;
                if (curType === null || curType === prevType) continue;
                if (Math.abs(flowSum) < p70[`${tk}_${w}`]) continue;
                n++;
            }
        }
    }
    return n;
})();
console.log(`  After P70 flow rarity gate: ${afterP70}`);
console.log(`  After confirm+STR≥65 gate:  ${newSignals.length}`);
console.log(`  After clustering (gap≤5):   ${newClusters.length}  clusters`);
const after4etf = newClusters.filter(c => new Set(c.map(s => s.tk)).size >= 4);
console.log(`  After 4-ETF minimum:        ${after4etf.length}  clusters`);
const afterXside = newClusters; // already filtered
console.log(`  After cross-side gate:      ${newClusters.length}  clusters`);
console.log(`  After |norm|≥0.50 gate:     ${newRows.length}  rows (FINAL)`);

console.log('\n── NEW Signal Dates ─────────────────────────────────────');
for (const c of newRows) {
    const { norm } = scoreCluster(c);
    const endDate = c[c.length - 1].date;
    const tks = [...new Set(c.map(s => s.tk))].join(',');
    const bias = norm > 0.5 ? 'BULLISH' : norm < -0.5 ? 'BEARISH' : 'NEUTRAL';
    const ng1m = ngFwdMove(endDate, 22);
    const ng2m = ngFwdMove(endDate, 44);
    const ng3m = ngFwdMove(endDate, 66);
    const fmt  = v => v === null ? '   ?' : (v >= 0 ? '+' : '') + (v*100).toFixed(1) + '%';
    console.log(`  ${c[0].date} → ${endDate}  ${bias.padEnd(9)} norm=${(norm*100).toFixed(0).padStart(4)}%  [${tks}]  1M:${fmt(ng1m)} 2M:${fmt(ng2m)} 3M:${fmt(ng3m)}`);
}
console.log('══════════════════════════════════════════════════════════\n');

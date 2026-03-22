/**
 * Threshold calibration sweep.
 * Finds the combination of (pFloor, zFloor, strFloor, gapDays, minETF, normFloor)
 * that lands closest to 3–5 displayed rows/year.
 */

import { readFileSync } from 'fs';

const TICKERS = ['BOIL', 'HNU', '3NGL', 'KOLD', 'HND', '3NGS'];
const LEV  = { BOIL:3, HNU:2, '3NGL':3, KOLD:3, HND:2, '3NGS':3 };
const SIDE = { BOIL:'L', HNU:'L', '3NGL':'L', KOLD:'S', HND:'S', '3NGS':'S' };
const LEV_W = { BOIL:1.5, HNU:1.0, '3NGL':1.5, KOLD:1.5, HND:1.0, '3NGS':1.5 };
const WINS = [10, 5, 3];
const LONG_TKS  = new Set(['BOIL', 'HNU', '3NGL']);
const SHORT_TKS = new Set(['KOLD', 'HND', '3NGS']);

const cache = {};
for (const tk of TICKERS) {
    const raw = JSON.parse(readFileSync(`data/flows/${tk}_flows.json`, 'utf8'));
    raw.data = raw.data.filter(d => d.date >= '2021-01-01').sort((a,b) => a.date.localeCompare(b.date));
    cache[tk] = raw;
}
const allDates = [...new Set(TICKERS.flatMap(tk => cache[tk].data.map(d => d.date)))].sort();
const dIdx = new Map(allDates.map((d, i) => [d, i]));

// Pre-compute all percentile thresholds
const pctMap = {};
for (const tk of TICKERS) {
    const data = cache[tk].data;
    for (const w of WINS) {
        const vals = [];
        for (let i = w; i < data.length; i++)
            vals.push(Math.abs((data[i].cumulative_flow||0) - (data[i-w].cumulative_flow||0)));
        vals.sort((a,b) => a - b);
        for (const p of [50, 60, 65, 70, 75]) {
            pctMap[`${tk}_${w}_${p}`] = vals[Math.floor(vals.length * p / 100)] || 0;
        }
    }
}

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
    return total > 0 ? raw / total : 0;
}

function run(pFloor, zFloor, strFloor, gapDays, minETF, normFloor) {
    // Collect signals
    const signals = [];
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
                const flowSum = (cur.cumulative_flow||0) - (prev.cumulative_flow||0);
                const isBear = priceMove > thresh && flowSum < 0;
                const isBull = priceMove < -thresh && flowSum > 0;
                const curType = isBear ? 'BEAR' : isBull ? 'BULL' : null;
                const prevType = lastType[w] || null;
                lastType[w] = curType;
                if (curType === null || curType === prevType) continue;
                if (Math.abs(flowSum) < pctMap[`${tk}_${w}_${pFloor}`]) continue;

                const avgDaily = flowSum / w;
                const zAtEnd = cur.flow_zscore ?? 0;
                const presAtEnd = Math.round(cur.pressure ?? 0);
                const s = i - w + 1;
                const canPre3 = s - 3 >= 0;
                let avgPre3 = null;
                if (canPre3) avgPre3 = ((data[s-3]?.usd_flow||0)+(data[s-2]?.usd_flow||0)+(data[s-1]?.usd_flow||0))/3;
                let cd = 0;
                for (let j = s; j <= i; j++) { const df = data[j].usd_flow||0; if (isBear ? df<0 : df>0) cd++; }
                const fc = cd / w;
                const ef = data[i].usd_flow || 0;
                const efOk = isBear ? ef < 0 : ef > 0;
                const confirmed =
                    (isBear ? zAtEnd <= -zFloor : zAtEnd >= zFloor) &&
                    (isBear ? presAtEnd < 0 : presAtEnd > 0) &&
                    (avgPre3 === null || (isBear ? avgDaily < avgPre3 : avgDaily > avgPre3)) &&
                    fc >= 0.5;
                const pN = Math.min(Math.abs(priceMove) / (thresh * 5), 1);
                const fN = maf > 0 ? Math.min(Math.abs(flowSum) / maf, 1) : 0;
                const cN = fc;
                const eN = efOk ? Math.min(Math.abs(ef) / (Math.abs(avgDaily)||1), 1.5) / 1.5 : 0;
                const STR = Math.round(pN*30 + fN*30 + (w/10)*12 + cN*15 + eN*13);
                if (!confirmed || STR < strFloor) continue;
                const ngImpl = side === 'L' ? (isBear ? 'BEAR' : 'BULL') : (isBear ? 'BULL' : 'BEAR');
                signals.push({ date: cur.date, tk, side, isBear, ngImpl, w, STR, confirmed });
            }
        }
    }
    signals.sort((a,b) => a.date.localeCompare(b.date));

    // Cluster
    if (!signals.length) return { signals: 0, clusters: 0, rows: 0 };
    const clusters = [];
    let cur = [signals[0]];
    for (let i = 1; i < signals.length; i++) {
        const gap = (dIdx.get(signals[i].date)||0) - (dIdx.get(cur[cur.length-1].date)||0);
        if (gap <= gapDays) cur.push(signals[i]);
        else { clusters.push(cur); cur = [signals[i]]; }
    }
    clusters.push(cur);

    const qualified = clusters.filter(c => {
        const tks = new Set(c.map(s => s.tk));
        if (tks.size < minETF) return false;
        let bull = 0, bear = 0;
        for (const s of c) s.ngImpl === 'BULL' ? bull++ : bear++;
        const majorDir = bull >= bear ? 'BULL' : 'BEAR';
        const majorSigs = c.filter(s => s.ngImpl === majorDir);
        return majorSigs.some(s => LONG_TKS.has(s.tk)) && majorSigs.some(s => SHORT_TKS.has(s.tk));
    });

    const rows = qualified.filter(c => Math.abs(scoreCluster(c)) >= normFloor);
    const years = 5.25; // 2021-01 to 2026-03
    return { signals: signals.length, clusters: qualified.length, rows: rows.length, perYr: (rows.length / years).toFixed(1) };
}

// Sweep
console.log('\n  pFloor  zFloor  strFloor  gap  minETF  normFloor | signals  clusters  rows  /yr');
console.log('  ' + '─'.repeat(82));

const combos = [
    // pFloor, zFloor, strFloor, gap, minETF, normFloor
    [50, 0.5,  50, 5, 4, 0.50],
    [50, 0.5,  55, 5, 4, 0.50],
    [50, 0.5,  60, 5, 4, 0.50],
    [50, 0.75, 55, 5, 4, 0.50],
    [50, 0.75, 55, 5, 3, 0.50],
    [50, 0.75, 55, 5, 3, 0.40],
    [60, 0.5,  55, 5, 4, 0.50],
    [60, 0.5,  55, 5, 3, 0.50],
    [60, 0.75, 55, 5, 3, 0.50],
    [60, 0.75, 55, 5, 3, 0.40],
    [60, 0.75, 60, 5, 3, 0.50],
    [65, 0.5,  55, 5, 3, 0.50],
    [65, 0.5,  55, 5, 3, 0.40],
    [65, 0.5,  55, 7, 3, 0.40],
    [65, 0.75, 55, 5, 3, 0.50],
    [65, 0.75, 60, 5, 3, 0.50],
    [70, 0.5,  55, 5, 3, 0.50],
    [70, 0.5,  55, 5, 3, 0.40],
    [70, 0.5,  55, 7, 3, 0.40],
    [70, 0.75, 55, 5, 3, 0.50],
    // tighter norm
    [60, 0.5,  55, 5, 3, 0.60],
    [65, 0.5,  55, 5, 3, 0.60],
    [65, 0.5,  55, 7, 3, 0.50],
    [70, 0.5,  55, 7, 3, 0.50],
    // even looser individual but strict cluster
    [50, 0.5,  55, 5, 4, 0.40],
    [50, 0.5,  50, 5, 4, 0.40],
    [50, 0.5,  50, 7, 4, 0.40],
];

for (const [pf, zf, sf, gap, minE, nf] of combos) {
    const r = run(pf, zf, sf, gap, minE, nf);
    const marker = parseFloat(r.perYr) >= 2.5 && parseFloat(r.perYr) <= 6.0 ? '  ◄ TARGET' : '';
    console.log(`  ${String(pf).padEnd(6)}  ${String(zf).padEnd(6)}  ${String(sf).padEnd(8)}  ${String(gap).padEnd(4)} ${String(minE).padEnd(6)}  ${String(nf).padEnd(10)}| ${String(r.signals).padEnd(8)} ${String(r.clusters).padEnd(10)} ${String(r.rows).padEnd(6)} ${r.perYr}${marker}`);
}
console.log();

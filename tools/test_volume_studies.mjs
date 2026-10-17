import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); passed++; }
function close(a, b, tol, msg) {
    assert.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} +/- ${tol})`);
    passed++;
}
function isNull(v, msg) { assert.strictEqual(v, null, msg); passed++; }
function isNum(v, msg) { assert.ok(typeof v === 'number' && isFinite(v), msg); passed++; }

function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start === -1) throw new Error('function not found in source: ' + name);
    let depth = 0;
    let inString = null;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        const ch = src[i];
        const next = src[i + 1];
        if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
        if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === inString) inString = null;
            continue;
        }
        if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error('unbalanced braces for: ' + name);
}

const ctxObj = { console, Date, Math, isFinite, parseInt, requestAnimationFrame: () => 0 };
vm.createContext(ctxObj);
vm.runInContext('CONFIG = { etfs: {}, volumeStudies: { oscillator: { fast: 5, slow: 21 }, ma: 21, ranges: [ { key: "3m", days: 90 }, { key: "6m", days: 180 }, { key: "1y", days: 365 }, { key: "2y", days: 730 }, { key: "all", days: null } ] } };', ctxObj);

const vsSrc = fs.readFileSync('docs/js/volume-studies.js', 'utf8');
vm.runInContext(vsSrc + '\n;globalThis.__VS = VolumeStudies;', ctxObj);
const VS = ctxObj.__VS;
ok(VS && typeof VS.compute === 'function', 'VolumeStudies loaded without DOM');

const tpSrc = fs.readFileSync('docs/trough-peak.html', 'utf8');
const cvpSrc = extractFunction(tpSrc, 'computeVolumeProfile');
const helperSrc = ['vpPriceAtFrac', 'vpPriceFrac', 'vpBucketLowPrice', 'vpBucketHighPrice', 'vpBucketMidPrice']
    .map(n => extractFunction(tpSrc, n)).join('\n');
vm.runInContext(cvpSrc + '\n' + helperSrc + '\n;globalThis.__CVP = computeVolumeProfile;globalThis.__H = { vpPriceAtFrac, vpPriceFrac, vpBucketLowPrice, vpBucketHighPrice, vpBucketMidPrice };', ctxObj);
const computeVolumeProfile = ctxObj.__CVP;
const vpH = ctxObj.__H;
ok(typeof computeVolumeProfile === 'function', 'computeVolumeProfile extracted from trough-peak.html');
ok(typeof vpH.vpBucketLowPrice === 'function', 'price helpers extracted from trough-peak.html');

// ---- primitives ----
const sma = VS.sma([1, 2, 3, 4, 5], 3);
isNull(sma[0], 'sma warm-up 0 null');
isNull(sma[1], 'sma warm-up 1 null');
eq(sma[2], 2, 'sma[2]=2');
eq(sma[3], 3, 'sma[3]=3');
eq(sma[4], 4, 'sma[4]=4');

const rs = VS.rollingSum([1, 2, 3, 4], 2);
isNull(rs[0], 'rollingSum[0] null');
eq(rs[1], 3, 'rollingSum[1]=3');
eq(rs[3], 7, 'rollingSum[3]=7');

const signs = VS.signSeries([10, 11, 10.5, 10.5, 12, 11]);
eq(JSON.stringify(signs), JSON.stringify([0, 1, -1, 0, 1, -1]), 'signSeries up/down/flat');

const sv = VS.signedVolume([10, 11, 10.5, 10.5, 12, 11], [100, 200, 300, 400, 500, 600]);
eq(JSON.stringify(sv), JSON.stringify([0, 200, -300, 0, 500, -600]), 'signedVolume');

const obv = VS.obv([10, 11, 10.5, 10.5, 12, 11], [100, 200, 300, 400, 500, 600]);
eq(JSON.stringify(obv), JSON.stringify([0, 200, -100, -100, 400, -200]), 'obv series');

const pvt = VS.pvt([10, 11, 10.5, 10.5, 12, 11], [100, 200, 300, 400, 500, 600]);
eq(pvt[0], 0, 'pvt starts at 0');
close(pvt[1], 20, 1e-9, 'pvt[1] = 200*(11-10)/10');
close(pvt[2], 20 - 300 * 0.5 / 11, 1e-9, 'pvt[2]');
close(pvt[5], pdvExpected(), 1e-9, 'pvt[5] cumulative');

function pdvExpected() {
    let acc = 0;
    const c = [10, 11, 10.5, 10.5, 12, 11];
    const v = [100, 200, 300, 400, 500, 600];
    for (let i = 1; i < c.length; i++) acc += v[i] * (c[i] - c[i - 1]) / c[i - 1];
    return acc;
}

const osc = VS.volumeOscillator([100, 200, 300, 400, 500], 2, 4);
isNull(osc[0], 'osc warm-up null');
isNull(osc[2], 'osc before slow window null');
close(osc[3], ((350 - 250) / 250) * 100, 1e-9, 'osc[3] = +40%');
isNum(osc[4], 'osc[4] finite');

// ---- range slicing ----
const nowMs = Date.now();
const dates400 = [];
for (let i = 0; i < 400; i++) dates400.push(new Date(nowMs - (399 - i) * 864e5).toISOString().slice(0, 10));
eq(VS.sliceStartForDays(dates400, null, nowMs), 0, 'range all -> start 0');
eq(VS.sliceStartForDays(dates400, 365, nowMs), 34, 'range 1y -> start 34');
eq(VS.sliceStartForDays(dates400, 99999, nowMs), 0, 'range longer than history -> start 0');
const datesOld = [];
for (let i = 0; i < 400; i++) datesOld.push(new Date(nowMs - (2399 - i) * 864e5).toISOString().slice(0, 10));
eq(VS.sliceStartForDays(datesOld, 7, nowMs), 398, 'stale history window clamps to len-2');

// ---- compute() payloads ----
const history = [];
for (let i = 0; i < 400; i++) {
    const base = 30 + Math.sin(i / 7) * 5;
    history.push({
        date: dates400[i],
        open: base, high: base * 1.02, low: base * 0.98,
        close: base,
        volume: 1000 + (i % 13) * 50
    });
}

for (const study of ['vol', 'osc', 'net', 'obv', 'pvt']) {
    const p = VS.compute(history, study, '1y');
    ok(p !== null, `compute(${study}) non-null`);
    ok(p.startIdx >= 34 && p.startIdx <= 35, `compute(${study}) startIdx ~34`);
    eq(p.dates.length, 400 - p.startIdx, `compute(${study}) sliced length`);
    eq(p.study, study, `compute(${study}) study tag`);
    if (study === 'vol') {
        eq(p.bars.length, 366, 'vol bars length');
        ok(!p.zeroCentered, 'vol not zero-centered');
    }
    if (study === 'osc') {
        ok(p.zeroCentered, 'osc zero-centered');
        isNum(p.line[0], 'osc sliced line[0] finite (past warm-up)');
        isNum(p.line[p.line.length - 1], 'osc last line finite');
    }
    if (study === 'net') {
        isNum(p.bars[0], 'net first bar finite');
        isNum(p.line[0], 'net rolled line finite past warm-up');
        isNum(p.line[p.line.length - 1], 'net last line finite');
    }
    if (study === 'obv' || study === 'pvt') {
        eq(p.line[0], 0, `${study} rebased to 0 at payload start`);
        isNum(p.ma[0], `${study} ma sliced finite`);
        isNum(p.ma[p.ma.length - 1], `${study} ma last finite`);
    }
}

const allOsc = VS.compute(history, 'osc', 'all');
for (let i = 0; i < 20; i++) isNull(allOsc.line[i], `osc all-range warm-up line[${i}] null`);
isNum(allOsc.line[20], 'osc all-range line[20] finite');
const allNet = VS.compute(history, 'net', 'all');
for (let i = 0; i < 20; i++) isNull(allNet.line[i], `net all-range warm-up line[${i}] null`);
isNum(allNet.line[20], 'net all-range line[20] finite');
const allObv = VS.compute(history, 'obv', 'all');
eq(allObv.line[0], 0, 'obv all-range line[0] = 0');
isNull(allObv.ma[19], 'obv all-range ma[19] null in warm-up');
isNum(allObv.ma[20], 'obv all-range ma[20] finite');
const allPvt = VS.compute(history, 'pvt', 'all');
eq(allPvt.line[0], 0, 'pvt all-range line[0] = 0');
isNum(allPvt.ma[20], 'pvt all-range ma[20] finite');

const allP = VS.compute(history, 'vol', 'all');
eq(allP.dates.length, 400, 'range all -> full length');
eq(allP.startIdx, 0, 'range all -> startIdx 0');
isNull(VS.compute([], 'vol', 'all'), 'empty history -> null');
isNull(VS.compute([history[0]], 'vol', 'all'), 'single bar -> null');

// ---- profile: handcrafted 3-point case ----
const prof = computeVolumeProfile(
    ['2024-01-01', '2024-01-02', '2024-01-03'], [10, 20, 30], [100, 200, 300], 0, 2, 10);
ok(prof !== null, 'profile non-null');
eq(prof.n, 10, 'profile bucket count');
eq(prof.totalVol, 600, 'profile totalVol');
eq(prof.buckets[0].up, 100, 'bucket0 up=100');
eq(prof.buckets[5].up, 200, 'bucket5 up=200');
eq(prof.buckets[9].up, 300, 'bucket9 up=300 (clamped top)');
eq(prof.pocIdx, 9, 'POC = bucket9');
let sumUp = 0, sumDown = 0, sumTot = 0;
for (const b of prof.buckets) { sumUp += b.up; sumDown += b.down; sumTot += b.total; }
eq(sumUp, 600, 'all volume classified up (rising closes)');
eq(sumDown, 0, 'no down volume');
eq(sumTot, prof.totalVol, 'bucket totals sum to totalVol');
let vaVol = 0;
for (let b = prof.vaLo; b <= prof.vaHi; b++) vaVol += prof.buckets[b].total;
ok(vaVol >= prof.totalVol * 0.7, 'value area >= 70% of volume');
ok(prof.vaLo <= prof.pocIdx && prof.pocIdx <= prof.vaHi, 'POC inside value area');

// ---- profile: down-day split ----
const profDown = computeVolumeProfile(
    ['2024-01-01', '2024-01-02', '2024-01-03'], [10, 5, 6], [100, 300, 50], 0, 2, 4);
eq(profDown.buckets[0].down, 300, 'down volume in low bucket');
eq(profDown.buckets[0].up, 50, 'recovery volume in low bucket');
eq(profDown.buckets[3].up, 100, 'first bar has no prev -> counted up');
eq(profDown.pocIdx, 0, 'POC at high-volume low bucket');
eq(profDown.totalVol, 450, 'down-case totalVol');

// ---- profile: edges ----
isNull(computeVolumeProfile(['a', 'b'], [1, 2], [10, 10], 0, 0, 10), 'single-day window -> null');
const profRev = computeVolumeProfile(['a', 'b', 'c'], [1, 2, 3], [10, 10, 10], 2, 0, 10);
ok(profRev !== null, 'reversed indices still compute');
eq(profRev.startIdx, 0, 'reversed indices -> lo = 0');
eq(profRev.endIdx, 2, 'reversed indices -> hi = 2');
const profFlat = computeVolumeProfile(['a', 'b', 'c'], [10, 10, 10], [100, 100, 100], 0, 2, 42);
ok(profFlat !== null && profFlat.span > 0, 'flat price window -> shimmer span > 0');
eq(profFlat.totalVol, 300, 'flat window totalVol');
const profZero = computeVolumeProfile(['a', 'b', 'c'], [1, 2, 3], [0, 0, 0], 0, 2, 10);
ok(profZero !== null, 'zero-volume profile still returns');
eq(profZero.totalVol, 0, 'zero-volume totalVol = 0');
eq(profZero.vaLo, profZero.pocIdx, 'zero-volume VA degenerates to POC bucket');
isNull(computeVolumeProfile(['a', 'b', 'c'], [0, 0, 0], [1, 1, 1], 0, 2, 10), 'non-positive closes -> null');

// ---- profile vs real data (if present) ----
const dataPath = 'docs/data/trough_peak_data.json';
if (fs.existsSync(dataPath)) {
    const tp = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    for (const [sym, t] of Object.entries(tp.tickers || {})) {
        if (!t || !t.dates || !t.closes || !t.volumes) continue;
        const p = computeVolumeProfile(t.dates, t.closes, t.volumes, 0, t.dates.length - 1, 42);
        ok(p !== null, `real-data profile (${sym}) non-null`);
        let rTot = 0;
        for (const b of p.buckets) rTot += b.total;
        close(rTot, p.totalVol, 1e-6, `real-data bucket totals match (${sym})`);
        let rVa = 0;
        for (let b = p.vaLo; b <= p.vaHi; b++) rVa += p.buckets[b].total;
        ok(rVa >= p.totalVol * 0.7 - 1e-6, `real-data value area >= 70% (${sym})`);
        let maxBuck = -Infinity;
        for (const b of p.buckets) { maxBuck = Math.max(maxBuck, b.total); }
        close(p.buckets[p.pocIdx].total, maxBuck, 1e-9, `POC is max bucket (${sym})`);
        for (const b of p.buckets) {
            ok(Math.abs(b.up + b.down - b.total) < 1e-6, 'bucket up+down == total');
        }
        const sub = computeVolumeProfile(t.dates, t.closes, t.volumes, t.dates.length - 120, t.dates.length - 1, 42);
        ok(sub !== null, `real-data subset profile (${sym}) non-null`);
        let sTot = 0;
        for (const b of sub.buckets) sTot += b.total;
        close(sTot, sub.totalVol, 1e-6, `subset bucket totals match (${sym})`);
        if (sym === 'BOIL') ok(p.useLog, 'BOIL full-range profile auto-switches to log scale');
    }
}

// ---- studies vs real dashboard history ----
const ddPath = 'docs/data/dashboard_data.json';
if (fs.existsSync(ddPath)) {
    const dd = JSON.parse(fs.readFileSync(ddPath, 'utf8'));
    for (const [ticker, e] of Object.entries(dd.etfs || {})) {
        if (!e.history || e.history.length < 30) continue;
        for (const study of ['vol', 'osc', 'net', 'obv', 'pvt']) {
            for (const range of ['3m', 'all']) {
                const p = VS.compute(e.history, study, range);
                ok(p !== null, `dashboard ${ticker} ${study} ${range} non-null`);
                const n = p.dates.length;
                eq(p.closes.length, n, `${ticker} ${study} closes length`);
                eq(p.volumes.length, n, `${ticker} ${study} volumes length`);
                const scan = (arr, name) => {
                    if (!arr) return;
                    for (let i = 0; i < arr.length; i++) {
                        const v = arr[i];
                        if (v == null) continue;
                        ok(isFinite(v), `${ticker} ${study} ${range} ${name}[${i}] finite`);
                    }
                };
                scan(p.bars, 'bars'); scan(p.line, 'line'); scan(p.ma, 'ma'); scan(p.colorSigns, 'signs');
                if (study === 'obv' || study === 'pvt') eq(p.line[0], 0, `${ticker} ${study} rebase start 0`);
                let sorted = true;
                for (let i = 1; i < n; i++) if (p.dates[i] < p.dates[i - 1]) { sorted = false; break; }
                ok(sorted, `${ticker} ${study} ${range} dates ascending`);
            }
        }
    }
}

// ---- profile: log-scale behaviour ----
const profLog = computeVolumeProfile(
    ['2024-01-01', '2024-01-02', '2024-01-03'], [10, 20, 30], [100, 200, 300], 0, 2, 10, true);
ok(profLog.useLog, 'explicit log scale flag set');
eq(profLog.buckets[0].up, 100, 'log: bucket0 up=100');
eq(profLog.buckets[6].up, 200, 'log: bucket6 up=200 (ln20 between ln10..ln30)');
eq(profLog.buckets[9].up, 300, 'log: bucket9 up=300 (top clamp)');
const profAutoLog = computeVolumeProfile(
    ['2024-01-01', '2024-01-02', '2024-01-03'], [1, 100, 1], [10, 10, 10], 0, 2, 10);
ok(profAutoLog.useLog, 'auto log engaged for >4x range');
const profLinear = computeVolumeProfile(
    ['2024-01-01', '2024-01-02', '2024-01-03'], [10, 12, 11], [10, 10, 10], 0, 2, 10);
ok(!profLinear.useLog, 'linear kept for tight range');
const profForceLin = computeVolumeProfile(
    ['2024-01-01', '2024-01-02', '2024-01-03'], [1, 100, 1], [10, 10, 10], 0, 2, 10, false);
ok(!profForceLin.useLog, 'explicit linear overrides auto');
close(vpH.vpBucketLowPrice(profLog, 9), 10 * Math.pow(3, 0.9), 1e-9, 'log bucket9 low edge = 10*3^0.9');
close(vpH.vpBucketHighPrice(profLog, 0), 10 * Math.pow(3, 0.1), 1e-9, 'log bucket0 high edge = 10*3^0.1');
close(vpH.vpPriceFrac(profLog, 30), 0, 1e-9, 'log frac(maxP) = 0');
close(vpH.vpPriceFrac(profLog, 10), 1, 1e-9, 'log frac(minP) = 1');
close(vpH.vpBucketMidPrice(profLinear, 5), 10 + (5.5 / 10) * 2, 1e-9, 'linear mid price');

// ---- profile: value area under log scale ----
let logVaVol = 0;
for (let b = profLog.vaLo; b <= profLog.vaHi; b++) logVaVol += profLog.buckets[b].total;
ok(logVaVol >= profLog.totalVol * 0.7, 'log value area >= 70%');
ok(profLog.vaLo <= profLog.pocIdx && profLog.pocIdx <= profLog.vaHi, 'log POC inside value area');

// ---- formatters ----
eq(VS.fmtVol(2500000), '2.50M', 'fmtVol millions');
eq(VS.fmtVol(2.5e12), '2.50T', 'fmtVol trillions');
eq(VS.fmtSigned(1500), '+2K', 'fmtSigned plus K');
eq(VS.fmtSigned(-1500), '-2K', 'fmtSigned minus K');
eq(VS.fmtVol(null), '--', 'fmtVol null');
eq(VS.fmtPrice(7874000), '7.9M', 'fmtPrice millions');
eq(VS.fmtPrice(5389013280), '5.39B', 'fmtPrice billions');
eq(VS.fmtDate('2024-03-15'), "Mar '24", 'fmtDate');

console.log(`PASS volume-studies: ${passed} assertions`);

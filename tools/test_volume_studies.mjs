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

const readingEl = { innerHTML: '' };
const mockDoc = {
    getElementById: id => (id === 'vs-reading' ? readingEl : null),
    querySelectorAll: () => []
};
const ctxObj = { console, Date, Math, isFinite, parseInt, requestAnimationFrame: () => 0, document: mockDoc };
vm.createContext(ctxObj);
// Load the real shipped config so the test tracks its live schema (ranges, oscillator windows).
vm.runInContext(fs.readFileSync('docs/js/config.js', 'utf8') + '\n;globalThis.__CFG = CONFIG;', ctxObj);
ok(ctxObj.__CFG && ctxObj.__CFG.volumeStudies && Array.isArray(ctxObj.__CFG.volumeStudies.ranges)
    && ctxObj.__CFG.volumeStudies.ranges.length >= 5, 'real config.js loaded (volumeStudies.ranges present)');
isNum(ctxObj.__CFG.volumeStudies.oscillator.fast, 'config oscillator.fast is a number');
isNum(ctxObj.__CFG.volumeStudies.oscillator.slow, 'config oscillator.slow is a number');

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

// ── CMF mathematical tests ──
const cmfWarm = VS.cmf(
    new Array(30).fill(105),
    new Array(30).fill(95),
    new Array(30).fill(100),
    new Array(30).fill(1000),
    21
);
for (let i = 0; i < 20; i++) isNull(cmfWarm[i], `cmf warm-up index ${i} null`);
isNum(cmfWarm[20], 'cmf index 20 finite');
eq(cmfWarm[20], 0, 'cmf index 20 exactly 0 for midpoint closes');

// Handcrafted 3-bar test (len = 2)
// Bar 0: H=12, L=8, C=12, V=100 -> CLV = 1.0 -> MFV = 100
// Bar 1: H=15, L=5, C=10, V=200 -> CLV = 0.0 -> MFV = 0
// Bar 2: H=14, L=10, C=10, V=300 -> CLV = -1.0 -> MFV = -300
// len = 2: cmf[1] = 100/300 = 1/3, cmf[2] = -300/500 = -0.6
const cmfHand = VS.cmf([12, 15, 14], [8, 5, 10], [12, 10, 10], [100, 200, 300], 2);
isNull(cmfHand[0], 'cmf handcrafted bar 0 null');
close(cmfHand[1], 1 / 3, 1e-9, 'cmf handcrafted bar 1 = +1/3');
close(cmfHand[2], -0.6, 1e-9, 'cmf handcrafted bar 2 = -0.6');

// Boundary [-1, 1] tests
const cmfBull = VS.cmf([20, 20], [10, 10], [20, 20], [500, 500], 2);
eq(cmfBull[1], 1, 'cmf closes at high -> boundary +1.0');
const cmfBear = VS.cmf([20, 20], [10, 10], [10, 10], [500, 500], 2);
eq(cmfBear[1], -1, 'cmf closes at low -> boundary -1.0');

// Zero division when H = L (flat range day, range = 0)
const cmfFlatHL = VS.cmf([10, 10], [10, 10], [10, 10], [100, 200], 2);
eq(cmfFlatHL[1], 0, 'cmf zero division when H = L returns 0');

// Zero division when volume sum = 0
const cmfZeroVol = VS.cmf([15, 15], [5, 5], [10, 10], [0, 0], 2);
eq(cmfZeroVol[1], 0, 'cmf zero division when sum volume = 0 returns 0');

// Length edge cases
eq(VS.cmf([10], [10], [10], [100], 21)[0], null, 'cmf with n < len returns null array');
eq(VS.cmf([10], [10], [10], [100], 0).length, 1, 'cmf with len <= 0 returns null array');

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

for (const study of ['vol', 'osc', 'net', 'cmf', 'obv', 'pvt']) {
    const p = VS.compute(history, study, '1y');
    ok(p !== null, `compute(${study}) non-null`);
    ok(p.startIdx >= 34 && p.startIdx <= 35, `compute(${study}) startIdx ~34`);
    eq(p.dates.length, 400 - p.startIdx, `compute(${study}) sliced length`);
    eq(p.study, study, `compute(${study}) study tag`);
    if (study === 'vol') {
        eq(p.bars.length, 366, 'vol bars length');
        ok(!p.zeroCentered, 'vol not zero-centered');
    }
    if (study === 'osc' || study === 'cmf') {
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
const allCmf = VS.compute(history, 'cmf', 'all');
for (let i = 0; i < 20; i++) isNull(allCmf.line[i], `cmf all-range warm-up line[${i}] null`);
isNum(allCmf.line[20], 'cmf all-range line[20] finite');
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

for (const r of ctxObj.__CFG.volumeStudies.ranges) {
    const p = VS.compute(history, 'vol', r.key);
    ok(p !== null && p.dates.length >= 2, `compute(vol, ${r.key}) non-null`);
    eq(p.study, 'vol', `compute(vol, ${r.key}) study tag`);
}

// ---- dollar-volume unit mode & custom range slider slicing ----
const pDollar = VS.compute(history, 'vol', '1y', { unit: 'dollar' });
ok(pDollar !== null, 'compute dollar mode non-null');
eq(pDollar.unit, 'dollar', 'dollar mode flag in payload');
eq(pDollar.bars.length, 366, 'dollar mode sliced length matches');
close(pDollar.bars[0], history[pDollar.startIdx].close * history[pDollar.startIdx].volume, 1e-6, 'dollar bar equals close * vol');

const pCmfShares = VS.compute(history, 'cmf', '1y', { unit: 'shares' });
ok(pCmfShares !== null, 'cmf shares mode non-null');
eq(pCmfShares.unit, 'shares', 'cmf shares unit tag');
isNum(pCmfShares.line[pCmfShares.line.length - 1], 'cmf shares line finite');

const pCmfDollar = VS.compute(history, 'cmf', '1y', { unit: 'dollar' });
ok(pCmfDollar !== null, 'cmf dollar mode non-null');
eq(pCmfDollar.unit, 'dollar', 'cmf dollar unit tag');
isNum(pCmfDollar.line[pCmfDollar.line.length - 1], 'cmf dollar line finite');
close(pCmfDollar.dollarVolumes[0], pCmfDollar.closes[0] * pCmfDollar.rawVolumes[0], 1e-6, 'dollarVolumes matches close * rawVolume');

const pCustom = VS.compute(history, 'obv', 'custom', { customStart: 50, customEnd: 150 });
ok(pCustom !== null, 'compute custom range non-null');
eq(pCustom.startIdx, 50, 'custom startIdx = 50');
eq(pCustom.endIdx, 150, 'custom endIdx = 150');
eq(pCustom.dates.length, 101, 'custom range length = 101');
eq(pCustom.line[0], 0, 'custom range obv starts rebased to 0');

const oscZero = VS.volumeOscillator([0, 0, 0, 0, 0, 0], 2, 4);
eq(oscZero[4], 0, 'osc with all zero volume evaluates to 0% rather than null');

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
        for (const study of ['vol', 'osc', 'net', 'cmf', 'obv', 'pvt']) {
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
eq(VS.fmtVol(null), '—', 'fmtVol null returns em-dash');
eq(VS.fmtSigned(null), '—', 'fmtSigned null returns em-dash');
eq(VS.fmtPct(null), '—', 'fmtPct null returns em-dash');
eq(VS.fmtPct(2.456), '+2.46%', 'fmtPct formatted');
eq(VS.fmtPct(-1.2), '-1.20%', 'fmtPct negative');
eq(VS.fmtPrice(null), '—', 'fmtPrice null returns em-dash');
eq(VS.fmtDate(null), '—', 'fmtDate null returns em-dash');
eq(VS.fmtFullDate(null), '—', 'fmtFullDate null returns em-dash');
eq(VS.fmtPrice(7874000), '7.9M', 'fmtPrice millions');
eq(VS.fmtPrice(5389013280), '5.39B', 'fmtPrice billions');
eq(VS.fmtDate('2024-03-15'), "Mar '24", 'fmtDate');

// Dollar mode formatters
eq(VS.fmtVol(1500, 'dollar'), '$2K', 'fmtVol dollar K');
eq(VS.fmtVol(2500000, 'dollar'), '$2.50M', 'fmtVol dollar M');
eq(VS.fmtVol(3800000000, 'dollar'), '$3.80B', 'fmtVol dollar B');
eq(VS.fmtVol(1200000000000, 'dollar'), '$1.20T', 'fmtVol dollar T');
eq(VS.fmtVol(-2500000, 'dollar'), '-$2.50M', 'fmtVol negative dollar M');
eq(VS.fmtSigned(2500000, 'dollar'), '+$2.50M', 'fmtSigned dollar plus M');
eq(VS.fmtSigned(-2500000, 'dollar'), '-$2.50M', 'fmtSigned dollar minus M');
eq(VS.fmtSigned(0, 'dollar'), '$0', 'fmtSigned dollar zero');

// Unit toggle cache key verification
VS.state.unit = 'shares';
const p1Shares = VS._getPayload('BOIL', history);
eq(p1Shares.unit, 'shares', 'initial payload is shares');
VS.state.unit = 'dollar';
const p2Dollar = VS._getPayload('BOIL', history);
eq(p2Dollar.unit, 'dollar', 'switched payload is dollar');
ok(p1Shares !== p2Dollar, 'cache invalidated on unit toggle');
VS.state.unit = 'shares';

// CMF mathematical bounds check across randomized bars
for (let seed = 0; seed < 10; seed++) {
    const testH = [], testL = [], testC = [], testV = [];
    for (let i = 0; i < 50; i++) {
        const lo = 10 + Math.random() * 50;
        const hi = lo + Math.random() * 20;
        const cl = lo + Math.random() * (hi - lo);
        const vo = Math.floor(Math.random() * 10000);
        testH.push(hi); testL.push(lo); testC.push(cl); testV.push(vo);
    }
    const res = VS.cmf(testH, testL, testC, testV, 21);
    for (let i = 20; i < 50; i++) {
        ok(res[i] >= -1.0 && res[i] <= 1.0, `cmf bounded in [-1, +1] at index ${i}`);
    }
}

// Divergence detection truth table tests in _updateReading
function testDivergence(study, priceChangePct, indicatorSignal) {
    const dates = [];
    const closes = [];
    const baseP = 100;
    const finalP = baseP * (1 + priceChangePct);
    for (let i = 0; i < 30; i++) {
        dates.push(`2024-01-${String(i + 1).padStart(2, '0')}`);
        closes.push(i < 9 ? baseP : baseP + (finalP - baseP) * ((i - 8) / 21));
    }
    const n = dates.length;
    let line = null;
    let bars = null;
    let ma = null;
    if (study === 'cmf') {
        line = new Array(n).fill(indicatorSignal);
    } else if (study === 'obv' || study === 'pvt') {
        line = new Array(n).fill(0);
        for (let i = 0; i < n; i++) line[i] = i * (indicatorSignal / 21);
        ma = new Array(n).fill(0);
    }
    const testPayload = {
        study,
        unit: 'shares',
        dates,
        closes,
        volumes: new Array(n).fill(1000),
        rawVolumes: new Array(n).fill(1000),
        dollarVolumes: new Array(n).fill(100000),
        bars,
        line,
        ma
    };
    VS._updateReading({ rvol: { '21d': 1.0 } }, testPayload, null);
    return readingEl.innerHTML;
}

// Case 1: Bullish Divergence (Price < -1%, Indicator > 0)
const htmlBull = testDivergence('cmf', -0.05, 0.15);
ok(htmlBull.includes('BULLISH DIVERGENCE'), 'CMF bullish divergence detected');
ok(htmlBull.includes('#3db87a'), 'CMF bullish divergence green color');

const htmlBullObv = testDivergence('obv', -0.05, 500);
ok(htmlBullObv.includes('BULLISH DIVERGENCE'), 'OBV bullish divergence detected');
ok(htmlBullObv.includes('#3db87a'), 'OBV bullish divergence green color');

// Case 2: Bearish Divergence (Price > +1%, Indicator < 0)
const htmlBear = testDivergence('cmf', 0.05, -0.15);
ok(htmlBear.includes('BEARISH DIVERGENCE'), 'CMF bearish divergence detected');
ok(htmlBear.includes('#c04040'), 'CMF bearish divergence red color');

const htmlBearObv = testDivergence('obv', 0.05, -500);
ok(htmlBearObv.includes('BEARISH DIVERGENCE'), 'OBV bearish divergence detected');
ok(htmlBearObv.includes('#c04040'), 'OBV bearish divergence red color');

// Case 3: Volume Confirmed (Price > +1%, Indicator > 0)
const htmlConfBull = testDivergence('cmf', 0.05, 0.15);
ok(htmlConfBull.includes('VOLUME CONFIRMED'), 'CMF volume confirmed detected');
ok(htmlConfBull.includes('#3db87a'), 'CMF volume confirmed green color');

// Case 4: Distribution Confirmed (Price < -1%, Indicator < 0)
const htmlConfBear = testDivergence('cmf', -0.05, -0.15);
ok(htmlConfBear.includes('DISTRIBUTION CONFIRMED'), 'CMF distribution confirmed detected');
ok(htmlConfBear.includes('#c04040'), 'CMF distribution confirmed red color');

// Case 5: Flat Price (Price within +/-1%)
const htmlFlatAcc = testDivergence('cmf', 0.002, 0.15);
ok(htmlFlatAcc.includes('ACCUMULATION'), 'CMF flat price with positive signal gives ACCUMULATION');
const htmlFlatDist = testDivergence('cmf', -0.002, -0.15);
ok(htmlFlatDist.includes('DISTRIBUTION'), 'CMF flat price with negative signal gives DISTRIBUTION');

// Short history edge case (< 21 bars)
const shortPayload = {
    study: 'cmf',
    unit: 'shares',
    dates: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'],
    closes: [10, 11, 10.5, 12, 11.5],
    volumes: [100, 100, 100, 100, 100],
    rawVolumes: [100, 100, 100, 100, 100],
    dollarVolumes: [1000, 1100, 1050, 1200, 1150],
    bars: null,
    line: [null, null, null, null, 0.12],
    ma: null
};
readingEl.innerHTML = '';
VS._updateReading({}, shortPayload, null);
ok(readingEl.innerHTML.length > 0, 'short history < 21 bars renders without crashing');
ok(!readingEl.innerHTML.includes('NaN'), 'short history renders without NaN');

console.log(`PASS volume-studies: ${passed} assertions`);

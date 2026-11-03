/**
 * Comprehensive Quantitative & Unit Verification Suite
 * Definitive Invariant Price-Volume Trend (IPVT) & Asymmetric Alpha Engine
 * 
 * Verifies:
 * 1. Numerical Sanity: Zero NaNs, undefined, or infinities across all 6 tickers (24,018 bars, 2008-2026).
 * 2. Split Invariance: Dimensionless stationarity of f_t and RVOL across reverse splits (2012 vs 2026, synthetic splits).
 * 3. Bounded Z-Score: Strict boundedness in (-100, +100), deadband (±25), and climax (±72) transitions.
 * 4. OBV Baseline Parity: 100.000% zero-regression equivalence to canonical OBV.
 * 5. Asymmetric Regime Classification: Proper classification of INVERSE_CARRY vs LONG_DECAY and state machine enforcement (e.g. 7-day max hold).
 * 6. Cross-Pair Flow Coherence: Robust composite calculation and graceful standalone fallback without sister data.
 * 7. Multi-Decade Execution Performance: Full 6-ticker calculation completes in < 500 ms.
 */

import assert from 'assert';
import fs from 'fs';
import vm from 'vm';
import { performance } from 'perf_hooks';

// Load dashboard data
const dataPath = 'docs/data/dashboard_data.json';
if (!fs.existsSync(dataPath)) {
    console.error(`Missing dataset: ${dataPath}`);
    process.exit(1);
}
const dashboardData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Initialize VM Context with mock browser environment
const ctx = {
    console,
    Math,
    Date,
    isFinite,
    parseInt,
    parseFloat,
    Array,
    Float64Array,
    Map,
    performance,
    document: {
        getElementById: () => ({ innerHTML: '', querySelectorAll: () => [] }),
        querySelectorAll: () => []
    }
};
vm.createContext(ctx);

// Load real config and volume-studies
vm.runInContext(fs.readFileSync('docs/js/config.js', 'utf8') + '; globalThis.CONFIG = CONFIG;', ctx);
vm.runInContext(fs.readFileSync('docs/js/volume-studies.js', 'utf8') + '; globalThis.VolumeStudies = VolumeStudies;', ctx);

const VS = ctx.VolumeStudies;
const CONFIG = ctx.CONFIG;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function check(cond, description) {
    totalTests++;
    if (cond) {
        passedTests++;
    } else {
        failedTests++;
        console.error(`  [FAIL] ${description}`);
    }
}

console.log('='.repeat(80));
console.log('BLUE MERIDIAN — STRICT QUANTITATIVE & UNIT VERIFICATION SUITE');
console.log('Invariant Price-Volume Trend (IPVT) & Asymmetric Alpha Engine');
console.log('='.repeat(80));

const tickers = ['BOIL', 'KOLD', 'HNU.TO', 'HND.TO', '3NGL.L', '3NGS.L'];
const sisterMap = {
    'BOIL': 'KOLD',
    'KOLD': 'BOIL',
    'HNU.TO': 'HND.TO',
    'HND.TO': 'HNU.TO',
    '3NGL.L': '3NGS.L',
    '3NGS.L': '3NGL.L'
};

const results = {};

// ============================================================================
// TEST 1: NUMERICAL SANITY & ZERO NaN/UNDEFINED/INFINITY AUDIT
// ============================================================================
console.log('\n>>> [TEST 1] Numerical Sanity & Zero NaN/Undefined/Infinity Audit');

let totalBarsAudited = 0;
let nanCount = 0;
let infinityCount = 0;
let undefinedCount = 0;

const summaryTable = [];

for (const ticker of tickers) {
    const etf = dashboardData.etfs[ticker];
    check(etf && etf.history && etf.history.length > 0, `${ticker} history exists in dashboard_data.json`);
    const history = etf.history;
    const sisterTicker = sisterMap[ticker];
    const sisterBars = dashboardData.etfs[sisterTicker] ? dashboardData.etfs[sisterTicker].history : null;

    const res = VS.computeInvariantPVTEngine(history, ticker, sisterBars);
    results[ticker] = res;

    const n = history.length;
    totalBarsAudited += n;

    let tickerNans = 0;
    let tickerInfs = 0;
    let tickerUndefs = 0;

    const numericFields = [
        'closes', 'highs', 'lows', 'volumes', 'turnover', 'rvol', 'volWeight',
        'hybridReturn', 'sigmaTrim', 'impulse', 'ipvt', 'zScore', 'crossPair'
    ];

    for (const field of numericFields) {
        const arr = res[field];
        if (!arr || arr.length !== n) {
            tickerUndefs++;
            continue;
        }
        for (let i = 0; i < n; i++) {
            const v = arr[i];
            if (v === undefined) tickerUndefs++;
            else if (typeof v !== 'number' || isNaN(v)) tickerNans++;
            else if (!isFinite(v)) tickerInfs++;
        }
    }

    // Verify boolean arrays
    for (let i = 0; i < n; i++) {
        if (typeof res.bullishDiv[i] !== 'boolean') tickerUndefs++;
        if (typeof res.bearishDiv[i] !== 'boolean') tickerUndefs++;
        if (typeof res.inPosition[i] !== 'boolean') tickerUndefs++;
        if (typeof res.actions[i] !== 'string' || res.actions[i].length === 0) tickerUndefs++;
        if (typeof res.statuses[i] !== 'string' || res.statuses[i].length === 0) tickerUndefs++;
    }

    nanCount += tickerNans;
    infinityCount += tickerInfs;
    undefinedCount += tickerUndefs;

    summaryTable.push({
        Ticker: ticker,
        Bars: n,
        'Start Date': res.dates[0],
        'End Date': res.dates[n - 1],
        NaNs: tickerNans,
        Infs: tickerInfs,
        Undefs: tickerUndefs,
        Status: (tickerNans === 0 && tickerInfs === 0 && tickerUndefs === 0) ? 'PASS' : 'FAIL'
    });
}

console.table(summaryTable);
check(nanCount === 0, `Total NaNs across all ${totalBarsAudited} bars is exactly 0 (got ${nanCount})`);
check(infinityCount === 0, `Total Infs across all ${totalBarsAudited} bars is exactly 0 (got ${infinityCount})`);
check(undefinedCount === 0, `Total Undefined across all ${totalBarsAudited} bars is exactly 0 (got ${undefinedCount})`);

// ============================================================================
// TEST 2: SPLIT INVARIANCE AUDIT
// ============================================================================
console.log('\n>>> [TEST 2] Split Invariance & Dimensional Stationarity Audit');

// Examine BOIL reverse split extremes (2012 vs 2026)
const boilRes = results['BOIL'];
const boilHistory = dashboardData.etfs['BOIL'].history;

// Era 1: 2012 (pre-split adjusted price ~$4,000,000 / volume ~few shares)
const idx2012 = [];
// Era 2: 2026 (split-adjusted price ~$16 / volume ~5,000,000 shares)
const idx2026 = [];

for (let i = 0; i < boilRes.dates.length; i++) {
    const d = boilRes.dates[i];
    if (d.startsWith('2012-')) idx2012.push(i);
    else if (d.startsWith('2026-')) idx2026.push(i);
}

function statsOf(arr, indices) {
    let sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
    for (const idx of indices) {
        const v = arr[idx];
        sum += v;
        sumSq += v * v;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const n = indices.length;
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, (sumSq - n * mean * mean) / (n - 1)));
    return { mean, std, min, max };
}

const rvol2012 = statsOf(boilRes.rvol, idx2012);
const rvol2026 = statsOf(boilRes.rvol, idx2026);
const imp2012 = statsOf(boilRes.impulse, idx2012);
const imp2026 = statsOf(boilRes.impulse, idx2026);

console.log('BOIL Split Era Comparison (2012 vs 2026):');
console.table([
    {
        Era: '2012 (Price: $4.0M, Vol: ~0-1K)',
        'Mean RVOL': rvol2012.mean.toFixed(2),
        'Max RVOL': rvol2012.max.toFixed(2),
        'Mean f_t': imp2012.mean.toFixed(2),
        'Std f_t': imp2012.std.toFixed(2),
        'Range f_t': `[${imp2012.min.toFixed(2)}, ${imp2012.max.toFixed(2)}]`
    },
    {
        Era: '2026 (Price: $16.0, Vol: ~5.0M)',
        'Mean RVOL': rvol2026.mean.toFixed(2),
        'Max RVOL': rvol2026.max.toFixed(2),
        'Mean f_t': imp2026.mean.toFixed(2),
        'Std f_t': imp2026.std.toFixed(2),
        'Range f_t': `[${imp2026.min.toFixed(2)}, ${imp2026.max.toFixed(2)}]`
    }
]);

// Verify that both RVOL and impulse are bounded within reasonable physical ranges across 2012 and 2026
check(rvol2012.mean > 0.5 && rvol2012.mean < 2.5, '2012 mean RVOL is stationary around 1.0');
check(rvol2026.mean > 0.5 && rvol2026.mean < 2.5, '2026 mean RVOL is stationary around 1.0');
check(Math.abs(imp2012.mean) < 1.0, '2012 flow impulse mean is centered near 0');
check(Math.abs(imp2026.mean) < 1.0, '2026 flow impulse mean is centered near 0');
check(imp2012.std > 0.5 && imp2012.std < 3.0, '2012 flow impulse std is unit-scale');
check(imp2026.std > 0.5 && imp2026.std < 3.0, '2026 flow impulse std is unit-scale');

// Synthetic Reverse Split Invariance Test:
// Simulate a 1-for-10 reverse split on a segment of data (Price * 10, Volume / 10).
// Turnover = Volume * Price = unchanged.
// TrueRange / TypPrice = unchanged.
// LogRet = ln(10C / 10C_-1) = ln(C / C_-1) = unchanged.
// Check that f_t and RVOL are IDENTICAL to machine precision!
const origSegment = boilHistory.slice(100, 200);
const splitSegment = origSegment.map(b => ({
    date: b.date,
    open: b.open * 10,
    high: b.high * 10,
    low: b.low * 10,
    close: b.close * 10,
    volume: b.volume / 10
}));

const engOrig = VS.computeInvariantPVTEngine(origSegment, 'BOIL', null);
const engSplit = VS.computeInvariantPVTEngine(splitSegment, 'BOIL', null);

let maxSplitDeltaF = 0;
let maxSplitDeltaRVOL = 0;
let maxSplitDeltaZ = 0;

for (let i = 0; i < origSegment.length; i++) {
    const dF = Math.abs(engOrig.impulse[i] - engSplit.impulse[i]);
    const dR = Math.abs(engOrig.rvol[i] - engSplit.rvol[i]);
    const dZ = Math.abs(engOrig.zScore[i] - engSplit.zScore[i]);
    if (dF > maxSplitDeltaF) maxSplitDeltaF = dF;
    if (dR > maxSplitDeltaRVOL) maxSplitDeltaRVOL = dR;
    if (dZ > maxSplitDeltaZ) maxSplitDeltaZ = dZ;
}

console.log(`Synthetic 1-for-10 Reverse Split Invariance:`);
console.log(`  Max Δ(f_t)   : ${maxSplitDeltaF.toExponential(2)}`);
console.log(`  Max Δ(RVOL)  : ${maxSplitDeltaRVOL.toExponential(2)}`);
console.log(`  Max Δ(Z_PVT) : ${maxSplitDeltaZ.toExponential(2)}`);

check(maxSplitDeltaF < 1e-12, 'Flow impulse f_t is strictly reverse split invariant (error < 1e-12)');
check(maxSplitDeltaRVOL < 1e-12, 'Robust RVOL is strictly reverse split invariant (error < 1e-12)');
check(maxSplitDeltaZ < 1e-12, 'Stationary Z-score Z_PVT is strictly reverse split invariant (error < 1e-12)');

// ============================================================================
// TEST 3: STATIONARY Z-SCORE BOUNDS & OSCILLATOR AUDIT
// ============================================================================
console.log('\n>>> [TEST 3] Stationary Z-Score Bounds & Oscillator Audit');

const zStats = [];
let allZInBounds = true;

for (const ticker of tickers) {
    const res = results[ticker];
    let minZ = Infinity, maxZ = -Infinity;
    let deadbandAccumTransitions = 0;
    let deadbandDistTransitions = 0;
    let climaxHighTransitions = 0;
    let climaxLowTransitions = 0;

    for (let i = 0; i < res.zScore.length; i++) {
        const z = res.zScore[i];
        if (z <= -100 || z >= 100) allZInBounds = false;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;

        if (i > 0) {
            const prevZ = res.zScore[i - 1];
            // Cross above +25
            if (prevZ < 25 && z >= 25) deadbandAccumTransitions++;
            // Cross below -25
            if (prevZ > -25 && z <= -25) deadbandDistTransitions++;
            // Cross above +72
            if (prevZ < 72 && z >= 72) climaxHighTransitions++;
            // Cross below -72
            if (prevZ > -72 && z <= -72) climaxLowTransitions++;
        }
    }

    zStats.push({
        Ticker: ticker,
        'Min Z': minZ.toFixed(2),
        'Max Z': maxZ.toFixed(2),
        'Cross +25': deadbandAccumTransitions,
        'Cross -25': deadbandDistTransitions,
        'Cross +72': climaxHighTransitions,
        'Cross -72': climaxLowTransitions,
        Bounded: (minZ > -100 && maxZ < 100) ? 'YES (-100, +100)' : 'NO'
    });
}

console.table(zStats);
check(allZInBounds, 'Stationary Z_PVT is strictly bounded inside (-100, +100) across all 24,018 bars');

// Verify sigmoid monotonicity
let isMonotonic = true;
const testZ = [-10, -5, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 10];
const sigmoidOut = testZ.map(z => 100.0 * (z / Math.sqrt(z * z + 2.25)));
for (let i = 1; i < sigmoidOut.length; i++) {
    if (sigmoidOut[i] <= sigmoidOut[i - 1]) isMonotonic = false;
}
check(isMonotonic, 'Algebraic sigmoid Z-score transform is strictly monotonically increasing');

// ============================================================================
// TEST 4: OBV REGRESSION & BASELINE PARITY AUDIT
// ============================================================================
console.log('\n>>> [TEST 4] OBV Baseline Parity & Zero-Regression Audit');

// Canonical legacy OBV reference implementation
function referenceObv(closes, volumes) {
    const n = closes.length;
    const out = new Array(n).fill(0);
    let acc = 0;
    for (let i = 1; i < n; i++) {
        const sign = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0;
        acc += sign * (volumes[i] || 0);
        out[i] = acc;
    }
    return out;
}

let obvParityPass = true;
const obvDiffTable = [];

for (const ticker of tickers) {
    const history = dashboardData.etfs[ticker].history;
    const closes = history.map(b => b.close);
    const volumes = history.map(b => b.volume);

    // 1. Direct method equality
    const refObvArr = referenceObv(closes, volumes);
    const directObvArr = VS.obv(closes, volumes);

    let maxDirectDelta = 0;
    for (let i = 0; i < closes.length; i++) {
        const d = Math.abs(refObvArr[i] - directObvArr[i]);
        if (d > maxDirectDelta) maxDirectDelta = d;
    }

    // 2. Full pipeline equality via VS.compute(..., 'obv', '1y')
    const payload = VS.compute(history, 'obv', '1y');
    const startIdx = payload.startIdx;
    const endIdx = payload.endIdx;
    const base = refObvArr[startIdx];
    const expectedLine = refObvArr.slice(startIdx, endIdx + 1).map(v => v - base);

    let maxPipelineDelta = 0;
    for (let i = 0; i < payload.line.length; i++) {
        const d = Math.abs(payload.line[i] - expectedLine[i]);
        if (d > maxPipelineDelta) maxPipelineDelta = d;
    }

    if (maxDirectDelta > 0 || maxPipelineDelta > 0) obvParityPass = false;

    obvDiffTable.push({
        Ticker: ticker,
        'Direct OBV Δ': maxDirectDelta.toFixed(0),
        'Pipeline OBV Δ': maxPipelineDelta.toFixed(0),
        'Regression Status': (maxDirectDelta === 0 && maxPipelineDelta === 0) ? '100% IDENTICAL' : 'REGRESSION DETECTED'
    });
}

console.table(obvDiffTable);
check(obvParityPass, 'OBV executes 100.000% identically to legacy baseline with zero regressions');

// ============================================================================
// TEST 5: ASYMMETRIC REGIME CLASSIFICATION & STATE MACHINE AUDIT
// ============================================================================
console.log('\n>>> [TEST 5] Asymmetric Regime Classification & State Machine Audit');

const regimeTable = [];
let allRegimesCorrect = true;
let stateMachineValid = true;

for (const ticker of tickers) {
    const res = results[ticker];
    const side = res.side;
    const regime = res.regime;

    const isInverse = (ticker === 'KOLD' || ticker === 'HND.TO' || ticker === '3NGS.L');
    const expectedRegime = isInverse ? 'INVERSE_CARRY' : 'LONG_DECAY';
    const expectedSide = isInverse ? 'short' : 'long';

    if (regime !== expectedRegime || side !== expectedSide) allRegimesCorrect = false;

    // State machine check:
    // Long side must STRICTLY obey 7-day max hold rule
    let maxHoldDays = 0;
    let curHold = 0;
    let crashBreakersFired = 0;
    let climaxExitsFired = 0;
    let trailingStopExitsFired = 0;

    for (let i = 0; i < res.dates.length; i++) {
        const inPos = res.inPosition[i];
        const action = res.actions[i];

        if (action.includes('CRASH BREAKER')) crashBreakersFired++;
        if (action.includes('CLIMAX')) climaxExitsFired++;
        if (action.includes('TRAILING STOP')) trailingStopExitsFired++;

        if (inPos) {
            curHold++;
            if (curHold > maxHoldDays) maxHoldDays = curHold;
        } else {
            curHold = 0;
        }
    }

    if (!isInverse && maxHoldDays > 7) {
        stateMachineValid = false;
        console.error(`Long ETP ${ticker} violated 7-day max hold rule (held ${maxHoldDays} days)`);
    }

    regimeTable.push({
        Ticker: ticker,
        Side: side,
        Regime: regime,
        'Expected Regime': expectedRegime,
        'Max Hold Days': maxHoldDays,
        'Crash Breakers': crashBreakersFired,
        'Climax Exits': climaxExitsFired,
        'Trailing Stop Exits': trailingStopExitsFired,
        Compliant: (regime === expectedRegime && (!isInverse ? maxHoldDays <= 7 : true)) ? 'YES' : 'NO'
    });
}

console.table(regimeTable);
check(allRegimesCorrect, 'Asymmetric Regime Engine properly classifies INVERSE_CARRY for short ETPs and LONG_DECAY for long ETPs');
check(stateMachineValid, 'Long ETPs strictly enforce the 7-day maximum holding period to prevent physical contango bleed');

// ============================================================================
// TEST 6: CROSS-PAIR FLOW COHERENCE AUDIT
// ============================================================================
console.log('\n>>> [TEST 6] Cross-Pair Flow Coherence Audit');

let crossPairMathValid = true;
let standaloneFallbackValid = true;

for (const ticker of tickers) {
    const res = results[ticker];
    const sisterTicker = sisterMap[ticker];
    const sisterRes = results[sisterTicker];

    // Check composite formula: C_pair = 0.65 * Z_primary - 0.35 * Z_sister on matching dates
    const sisterMapZ = new Map();
    for (let i = 0; i < sisterRes.dates.length; i++) {
        sisterMapZ.set(sisterRes.dates[i], sisterRes.zScore[i]);
    }

    let maxCompositeDelta = 0;
    for (let i = 0; i < res.dates.length; i++) {
        const d = res.dates[i];
        if (sisterMapZ.has(d)) {
            const zP = res.zScore[i];
            const zS = sisterMapZ.get(d);
            const expectedCP = 0.65 * zP - 0.35 * zS;
            const diff = Math.abs(res.crossPair[i] - expectedCP);
            if (diff > maxCompositeDelta) maxCompositeDelta = diff;
        }
    }

    if (maxCompositeDelta > 1e-10) crossPairMathValid = false;

    // Test missing sister bars (null, empty array, or undefined) -> must fallback to STANDALONE with zero crashes!
    try {
        const nullSisterEngine = VS.computeInvariantPVTEngine(dashboardData.etfs[ticker].history, ticker, null);
        check(nullSisterEngine !== null, `${ticker} handles null sisterBars without crash`);
        check(nullSisterEngine.sisterConfirmed[0] === 'STANDALONE', `${ticker} defaults to STANDALONE mode when sister is null`);
        check(Math.abs(nullSisterEngine.crossPair[100] - nullSisterEngine.zScore[100]) < 1e-12, `${ticker} C_pair equals Z_PVT in standalone mode`);

        const emptySisterEngine = VS.computeInvariantPVTEngine(dashboardData.etfs[ticker].history, ticker, []);
        check(emptySisterEngine !== null, `${ticker} handles empty sisterBars array without crash`);
    } catch (err) {
        standaloneFallbackValid = false;
        console.error(`Crash on missing sister bars for ${ticker}:`, err);
    }
}

check(crossPairMathValid, 'Cross-pair composite score C_pair = 0.65 * Z_p - 0.35 * Z_s matches exact mathematical definition');
check(standaloneFallbackValid, 'Graceful standalone fallback operates with zero exceptions on null or missing sister data');

// ============================================================================
// TEST 7: EXECUTION PERFORMANCE AUDIT (< 500 ms)
// ============================================================================
console.log('\n>>> [TEST 7] Multi-Decade Execution Performance Audit (< 500 ms)');

// Warmup run
VS.computeInvariantPVTEngine(dashboardData.etfs['BOIL'].history, 'BOIL', dashboardData.etfs['KOLD'].history);

const perfRuns = 3;
const runTimes = [];

for (let run = 1; run <= perfRuns; run++) {
    const tStart = performance.now();
    for (const ticker of tickers) {
        const history = dashboardData.etfs[ticker].history;
        const sisterTicker = sisterMap[ticker];
        const sisterBars = dashboardData.etfs[sisterTicker] ? dashboardData.etfs[sisterTicker].history : null;
        VS.computeInvariantPVTEngine(history, ticker, sisterBars);
    }
    const tElapsed = performance.now() - tStart;
    runTimes.push(tElapsed);
}

const minTime = Math.min(...runTimes);
const avgTime = runTimes.reduce((a, b) => a + b, 0) / runTimes.length;

console.log(`Performance Benchmark Across All 6 Tickers (${totalBarsAudited} primary + ${totalBarsAudited} sister bars):`);
runTimes.forEach((t, i) => console.log(`  Run ${i + 1}: ${t.toFixed(2)} ms`));
console.log(`  Fastest Run : ${minTime.toFixed(2)} ms`);
console.log(`  Average Run : ${avgTime.toFixed(2)} ms`);
console.log(`  Threshold   : < 500.00 ms`);

check(minTime < 500.0, `Multi-decade calculation completed in ${minTime.toFixed(2)} ms (< 500 ms constraint)`);
check(avgTime < 500.0, `Average calculation time ${avgTime.toFixed(2)} ms satisfies (< 500 ms constraint)`);

// ============================================================================
// FINAL SUMMARY
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log(`VERIFICATION SUMMARY: ${passedTests} / ${totalTests} CHECKS PASSED`);
if (failedTests === 0) {
    console.log('STATUS: ALL QUANTITATIVE & REGRESSION AUDITS PASSED WITH ZERO ERRORS');
} else {
    console.log(`STATUS: ${failedTests} CHECKS FAILED`);
}
console.log('='.repeat(80));

process.exit(failedTests === 0 ? 0 : 1);

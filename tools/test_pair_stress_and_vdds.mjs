// tools/test_pair_stress_and_vdds.mjs
// Rigorous quantitative regression harness for upgraded IPSI* and VDDS* modules

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Load CONFIG first
const configPath = path.resolve('docs/js/config.js');
const configSrc = fs.readFileSync(configPath, 'utf8');
const sandbox = { window: {}, document: {}, CONFIG: null };
vm.createContext(sandbox);
vm.runInContext(configSrc + '; window.CONFIG = CONFIG;', sandbox);
globalThis.CONFIG = sandbox.window.CONFIG || sandbox.CONFIG;

// Load Metrics
const metricsPath = path.resolve('docs/js/metrics.js');
const Metrics = (await import('file:///' + metricsPath.replace(/\\/g, '/'))).default;

console.log('=== TEST SUITE: Upgraded IPSI* & VDDS* Quantitative Engine ===');

let totalAssertions = 0;
function check(condition, message) {
    assert.ok(condition, message);
    totalAssertions++;
}

// Load real data from dashboard_data.json
const dataPath = path.resolve('docs/data/dashboard_data.json');
const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const etfs = rawData.etfs || {};

console.log(`Loaded real data for ${Object.keys(etfs).length} instruments.`);

// 1. TEST: Split Invariance of Notional Dollar Turnover
console.log('Test 1: Split Invariance of Notional Dollar Turnover...');
{
    const boilHistory = etfs['BOIL']?.history || [];
    check(boilHistory.length > 100, 'BOIL history should have sufficient bars');

    const vddsBaseline = Metrics.computeUpgradedVDDS(boilHistory);
    check(vddsBaseline.length > 0, 'computeUpgradedVDDS should return records');

    // Synthesize a 1-for-4 reverse split on the last 20 bars:
    // Split: price multiplies by 4, volume divides by 4.
    const splitFactor = 4.0;
    const syntheticSplitHistory = boilHistory.map((bar, idx) => {
        if (idx >= boilHistory.length - 20) {
            return {
                ...bar,
                open: bar.open != null ? bar.open * splitFactor : null,
                high: bar.high != null ? bar.high * splitFactor : null,
                low: bar.low != null ? bar.low * splitFactor : null,
                close: (bar.close != null ? bar.close : bar.price) * splitFactor,
                volume: bar.volume / splitFactor,
                splitFactor: idx === boilHistory.length - 20 ? splitFactor : 1.0
            };
        }
        return { ...bar };
    });

    const vddsSplit = Metrics.computeUpgradedVDDS(syntheticSplitHistory);
    check(vddsSplit.length === vddsBaseline.length, 'Length should match');

    // Dollar turnover must match exactly within floating point epsilon
    for (let i = boilHistory.length - 20; i < boilHistory.length; i++) {
        const dBase = vddsBaseline[i].dollarTurnover;
        const dSplit = vddsSplit[i].dollarTurnover;
        const diff = Math.abs(dBase - dSplit);
        const relErr = dBase > 0 ? diff / dBase : 0;
        check(relErr < 1e-4, `Bar ${i} Dollar Turnover must be split-invariant (diff=${diff})`);
    }
}

// 2. TEST: Volume Cancellation Solution in VDDS*
console.log('Test 2: Volume Cancellation Solution in VDDS*...');
{
    const boilHistory = etfs['BOIL']?.history || [];
    const baseBar = boilHistory[boilHistory.length - 1];

    // Create a dormant volume bar: price normal, volume 0.10x
    const dormantBar = { ...baseBar, volume: baseBar.volume * 0.10 };
    const dormantHistory = [...boilHistory.slice(0, -1), dormantBar];
    const dormantVdds = Metrics.computeUpgradedVDDS(dormantHistory);
    const latestDormant = dormantVdds[dormantVdds.length - 1];

    // Create an active capitulation volume bar: price down -8%, volume 4.0x, closing at low
    const capBar = {
        date: '2026-11-03',
        open: baseBar.close,
        high: baseBar.close * 1.01,
        low: baseBar.close * 0.91,
        close: baseBar.close * 0.92,
        volume: baseBar.volume * 4.0
    };
    const capHistory = [...boilHistory.slice(0, -1), capBar];
    const capVdds = Metrics.computeUpgradedVDDS(capHistory);
    const latestCap = capVdds[capVdds.length - 1];

    // Verify dormant volume dampens VDDS toward 1.00x:
    check(Math.abs(latestDormant.vddsStar - 1.00) < 0.08, `Dormant volume VDDS* should be near 1.00x (got ${latestDormant.vddsStar})`);
    // Verify active volume on capitulation triggers strong capitulation (< 0.88x):
    check(latestCap.vddsStar < 0.90, `Capitulation bar VDDS* should be < 0.90 (got ${latestCap.vddsStar})`);
    // Crucially: dormant and capitulation bars must NOT be equal!
    check(latestDormant.vddsStar !== latestCap.vddsStar, 'VDDS* must not cancel volume');
}

// 3. TEST: Mathematical Bounds across All Instruments
console.log('Test 3: Mathematical Bounds across All Instruments...');
{
    for (const [ticker, data] of Object.entries(etfs)) {
        const hist = data.history || [];
        if (!hist.length) continue;

        const vdds = Metrics.computeUpgradedVDDS(hist);
        for (let i = 0; i < vdds.length; i++) {
            const r = vdds[i];
            check(r.vddsStar >= 0.50 && r.vddsStar <= 1.50, `${ticker} bar ${i} VDDS* in [0.50, 1.50] (got ${r.vddsStar})`);
            check(r.orderFlowPhi >= -1.0 && r.orderFlowPhi <= 1.0, `${ticker} bar ${i} Phi in [-1, +1] (got ${r.orderFlowPhi})`);
            check(r.volatilityEfficiency >= 0.50 && r.volatilityEfficiency <= 2.00, `${ticker} bar ${i} E_t in [0.50, 2.00] (got ${r.volatilityEfficiency})`);
            check(r.ui.volMode.clampedValue >= 0.0 && r.ui.volMode.clampedValue <= 3.0, `${ticker} bar ${i} Vol clamped in [0, 3]`);
            check(r.ui.dollarMode.displayValue >= 0.50 && r.ui.dollarMode.displayValue <= 1.50, `${ticker} bar ${i} Dollar display in [0.5, 1.5]`);
        }
    }
}

// 4. TEST: Denominator Collapse & Bounded IPSI*
console.log('Test 4: Denominator Collapse & Bounded IPSI*...');
{
    const boilHist = etfs['BOIL']?.history || [];
    const koldHist = etfs['KOLD']?.history || [];

    const ipsiSeries = Metrics.computeUpgradedIPSI(boilHist, koldHist);
    check(ipsiSeries.length > 0, 'computeUpgradedIPSI should return series');

    for (let i = 0; i < ipsiSeries.length; i++) {
        const r = ipsiSeries[i];
        const s = r.ipsiStar;
        check(s.ipsiSigned >= -100.0 && s.ipsiSigned <= 100.0, `Bar ${i} IPSI signed in [-100, 100] (got ${s.ipsiSigned})`);
        check(s.ipsi0to10 >= 0.0 && s.ipsi0to10 <= 10.0, `Bar ${i} IPSI [0,10] in [0, 10] (got ${s.ipsi0to10})`);
        check(s.ipsiRegularizedRatio >= 0.20 && s.ipsiRegularizedRatio <= 5.00, `Bar ${i} IPSI ratio in [0.20, 5.00] (got ${s.ipsiRegularizedRatio})`);
        check(r.stressState.longPotential >= 0.0 && r.stressState.longPotential <= 100.0, `Bar ${i} Psi_L in [0, 100]`);
        check(r.stressState.shortPotential >= 0.0 && r.stressState.shortPotential <= 100.0, `Bar ${i} Psi_S in [0, 100]`);
    }

    // Zero-denominator test: simulate long volume dropping to exactly 0
    const zeroLongHist = [...boilHist.slice(0, -1), { ...boilHist[boilHist.length - 1], volume: 0 }];
    const zeroIpsiSeries = Metrics.computeUpgradedIPSI(zeroLongHist, koldHist);
    const latestZero = zeroIpsiSeries[zeroIpsiSeries.length - 1];
    check(Number.isFinite(latestZero.ipsiStar.ipsiRegularizedRatio), 'IPSI must be finite on zero long volume');
    check(latestZero.ipsiStar.ipsiRegularizedRatio <= 5.00, 'IPSI must not explode on zero long volume');
}

// 5. TEST: Schmitt-Trigger Hysteresis State Machine
console.log('Test 5: Schmitt-Trigger Hysteresis State Machine...');
{
    const dummyIpsi = { ipsiSigned: 0.0, ipsi0to10: 5.0, ipsiRegularizedRatio: 1.0 };
    const baseLeg = { vcvi63: 20.0, vcvi5: 15.0, drvol: 0.7, spikeActivation: 0.0, volRegimePct: 50.0 };

    // Baseline should be QUIET
    let state = Metrics.evaluatePairStressState(dummyIpsi, baseLeg, baseLeg, null);
    check(state.status === 'QUIET', 'Initial state should be QUIET');

    // Potential surges to ~60.9 (breaches 55.0 threshold): should escalate to L-ELEVATED
    const elevatedLeg = { vcvi63: 56.0, vcvi5: 42.0, drvol: 1.2, spikeActivation: 0.0, volRegimePct: 50.0 };
    state = Metrics.evaluatePairStressState(dummyIpsi, elevatedLeg, baseLeg, state);
    check(state.status === 'L-ELEVATED', `State should escalate to L-ELEVATED (got ${state.status})`);
    check(state.longTier === 1, 'Long tier should be 1');

    // Potential hovers down to 54.4 (below 55.0 entry, but above 48.0 exit): Schmitt latch must HOLD L-ELEVATED!
    const holdingLeg = { vcvi63: 48.0, vcvi5: 35.0, drvol: 1.0, spikeActivation: 0.0, volRegimePct: 50.0 };
    state = Metrics.evaluatePairStressState(dummyIpsi, holdingLeg, baseLeg, state);
    check(state.status === 'L-ELEVATED', `Schmitt trigger must hold L-ELEVATED against 1-day noise (got ${state.status})`);
    check(state.hysteresisLatchActive === true, 'Hysteresis latch should be active');
    check(state.dwellBars === 2, 'Dwell bars should increment to 2');

    // Potential drops down to base (below 48.0 exit): should release back to QUIET
    state = Metrics.evaluatePairStressState(dummyIpsi, baseLeg, baseLeg, state);
    check(state.status === 'QUIET', `State should de-escalate to QUIET when below Schmitt exit (got ${state.status})`);
    check(state.dwellBars === 1, 'Dwell bars should reset to 1 on state change');
}

// 6. TEST: Multi-Pair Integration
console.log('Test 6: Multi-Pair Integration across BOIL/KOLD, HNU/HND, 3NGL/3NGS...');
{
    const pairs = [
        { long: 'BOIL', short: 'KOLD' },
        { long: 'HNU.TO', short: 'HND.TO' },
        { long: '3NGL.L', short: '3NGS.L' }
    ];

    for (const p of pairs) {
        const lData = etfs[p.long];
        const sData = etfs[p.short];
        if (!lData || !sData) continue;

        const ipsi = Metrics.computeIPSI(lData, sData);
        check(ipsi != null, `IPSI should compute for ${p.long}/${p.short}`);
        check(Number.isFinite(typeof ipsi === 'number' ? ipsi : ipsi.valueOf()), `IPSI numeric value should be finite`);

        const status = Metrics.computePairStatus(ipsi, lData, sData);
        check(status != null, `Pair status should compute for ${p.long}/${p.short}`);
        check(typeof status.label === 'string', `Status label should be string (got ${status.label})`);
        check(['QUIET', 'L-ELEVATED', 'L-STRESS', 'L-CRITICAL', 'S-ELEVATED', 'S-STRESS', 'S-CRITICAL', 'DUAL', 'DATA_STALE'].includes(status.label),
            `Status label should be valid enum (got ${status.label})`);
        console.log(`  -> ${p.long} / ${p.short}: IPSI = ${(typeof ipsi === 'number' ? ipsi : ipsi.valueOf()).toFixed(2)}x, Status = ${status.label}`);
    }
}

console.log(`\nALL ${totalAssertions} ASSERTIONS PASSED WITH ZERO FAILURES!`);

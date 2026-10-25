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

console.log('================================================================');
console.log('Starting Volume Profile Test Suite');
console.log('================================================================');

// Set up mock DOM
const mockElements = {};
function getEl(id) {
    if (!mockElements[id]) {
        mockElements[id] = {
            id,
            innerHTML: '',
            style: {},
            title: '',
            value: '',
            min: '',
            max: '',
            width: 800,
            height: 400,
            offsetWidth: 180,
            offsetHeight: 80,
            attrs: {},
            classList: {
                has(c) { return !!this[c]; },
                toggle(c, v) { this[c] = (v !== undefined) ? !!v : !this[c]; },
                add(c) { this[c] = true; },
                remove(c) { this[c] = false; }
            },
            setAttribute(k, v) { this.attrs[k] = v; },
            getAttribute(k) { return this.attrs[k]; },
            appendChild(child) {},
            listeners: {},
            addEventListener(ev, fn) {
                if (!this.listeners[ev]) this.listeners[ev] = [];
                this.listeners[ev].push(fn);
            },
            querySelectorAll(sel) { return []; },
            querySelector(sel) { return null; },
            getBoundingClientRect() { return { width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400 }; },
            getContext(type) {
                return {
                    setTransform: () => {},
                    clearRect: () => {},
                    fillRect: () => {},
                    strokeRect: () => {},
                    beginPath: () => {},
                    moveTo: () => {},
                    lineTo: () => {},
                    stroke: () => {},
                    fillText: () => {},
                    measureText: (txt) => ({ width: txt.length * 7 }),
                    setLineDash: () => {}
                };
            }
        };
    }
    return mockElements[id];
}

const mockDoc = {
    getElementById: (id) => getEl(id),
    querySelectorAll: (sel) => [],
    createElement: (tag) => getEl(`elem-${tag}-${Math.random()}`)
};

const ctxObj = {
    console,
    Date,
    Math,
    isFinite,
    parseInt,
    document: mockDoc,
    window: { devicePixelRatio: 1 }
};
vm.createContext(ctxObj);

// Load config
vm.runInContext(fs.readFileSync('docs/js/config.js', 'utf8'), ctxObj);

// Load VolumeProfile
vm.runInContext(fs.readFileSync('docs/js/volume-profile.js', 'utf8') + '\n;globalThis.__VP = VolumeProfile;', ctxObj);
const VP = ctxObj.__VP;
ok(VP && typeof VP.compute === 'function', 'VolumeProfile loaded');

// --- 1. Compute validation with synthetic history ---
ok(VP.compute('BOIL', '1y', 'shares', null, null, null) === null, 'returns null when no data');
ok(VP.compute('BOIL', '1y', 'shares', null, null, []) === null, 'returns null for empty array');
ok(VP.compute('BOIL', '1y', 'shares', null, null, [{ date: '2026-01-01', close: 10, volume: 100 }]) === null, 'returns null for < 3 bars');

// Build 100-day synthetic history
const synthHistory = [];
let basePrice = 20.0;
for (let i = 0; i < 100; i++) {
    const d = new Date(2026, 0, 1 + i).toISOString().slice(0, 10);
    const close = basePrice + Math.sin(i / 5) * 5; // oscillates between 15 and 25 (ratio < 4 -> linear)
    const vol = 100000 + (i % 10) * 10000;
    synthHistory.push({
        date: d,
        close: Math.round(close * 100) / 100,
        volume: vol,
        dollarVolume: Math.round(close * vol)
    });
}

const prof = VP.compute('BOIL', 'all', 'shares', null, null, synthHistory);
ok(prof !== null, 'prof computed successfully');
eq(prof.n, 42, 'profile has 42 buckets');
eq(prof.buckets.length, 42, 'buckets array length is 42');
ok(prof.minP > 0 && prof.maxP > prof.minP, 'minP and maxP bounded');
eq(prof.useLog, false, 'linear scale used when maxP/minP <= 4.0');
ok(prof.pocIdx >= 0 && prof.pocIdx < 42, 'pocIdx within range');
ok(prof.vaLo <= prof.pocIdx && prof.vaHi >= prof.pocIdx, 'value area encompasses POC');
ok(prof.val <= prof.vah, 'VAL <= VAH');

// Total volume in buckets matches totalVol
let sumTotal = 0;
let sumUp = 0;
let sumDown = 0;
for (const b of prof.buckets) {
    sumTotal += b.total;
    sumUp += b.up;
    sumDown += b.down;
}
eq(sumTotal, prof.totalVol, 'bucket total volume matches profile totalVol');
eq(sumUp + sumDown, prof.totalVol, 'up + down volume equals total volume');

// --- 2. Logarithmic Scale Rule (maxP / minP > 4.0) ---
const wideHistory = [
    { date: '2026-01-01', close: 5.0, volume: 1000 },
    { date: '2026-01-02', close: 15.0, volume: 2000 },
    { date: '2026-01-03', close: 25.0, volume: 3000 } // 25 / 5 = 5.0 > 4.0 -> log scale
];
const profLog = VP.compute('BOIL', 'all', 'shares', null, null, wideHistory);
ok(profLog !== null, 'wide history prof computed');
eq(profLog.useLog, true, 'log scale enabled when maxP / minP > 4.0');

// --- 3. Dollar mode vs Share mode ---
const profDollar = VP.compute('BOIL', 'all', 'dollar', null, null, synthHistory);
ok(profDollar.totalVol > prof.totalVol, 'dollar mode total volume > share mode total volume');

// --- 4. Range presets ---
const prof1m = VP.compute('BOIL', '1m', 'shares', null, null, synthHistory);
ok(prof1m.endIdx - prof1m.startIdx < 35, '1m preset restricts window to ~30 days');

// --- 5. Custom date range ---
const profCustom = VP.compute('BOIL', 'custom', 'shares', synthHistory[10].date, synthHistory[20].date, synthHistory);
eq(profCustom.startIdx, 10, 'custom startIdx matches fixedFrom');
eq(profCustom.endIdx, 20, 'custom endIdx matches fixedTo');

// --- 6. Price helpers ---
const midP = VP.bucketMidPrice(prof, prof.pocIdx);
const loP = VP.bucketLowPrice(prof, prof.pocIdx);
const hiP = VP.bucketHighPrice(prof, prof.pocIdx);
ok(midP >= loP && midP <= hiP, 'bucketMidPrice sits between low and high price');

// --- 7. Formatting functions ---
eq(VP.fmtPrice(12.3456), '12.35', 'fmtPrice two decimals');
eq(VP.fmtPrice(105.4), '105.4', 'fmtPrice 100+ one decimal');
eq(VP.fmtPrice(null), '—', 'fmtPrice null safe');
eq(VP.fmtVol(1500000, 'shares'), '1.50M', 'fmtVol M format');
eq(VP.fmtVol(2500000000, 'dollar'), '$2.50B', 'fmtVol B format with dollar prefix');

// --- 8. Mutual sync with VolumeStudies ---
const mockVS = {
    state: { ticker: 'BOIL' },
    selectTicker(t) { this.state.ticker = t; }
};
ctxObj.VolumeStudies = mockVS;
VP.selectTicker('KOLD');
eq(VP.state.ticker, 'KOLD', 'VolumeProfile selected KOLD');
eq(mockVS.state.ticker, 'KOLD', 'VolumeStudies synchronized to KOLD');

// --- 9. Flat price edge case ---
const flatHistory = [
    { date: '2026-01-01', close: 50.0, volume: 1000 },
    { date: '2026-01-02', close: 50.0, volume: 1000 },
    { date: '2026-01-03', close: 50.0, volume: 1000 }
];
const flatProf = VP.compute('BOIL', 'all', 'shares', null, null, flatHistory);
ok(flatProf !== null, 'flatProf computed');
ok(flatProf.span > 0, 'flatProf span is non-zero after epsilon padding');
eq(flatProf.totalVol, 3000, 'flatProf total volume matches');

// --- 10. Zero volume days and short history edge cases ---
const zeroHistory = [
    { date: '2026-01-01', close: 10.0, volume: 0 },
    { date: '2026-01-02', close: 11.0, volume: 0 },
    { date: '2026-01-03', close: 12.0, volume: 0 }
];
const zeroProf = VP.compute('BOIL', 'all', 'shares', null, null, zeroHistory);
ok(zeroProf !== null, 'zeroProf computed');
eq(zeroProf.totalVol, 0, 'zeroProf total volume is zero');
ok(VP.compute('BOIL', 'all', 'shares', null, null, [
    { date: '2026-01-01', close: 10, volume: 100 },
    { date: '2026-01-02', close: 11, volume: 100 }
]) === null, 'returns null for two-bar history');

// --- 11. Scale boundary ratio: exactly 4.0 vs 4.001 ---
const hist4_0 = [
    { date: '2026-01-01', close: 10.0, volume: 100 },
    { date: '2026-01-02', close: 20.0, volume: 100 },
    { date: '2026-01-03', close: 40.0, volume: 100 }
];
const prof4_0 = VP.compute('BOIL', 'all', 'shares', null, null, hist4_0);
eq(prof4_0.useLog, false, 'ratio 4.0 exactly remains linear scale');

const hist4_001 = [
    { date: '2026-01-01', close: 10.0, volume: 100 },
    { date: '2026-01-02', close: 20.0, volume: 100 },
    { date: '2026-01-03', close: 40.01, volume: 100 }
];
const prof4_001 = VP.compute('BOIL', 'all', 'shares', null, null, hist4_001);
eq(prof4_001.useLog, true, 'ratio 4.001 activates logarithmic scale');

// --- 12. Asymmetric greedy outward expansion verification ---
const linearHist = [];
for (let i = 0; i < 42; i++) {
    linearHist.push({
        date: '2026-01-' + String(i + 1).padStart(2, '0'),
        close: 20 + i,
        volume: (i === 20) ? 500 : (i === 21) ? 300 : (i === 19) ? 100 : 10
    });
}
const greedyProf = VP.compute('BOIL', 'all', 'shares', null, null, linearHist);
eq(greedyProf.pocIdx, 20, 'POC is bucket 20');
ok(greedyProf.vaLo <= 20 && greedyProf.vaHi >= 21, 'Value area expands around POC');
let greedySum = 0;
for (let b = greedyProf.vaLo; b <= greedyProf.vaHi; b++) {
    greedySum += greedyProf.buckets[b].total;
}
ok(greedySum >= greedyProf.totalVol * 0.7, 'Value area volume reaches at least 70 percent');

// --- 13. Up and down volume split logic ---
const upDownHist = [
    { date: '2026-01-01', close: 10.0, volume: 100 },
    { date: '2026-01-02', close: 12.0, volume: 200 },
    { date: '2026-01-03', close: 11.0, volume: 300 },
    { date: '2026-01-04', close: 11.0, volume: 400 }
];
const upDownProf = VP.compute('BOIL', 'all', 'shares', null, null, upDownHist);
let tUp = 0;
let tDown = 0;
upDownProf.buckets.forEach(b => { tUp += b.up; tDown += b.down; });
eq(tUp, 700, 'Up volume correctly aggregates days with close >= previous close');
eq(tDown, 300, 'Down volume correctly aggregates days with close < previous close');

console.log(`================================================================`);
console.log(`ALL VOLUME PROFILE TESTS PASSED! (${passed} assertions)`);
console.log(`================================================================`);

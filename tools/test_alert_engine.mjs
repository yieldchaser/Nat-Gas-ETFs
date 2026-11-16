// Node test for docs/js/alert-engine.js. Run from the repo root: node tools/test_alert_engine.mjs
import { createRequire } from 'module';
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
const require = createRequire(import.meta.url);

const CE = require('../docs/js/cycle-engine.js');
globalThis.CycleEngine = CE;

// Load volume studies if available
const ctx = { console, Math, Date, isFinite, parseFloat, parseInt, Number, Array, Object, JSON, String, Infinity, NaN, Map, Set, Float64Array };
vm.createContext(ctx);
if (fs.existsSync('docs/js/config.js')) vm.runInContext(fs.readFileSync('docs/js/config.js', 'utf8') + '\n;globalThis.__C = CONFIG;', ctx);
if (fs.existsSync('docs/js/volume-studies.js')) vm.runInContext(fs.readFileSync('docs/js/volume-studies.js', 'utf8') + '\n;globalThis.__V = VolumeStudies;', ctx);
globalThis.CONFIG = ctx.__C;
globalThis.VolumeStudies = ctx.__V;

const AE = require('../docs/js/alert-engine.js');

const dash = JSON.parse(fs.readFileSync('data/dashboard_data.json', 'utf8'));
const boil = dash.etfs.BOIL.history, kold = dash.etfs.KOLD.history;
const hnu = dash.etfs['HNU.TO'] ? dash.etfs['HNU.TO'].history : null;
const hnd = dash.etfs['HND.TO'] ? dash.etfs['HND.TO'].history : null;
const cvolText = fs.readFileSync('data/cvol/ngvl_cvol_history.csv', 'utf8');
const cvol = AE.parseCvolCsv(cvolText);
const flows = AE.flowMap(JSON.parse(fs.readFileSync('data/flows/BOIL_flows.json', 'utf8')));

// Basic helpers
assert.deepStrictEqual(AE.expandingPercentile([1, 2, 3, 4], 2), [null, 100, 100, 100]);
assert(cvol.length > 3000 && cvol.every(r => { const d = new Date(r.date + 'T00:00:00Z').getUTCDay(); return d !== 0 && d !== 6; }), 'cvol parse skips weekends');

const m = AE.compute(boil, kold, cvol, flows, hnu, hnd);
const f = m.frame;
assert(m.ready && f.n > 3500, 'model ready');
assert.strictEqual(m.setups.length, AE.SETUPS.length);

// Verify expected tiers from spec W2 item 3:
// SHORT_ACCUMULATION STRONG; CLOSE_EXHAUSTION, CROWDED_RALLY, SHORT_LEG_REVERSAL MODERATE;
// OPT_BLOWOFF, CAPITULATION, WASHOUT MODERATE; CHASED_RALLY WATCH.
const byKey = Object.fromEntries(m.setups.map(s => [s.key, s]));
assert.strictEqual(byKey.SHORT_ACCUMULATION.tier, 'STRONG', 'SHORT_ACCUMULATION tier STRONG');
assert.strictEqual(byKey.CLOSE_EXHAUSTION.tier, 'MODERATE', 'CLOSE_EXHAUSTION tier MODERATE');
assert.strictEqual(byKey.CROWDED_RALLY.tier, 'MODERATE', 'CROWDED_RALLY tier MODERATE');
assert.strictEqual(byKey.SHORT_LEG_REVERSAL.tier, 'MODERATE', 'SHORT_LEG_REVERSAL tier MODERATE');
assert.strictEqual(byKey.OPT_BLOWOFF.tier, 'MODERATE', 'OPT_BLOWOFF tier MODERATE');
assert.strictEqual(byKey.CAPITULATION.tier, 'MODERATE', 'CAPITULATION tier MODERATE');
assert.strictEqual(byKey.WASHOUT.tier, 'MODERATE', 'WASHOUT tier MODERATE');
assert.strictEqual(byKey.CHASED_RALLY.tier, 'WATCH', 'CHASED_RALLY tier WATCH');

// Cycle records within Section 5 tolerances
const sA = byKey.SHORT_ACCUMULATION;
assert(Math.abs(sA.cycle.us.n - 50) <= 4, 'Setup A US entries count');
assert(Math.abs(sA.cycle.us.workedPct - 58) <= 4, 'Setup A US workedPct');
assert(Math.abs(sA.cycle.ca.n - 52) <= 4, 'Setup A CA entries count');

const sK = byKey.SHORT_LEG_REVERSAL;
assert(Math.abs(sK.cycle.us.n - 32) <= 4, 'Setup K US entries count');
assert(Math.abs(sK.cycle.us.workedPct - 47) <= 4, 'Setup K US workedPct');

// Synthetic frame test for Setup A and K masks
const synthN = 100;
const synthDates = Array.from({ length: synthN }, (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`);
const synthK = Array.from({ length: synthN }, (_, i) => ({ date: synthDates[i], close: 100 - i * 0.5, volume: 1000 }));
const synthB = Array.from({ length: synthN }, (_, i) => ({ date: synthDates[i], close: 50 + i * 0.5, volume: 1000 }));
const synthFrame = {
    n: synthN,
    dates: synthDates,
    kCloses: synthK.map(b => b.close),
    bCloses: synthB.map(b => b.close),
    sv: Array(synthN).fill(1.6),
    zKmax10: Array(synthN).fill(1.6),
    impK: Array(synthN).fill(-0.6),
    zK: Array(synthN).fill(-0.8),
    zKmin20: Array(synthN).fill(-2.2),
    cpPe: Array(synthN).fill(95),
    optState: Array(synthN).fill('NEUTRAL'),
};
assert.strictEqual(AE.SETUPS.find(s => s.key === 'SHORT_ACCUMULATION').test(synthFrame, 15), true, 'Synthetic A test');
assert.strictEqual(AE.SETUPS.find(s => s.key === 'SHORT_LEG_REVERSAL').test(synthFrame, 75), true, 'Synthetic K test');

// Render verification
const el = { innerHTML: '', querySelectorAll: () => [] };
AE.render(m, el);
assert(el.innerHTML.includes('aa-today'), 'render today line');
assert(el.innerHTML.includes('TODAY'), 'render today label');
assert(el.innerHTML.includes('aa-head'), 'render header');
assert(el.innerHTML.includes('All setups'), 'render setups accordion');

console.log('Alert engine tests passed');

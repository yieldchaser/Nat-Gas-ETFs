// Unit tests for CycleEngine
import fs from 'fs';
import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const CycleEngine = require('../docs/js/cycle-engine.js');

console.log('Testing CycleEngine...');

// 1. Hand-built price series with known pivots (30% threshold)
// 100 -> 135 (+35% -> Peak) -> 90 (-33.3% -> Trough) -> 140 (+55.5% -> Peak) -> 95 (-32.1% -> Trough)
const synthetic = [
    100, 105, 115, 125, 135,
    130, 120, 105, 90,
    100, 115, 130, 140,
    130, 110, 95
];
const pivs = CycleEngine.pivots(synthetic, 30);
assert.strictEqual(pivs.length, 4, 'Should detect exactly 4 confirmed pivots');
assert.strictEqual(pivs[0].type, 'T', 'First pivot is starting Trough');
assert.strictEqual(pivs[0].i, 0, 'First trough at index 0 (100)');
assert.strictEqual(pivs[1].type, 'P', 'Second pivot is Peak');
assert.strictEqual(pivs[1].i, 4, 'First peak at index 4 (135)');
assert.strictEqual(pivs[2].type, 'T', 'Third pivot is Trough');
assert.strictEqual(pivs[2].i, 8, 'Second trough at index 8 (90)');
assert.strictEqual(pivs[3].type, 'P', 'Fourth pivot is Peak');
assert.strictEqual(pivs[3].i, 12, 'Second peak at index 12 (140)');

// 2. Entry exactly at a trough: heat 0, run = cycle gain
const entryAtTrough = CycleEngine.entry(synthetic, pivs, 8);
assert(entryAtTrough !== null, 'Entry at trough should evaluate');
assert.strictEqual(entryAtTrough.heat, 0, 'Heat at trough entry should be exactly 0');
const expectedRun = (140 - 90) / 90;
assert(Math.abs(entryAtTrough.run - expectedRun) < 1e-6, 'Run should equal cycle gain');
assert.strictEqual(entryAtTrough.nearLow, true, 'Entry at trough is near low');
assert.strictEqual(entryAtTrough.worked, true, 'Gained > 30% before -20%');

// 3. Episode spacing
const mask = new Array(100).fill(false);
mask[65] = true;
mask[68] = true; // within 10, skipped
mask[79] = true; // 79 - 68 = 11 > 10, kept
mask[82] = true; // within 10, skipped
const eps = CycleEngine.episodes(mask, 10, 60);
assert.deepStrictEqual(eps, [65, 79], 'Episodes must enforce gap > 10');

// 4. Any-day figures from Section 3 within 1.5 points on raw data
const raw = JSON.parse(fs.readFileSync('docs/data/dashboard_data.json', 'utf8')).etfs;
const getCloses = sym => raw[sym].history.filter(b => b && b.close != null && b.date >= '2012-06-01' && b.date <= '2026-11-13').map(b => b.close);

const expected = {
    BOIL: { worked: 35, nearLow: 12, run: 21, heat: -16 },
    KOLD: { worked: 45, nearLow: 10, run: 31, heat: -12 },
    'HNU.TO': { worked: 37, nearLow: 12, run: 23, heat: -17 },
    'HND.TO': { worked: 43, nearLow: 9, run: 28, heat: -14 }
};

for (const [sym, exp] of Object.entries(expected)) {
    const c = getCloses(sym);
    const p = CycleEngine.pivots(c, 30);
    const any = CycleEngine.anyDay(c, p, 60);
    assert(Math.abs(any.workedPct - exp.worked) <= 1.5, `${sym} workedPct (${any.workedPct.toFixed(1)}%) vs expected ${exp.worked}%`);
    assert(Math.abs(any.nearLowPct - exp.nearLow) <= 1.5, `${sym} nearLowPct (${any.nearLowPct.toFixed(1)}%) vs expected ${exp.nearLow}%`);
    assert(Math.abs(any.run - exp.run) <= 1.5, `${sym} run (${any.run.toFixed(1)}%) vs expected ${exp.run}%`);
    assert(Math.abs(any.heat - exp.heat) <= 1.5, `${sym} heat (${any.heat.toFixed(1)}%) vs expected ${exp.heat}%`);
}

console.log('PASS CycleEngine unit tests');

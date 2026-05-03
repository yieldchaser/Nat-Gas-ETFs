import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const csvPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(repoRoot, 'docs', 'data', 'cvol', 'ngvl_cvol_history.csv');

function loadEngine() {
    const cvolJs = fs.readFileSync(path.join(repoRoot, 'docs', 'js', 'cvol.js'), 'utf8');
    const sandbox = {
        console,
        module: { exports: {} },
        exports: {},
        window: {},
        document: { getElementById: () => null },
    };
    vm.createContext(sandbox);
    vm.runInContext(
        cvolJs + '\nmodule.exports = { parseCvolCsv, computeComposites, SURFACE_STATES, surfaceMeta };',
        sandbox,
        { filename: 'docs/js/cvol.js' }
    );
    return sandbox.module.exports;
}

function fmt(value, digits = 1) {
    return value == null || Number.isNaN(value) ? 'n/a' : Number(value).toFixed(digits);
}

function pct(value, digits = 0) {
    return value == null || Number.isNaN(value) ? 'n/a' : `${Number(value).toFixed(digits)}%`;
}

function countMissingWeekdays(data) {
    if (data.length < 2) return 0;
    const seen = new Set(data.map((row) => row.date));
    let missing = 0;
    const cursor = new Date(`${data[0].date}T00:00:00Z`);
    const end = new Date(`${data[data.length - 1].date}T00:00:00Z`);
    while (cursor <= end) {
        const day = cursor.getUTCDay();
        const key = cursor.toISOString().slice(0, 10);
        if (day !== 0 && day !== 6 && !seen.has(key)) missing++;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return missing;
}

function printRows(headers, rows) {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
    console.log(headers.map((h, i) => h.padEnd(widths[i])).join('  '));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    rows.forEach((row) => console.log(row.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ')));
}

const { parseCvolCsv, computeComposites, SURFACE_STATES } = loadEngine();
const csv = fs.readFileSync(csvPath, 'utf8');
const data = parseCvolCsv(csv);
const comp = computeComposites(data);
const latest = data[data.length - 1];
const read = comp.currentSurfaceRead;
const missingWeekdays = countMissingWeekdays(data);

console.log('\nCVOL OPTIONS SURFACE AUDIT');
console.log('==========================');
console.log(`CSV: ${path.relative(repoRoot, csvPath)}`);
console.log(`Rows: ${data.length}`);
console.log(`Latest date: ${latest?.date ?? 'n/a'}`);
console.log(`Latest NGVL / ATM / Underlying: ${fmt(latest?.ngvl, 2)} / ${fmt(latest?.atm, 2)} / $${fmt(latest?.underlying, 3)}`);
console.log(`Missing weekdays in file span: ${missingWeekdays}`);
console.log(`Surface events: ${(comp.surfaceEvents || []).length}`);

console.log('\nCURRENT OPTIONS MARKET READ');
console.log('---------------------------');
console.log(`State: ${read.label} (${read.state})`);
console.log(`Confidence: ${read.confidence} (${read.confidenceScore}/100)`);
console.log(`Directional read: ${read.directionalRead}`);
console.log(`Volatility bias: ${read.volBias}`);
console.log(`Horizon: ${read.horizon}`);
console.log(`Action: ${read.action}`);
console.log(`Evidence: ${(read.evidence || []).join(' | ') || 'none'}`);
console.log(`Contradictions: ${(read.contradictions || []).join(' | ') || 'none'}`);

const stateCounts = {};
(comp.surfaceDaily || []).forEach((day) => {
    if (!day || day.idx < 252) return;
    stateCounts[day.state] = (stateCounts[day.state] || 0) + 1;
});

console.log('\nSTATE COUNTS');
console.log('------------');
printRows(
    ['State', 'Days', 'Share'],
    Object.keys(SURFACE_STATES)
        .map((state) => {
            const count = stateCounts[state] || 0;
            const share = data.length ? (count / Math.max(1, data.length - 252)) * 100 : null;
            return [state, count, pct(share, 1)];
        })
        .filter((row) => row[1] > 0)
);

console.log('\nBASE RATES');
console.log('----------');
printRows(
    ['Horizon', 'N', 'Up', 'Down', 'Avg |Move|', 'Beat Implied'],
    [5, 10, 21].map((h) => {
        const base = comp.surfaceAnalogs.base[h];
        return [`${h}D`, base.count, pct(base.upRate), pct(base.downRate), pct(base.avgAbs, 2), pct(base.impliedBeatRate)];
    })
);

console.log('\nSURFACE ANALOGS');
console.log('---------------');
const analogRows = Object.values(comp.surfaceAnalogs.states)
    .sort((a, b) => b.count - a.count)
    .map((state) => {
        const h21 = state.horizons[21] || {};
        const edge = h21.directionalEdge
            ? `${pct(h21.dirHitRate)} vs base ${pct(h21.baseDirRate)}`
            : h21.lowSample
                ? `LOW SAMPLE n=${h21.n || 0}`
                : 'no directional edge';
        return [
            state.state,
            state.count,
            h21.n || 0,
            pct(h21.avgAbsMove, 2),
            pct(h21.impliedBeatRate),
            pct(h21.volExpansionRate),
            edge,
        ];
    });
printRows(['State', 'Days', '21D N', '21D |Move|', 'Beat Implied', 'Vol Expand', 'Directional Audit'], analogRows);

const violations = [];
Object.values(comp.surfaceAnalogs.states).forEach((state) => {
    [5, 10, 21].forEach((h) => {
        const row = state.horizons[h];
        if (!row || !row.directionalEdge) return;
        if (row.n < 30 || row.dirHitRate < 52 || row.dirHitRate < row.baseDirRate + 3) {
            violations.push(`${state.state} ${h}D edge fails guardrails`);
        }
    });
});

if (violations.length) {
    console.log('\nGUARDRAIL VIOLATIONS');
    violations.forEach((v) => console.log(`- ${v}`));
    process.exitCode = 1;
} else {
    console.log('\nGuardrails: PASS — directional edge is only shown when sample size and base-rate thresholds clear.');
}
